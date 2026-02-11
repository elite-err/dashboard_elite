# -*- coding: utf-8 -*-

import time
import threading
import configparser
from pathlib import Path
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from typing import Any, Dict, Tuple, Optional

import requests
from flask import Flask, jsonify, request, render_template

# ==========================================================
# TOOLS
# ==========================================================

def float_to_hhmm(val):
    """8.5 -> '08:30' ; 14.25 -> '14:15'"""
    if val is None or val == "":
        return ""
    try:
        f = float(val)
        total_minutes = int(round(f * 60))
        hours = (total_minutes // 60) % 24
        minutes = total_minutes % 60
        return f"{hours:02d}:{minutes:02d}"
    except Exception:
        return str(val)


def iso_date_to_fr(val):
    """'2025-10-29' -> '29.10.2025' (ou retourne val si inattendu)"""
    if not val:
        return ""
    try:
        d = datetime.fromisoformat(str(val)).date()
        return d.strftime("%d.%m.%Y")
    except Exception:
        return str(val)

def float_to_minutes(val) -> Optional[int]:
    """8.5 -> 510 minutes"""
    if val is None or val == "":
        return None
    try:
        return int(round(float(val) * 60))
    except Exception:
        return None


def parse_odoo_datetime(val: str) -> Optional[datetime]:
    """
    Odoo renvoie souvent 'YYYY-MM-DD HH:MM:SS' (naive).
    On l'interprète comme UTC puis on convertit en Europe/Zurich.
    """
    if not val:
        return None
    try:
        s = str(val).replace(" ", "T")
        dt = datetime.fromisoformat(s)  # naive
        dt = dt.replace(tzinfo=ZoneInfo("UTC"))
        return dt.astimezone(ZoneInfo("Europe/Zurich"))
    except Exception:
        return None



# ==========================================================
# CONFIG (depuis config.ini)
# ==========================================================
CONFIG_PATH = Path(__file__).with_name("config.ini")

config = configparser.ConfigParser()
read_files = config.read(CONFIG_PATH, encoding="utf-8")
if not read_files:
    raise RuntimeError(f"Fichier config introuvable: {CONFIG_PATH}")

ODOO_URL = config.get("odoo", "url").rstrip("/")  # important: pas de slash final
ODOO_DB = config.get("odoo", "db")
ODOO_LOGIN = config.get("odoo", "login")
ODOO_PASSWORD = config.get("odoo", "password")
ODOO_TIMEOUT = config.getint("odoo", "timeout", fallback=15)

CACHE_TTL = config.getint("app", "cache_ttl", fallback=10)

# ==========================================================
# APP
# ==========================================================
app = Flask(__name__)
session = requests.Session()

_cache_lock = threading.Lock()
_cache: Dict[str, Tuple[float, Any]] = {}
_authed = False


# ==========================================================
# CACHE TTL
# ==========================================================
def cache_get(key: str) -> Optional[Any]:
    with _cache_lock:
        item = _cache.get(key)
        if not item:
            return None
        ts, data = item
        if (time.time() - ts) > CACHE_TTL:
            _cache.pop(key, None)
            return None
        return data


def cache_set(key: str, data: Any) -> None:
    with _cache_lock:
        _cache[key] = (time.time(), data)


# ==========================================================
# ODOO JSON-RPC (Odoo 18)
# ==========================================================
def odoo_authenticate() -> None:
    global _authed
    if _authed:
        return

    url = f"{ODOO_URL}/web/session/authenticate"
    payload = {
        "jsonrpc": "2.0",
        "params": {
            "db": ODOO_DB,
            "login": ODOO_LOGIN,
            "password": ODOO_PASSWORD,
        },
    }

    r = session.post(url, json=payload, timeout=ODOO_TIMEOUT)
    r.raise_for_status()
    data = r.json()

    if data.get("error") or not data.get("result", {}).get("uid"):
        raise RuntimeError("Authentication to Odoo failed")

    _authed = True


def call_kw(model: str, method: str, args=None, kwargs=None) -> Any:
    odoo_authenticate()

    url = f"{ODOO_URL}/web/dataset/call_kw/{model}/{method}"
    payload = {
        "jsonrpc": "2.0",
        "params": {
            "model": model,
            "method": method,
            "args": args or [],
            "kwargs": kwargs or {},
        },
    }

    r = session.post(url, json=payload, timeout=ODOO_TIMEOUT)
    r.raise_for_status()
    data = r.json()

    if data.get("error"):
        raise RuntimeError(data["error"])

    return data.get("result")


# ==========================================================
# ROUTES WEB
# ==========================================================
@app.get("/")
def home():
    return render_template("dashboard.html")


@app.get("/health")
def health():
    return {"ok": True}


# ==========================================================
# API DASHBOARD : TOURNÉES + BL
# ==========================================================
@app.get("/deliveries")
def deliveries():
    # ✅ cache dépend des dates (important en dev)
    cache_key = "elite_deliveries:x_display"
    cached = cache_get(cache_key)
    if cached:
        return jsonify({"cached": True, **cached})

    # 1) Lire les tournées
    deliveries = call_kw(
        "x_elite_delivery",
        "search_read",
        args=[[("x_display", "=", True)]],
        kwargs={
            "fields": [
                "id",
                "x_display",
                "x_date",
                "x_area",
                "x_truck",
                "x_drivers",
                "x_stock_picking_ids",
                "x_status"
            ],
            "order": "x_date asc, x_truck asc, id asc",
        },
    )

    def m2o_name(val):
        if isinstance(val, list) and len(val) >= 2:
            return val[1]
        return ""

    # 📌 Récupération des labels du champ selection x_status
    field_info = call_kw(
        "x_elite_delivery",
        "fields_get",
        args=[["x_status"]],
        kwargs={"attributes": ["selection"]},
    )

    selection = field_info.get("x_status", {}).get("selection", []) or []
    x_status_label_by_key = {key: label for key, label in selection}

    # 2) Collecter tous les BL
    all_picking_ids = set()
    for d in deliveries:
        for pid in (d.get("x_stock_picking_ids") or []):
            all_picking_ids.add(pid)

    pickings_by_id = {}

    # 3) Lire les BL (stock.picking)
    if all_picking_ids:
        pickings = call_kw(
            "stock.picking",
            "search_read",
            args=[[("id", "in", list(all_picking_ids))]],
            kwargs={
                "fields": [
                    "id",
                    "name",
                    "state",
                    "partner_id",
                    "x_time_from",
                    "x_time_to",
                    "date_done",            
                    "x_city",
                    "x_customer_confirmation", 
                ],
                "order": "x_time_from asc, id asc",
            },
        )

        for p in pickings:
            # ✅ conversion float -> HH:MM
            p["x_time_from"] = float_to_hhmm(p.get("x_time_from"))

            partner = p.get("partner_id")
            p["partner_name"] = partner[1] if isinstance(partner, list) and len(partner) >= 2 else ""

            st = (p.get("state") or "").lower()
            confirmed = bool(p.get("x_customer_confirmation"))
            
            if st == "done":
                # ✅ done = vert (prioritaire)
                p["row_class"] = "list-group-item-success"
                p["badge_class"] = "text-bg-success"
            
            elif st == "cancel":
                p["row_class"] = "list-group-item-danger"
                p["badge_class"] = "text-bg-danger"

            elif st == "assigned":
                # ✅ assigned = bleu (prêt)
                p["row_class"] = "list-group-item-info"
                p["badge_class"] = "text-bg-info"

            elif st == "waiting" or st == "confirmed":
                # ✅ waiting/confirmed = jaune (en attente)
                p["row_class"] = "list-group-item-warning"
                p["badge_class"] = "text-bg-warning"

            elif st == "draft":
                # ✅ draft = gris (brouillon)
                p["row_class"] = "list-group-item-secondary"
                p["badge_class"] = "text-bg-secondary"

            else:
                # ✅ pas done : bleu si confirmé, sinon gris
                #if confirmed:
                #    p["row_class"] = "list-group-item-primary"
                #    p["badge_class"] = "text-bg-primary"
                #else:
                    p["row_class"] = "list-group-item-secondary"
                    p["badge_class"] = "text-bg-secondary"

            pickings_by_id[p["id"]] = p


            # par défaut : la même couleur que l'état (ou ce que tu veux)
            p["time_badge_class"] = p.get("badge_class", "text-bg-secondary")

            # ✅ règle "retard" : seulement si done ET validé aujourd'hui
            st = (p.get("state") or "").lower()
            if st == "done":
                dt_done_local = parse_odoo_datetime(p.get("date_done"))
                today_local = datetime.now(ZoneInfo("Europe/Zurich")).date()

                x_time_to_min = float_to_minutes(p.get("x_time_to"))
                if dt_done_local and dt_done_local.date() == today_local and x_time_to_min is not None:
                    done_min = dt_done_local.hour * 60 + dt_done_local.minute
                    if done_min > x_time_to_min:
                        # retard -> badge heure rouge
                        p["time_badge_class"] = "text-bg-danger"

    # 4) Résoudre les chauffeurs (x_drivers)
    all_emp_ids = set()
    for d in deliveries:
        dv = d.get("x_drivers")
        if isinstance(dv, list) and dv and isinstance(dv[0], int):
            for eid in dv:
                all_emp_ids.add(eid)

    emp_name_by_id = {}
    if all_emp_ids:
        emps = call_kw(
            "hr.employee",
            "read",
            args=[list(all_emp_ids)],
            kwargs={"fields": ["name"]},
        )
        for e in emps:
            emp_name_by_id[e["id"]] = e.get("name") or ""

    # 5) Construire les cards + KPI progression (cancel exclus)
    cards = []
    for d in deliveries:
        drivers_val = d.get("x_drivers")
        drivers_label = ""

        x_status_key = d.get("x_status")
        d["x_status_label"] = x_status_label_by_key.get(x_status_key, x_status_key or "")

        # m2o
        if isinstance(drivers_val, list) and len(drivers_val) == 2 and isinstance(drivers_val[1], str):
            drivers_label = drivers_val[1]
        # m2m
        elif isinstance(drivers_val, list) and drivers_val and isinstance(drivers_val[0], int):
            drivers_label = ", ".join(
                emp_name_by_id.get(eid, "")
                for eid in drivers_val
                if emp_name_by_id.get(eid)
            )

        picking_lines = []
        for pid in (d.get("x_stock_picking_ids") or []):
            p = pickings_by_id.get(pid)
            if p:
                picking_lines.append(p)

        total = len(picking_lines)
        done_count = sum(1 for p in picking_lines if (p.get("state") or "").lower() == "done")
        cancel_count = sum(1 for p in picking_lines if (p.get("state") or "").lower() == "cancel")

        # ✅ KPI confirmation client (cancel exclus)
        active_pickings = [p for p in picking_lines if (p.get("state") or "").lower() != "cancel"]
        confirm_yes = sum(1 for p in active_pickings if bool(p.get("x_customer_confirmation")))
        confirm_total = len(active_pickings)
        confirm_no = max(confirm_total - confirm_yes, 0)
        confirm_pct = int(round((confirm_yes / confirm_total) * 100)) if confirm_total > 0 else 0


        # ✅ cancel exclus du calcul
        active_total = max(total - cancel_count, 0)
        progress_pct = int(round((done_count / active_total) * 100)) if active_total > 0 else 0
        not_done = max(active_total - done_count, 0)

        cards.append({
            "id": d.get("id"),
            "date": iso_date_to_fr(d.get("x_date")),
            "area": d.get("x_area"),
            "status_label": d.get("x_status_label"),
            "status": d.get("x_status"),
            "truck": d.get("x_truck") or "",
            "drivers": drivers_label,
            "pickings": picking_lines,

            # ✅ sous-card KPI progression
            "kpi_progress": {
                "total": total,          # tout (y compris cancel)
                "active": active_total,  # sans cancel
                "done": done_count,
                "not_done": not_done,
                "cancel": cancel_count,
                "pct": progress_pct,
            },
            "kpi_customer_confirmation": {
                "active": confirm_total,    # sans cancel
                "yes": confirm_yes,
                "no": confirm_no,
                "pct": confirm_pct,
            },            
        })

    payload = {
        "cached": False,
        "cards": cards,
    }

    cache_set(cache_key, payload)
    return jsonify(payload)


# ==========================================================
# MAIN
# ==========================================================
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
