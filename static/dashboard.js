function esc(s) {
  return (s ?? "").toString()
    .replaceAll("&","&amp;").replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function nowText() {
  try { return new Date().toLocaleString(); } catch(e) { return ""; }
}

/**
 * Sous-card KPI : progression livraison (cancel exclus)
 * k = { total, active, done, not_done, cancel, pct }
 */
function renderProgressKpi(k) {
  if (!k) return "";

  // Aucun BL actif (tout est cancel ou vide)
  if (!k.active || k.active <= 0) {
    return `
      <div class="p-3 border-top bg-white text-muted">
        Progression livraison : aucun BL actif
        ${k.cancel > 0 ? `<span class="ms-2 badge text-bg-danger">Annulé : ${k.cancel}</span>` : ""}
      </div>
    `;
  }

  const pct = Math.max(0, Math.min(100, k.pct ?? 0));

  return `
    <div class="p-3 border-top bg-white">
      <div class="d-flex justify-content-between align-items-center mb-2">
        <div class="fw-semibold">Progression livraison</div>
        <div class="fw-semibold">${pct}%</div>
      </div>

      <div class="progress" role="progressbar"
           aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
        <div class="progress-bar bg-success" style="width: ${pct}%"></div>
      </div>
    </div>
  `;
}

/**
 * Sous-card KPI : confirmation client (cancel exclus)
 * k = { active, yes, no, pct }
 */
function renderCustomerConfirmationKpi(k) {
  if (!k) return "";

  if (!k.active || k.active <= 0) {
    return `
      <div class="p-3 border-top bg-white text-muted">
        Confirmation client : aucun BL actif
      </div>
    `;
  }

  const pct = Math.max(0, Math.min(100, k.pct ?? 0));

  return `
    <div class="p-3 border-top bg-white">
      <div class="d-flex justify-content-between align-items-center mb-2">
        <div class="fw-semibold">Confirmation client</div>
        <div class="fw-semibold">${pct}%</div>
      </div>

      <div class="progress" role="progressbar"
           aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
        <div class="progress-bar bg-primary" style="width: ${pct}%"></div>
      </div>
    </div>
  `;
}

function renderCard(card) {
  const header = `
    <div class="card-header bg-white">
      <div class="d-flex justify-content-between align-items-start">
        <!-- Colonne gauche : titre + chauffeurs -->
        <div>
          <div class="fw-bold">
            ${esc(card.date)} - ${esc(card.area)}
          </div>
          <div class="text-muted">
            • ${esc(card.drivers)}
          </div>
        </div>

        <!-- Colonne droite : Camion + Statut -->
        <div class="d-inline-flex align-items-center gap-1">
          <span class="badge text-bg-dark">
            Camion ${esc(card.truck)}
          </span>
          <span class="badge ${esc(card.status_badge_class || 'text-bg-secondary')}">
            ${esc(card.status_label)}
          </span>
        </div>
      </div>
    </div>
  `;

  const lines = (card.pickings || []).map(p => {
    const time = p.x_time_from
      ? `<span class="badge ${esc(p.badge_class)} me-2">${esc(p.x_time_from)}</span>`
      : "";
    const city = p.x_city ? `<span class="text-muted ms-2">• ${esc(p.x_city)}</span>` : "";
    const name = p.partner_name || "";
    const bl = p.name || "";

    return `
      <div class="list-group-item d-flex justify-content-between align-items-center ${esc(p.row_class)}">
        <div class="text-truncate">
          ${time}
          <span class="fw-semibold">${esc(name)}</span>
          ${city}
        </div>
        <div class="ms-3 text-nowrap">
          <span class="badge text-bg-light border">${esc(bl)}</span>
        </div>
      </div>
    `;
  }).join("");

  // ✅ Règles d'affichage selon le statut (clé du selection)
  const showDeliveryProgress = (card.status === "on_the_way");
  const showConfirmProgress  = (card.status === "open" || card.status === "full");

  const body = `
    <div class="card-body p-0">
      <div class="list-group list-group-flush">
        ${lines || `<div class="list-group-item text-muted">Aucun BL</div>`}
      </div>

      <!-- ✅ Sous-cards KPI (conditionnées par statut) -->
      ${showDeliveryProgress ? renderProgressKpi(card.kpi_progress) : ""}
      ${showConfirmProgress ? renderCustomerConfirmationKpi(card.kpi_customer_confirmation) : ""}
    </div>
  `;

  return `<div class="card shadow-sm h-100">${header}${body}</div>`;
}

async function refreshDeliveries() {
  const container = document.getElementById("deliveries_container");
  const lastUpdate = document.getElementById("last_update");

  try {
    const data = await fetch("/deliveries").then(r => r.json());
    const cards = data.cards || [];

    if (!cards.length) {
      container.innerHTML = `
        <div class="col-12">
          <div class="card shadow-sm">
            <div class="card-body text-muted">Aucune tournée pour la période.</div>
          </div>
        </div>`;
    } else {
      container.innerHTML = cards.map(c => `
        <div class="col-12 col-lg-6">
          ${renderCard(c)}
        </div>
      `).join("");
    }

    lastUpdate.textContent = "Dernière mise à jour : " + nowText();
  } catch (e) {
    console.error(e);
    container.innerHTML = `
      <div class="col-12">
        <div class="alert alert-warning mb-0">Erreur lors du chargement des tournées.</div>
      </div>`;
    lastUpdate.textContent = "Erreur : " + nowText();
  }
}

const refreshBtn = document.getElementById("refresh_btn");
if (refreshBtn) {
  refreshBtn.addEventListener("click", refreshDeliveries);
}

refreshDeliveries();
setInterval(refreshDeliveries, 10000);

