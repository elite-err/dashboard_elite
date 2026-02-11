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

  if (!k.active || k.active <= 0) {
    return `
      <div class="p-3 border-top bg-white text-muted">
        Progression livraison : aucun BL actif
      </div>
    `;
  }

  const pct = Math.max(0, Math.min(100, k.pct ?? 0));
  const truckLeft = Math.max(3, Math.min(97, pct + 2));


  return `
    <div class="p-3 border-top bg-white">
      <div class="d-flex justify-content-between align-items-center mb-2">
        <div class="fw-semibold">Progression livraison</div>
        <div class="fw-semibold">${pct}%</div>
      </div>

      <div class="progress-wrap">
        <div class="progress" role="progressbar"
             aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
          <div class="progress-bar bg-success" style="width: ${pct}%"></div>
        </div>

        <!-- 🚚 Font Awesome -->
        <i class="fa-solid fa-truck truck" style="left:${truckLeft}%"></i>
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

let allCards = [];
let currentCardIndex = 0;

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
    const timeBadgeClass = p.time_badge_class || p.badge_class;

    const time = p.x_time_from
      ? `<span class="badge ${esc(timeBadgeClass)} me-2">${esc(p.x_time_from)}</span>`
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
    allCards = data.cards || [];
    
    // ✅ Préserver l'index courant si possible
    if (currentCardIndex >= allCards.length) {
      currentCardIndex = 0;
    }

    if (!allCards.length) {
      container.innerHTML = `
        <div class="col-12">
          <div class="card shadow-sm">
            <div class="card-body text-muted">Aucune tournée pour la période.</div>
          </div>
        </div>`;
    } else {
      displayCurrentCard();
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

function displayCurrentCard() {
  const container = document.getElementById("deliveries_container");
  const navContainer = document.getElementById("nav_controls");
  
  if (!allCards.length) return;

  const card = allCards[currentCardIndex];
  container.innerHTML = `
    <div class="col-12">
      ${renderCard(card)}
    </div>
  `;

  // Afficher les contrôles de navigation
  navContainer.innerHTML = `<span class="text-muted mx-2">${currentCardIndex + 1} / ${allCards.length}</span>`;
}

const shownextCard = () => {
  if (!allCards.length) return;
  
  if (currentCardIndex < allCards.length - 1) {
    currentCardIndex++;
  } else {
    currentCardIndex--;
  }

  if (currentCardIndex < 0) currentCardIndex = 0;
  if (currentCardIndex >= allCards.length) currentCardIndex = allCards.length - 1;

  displayCurrentCard();
};

refreshDeliveries();

// ✅ Rafraîchissement tous les 10s
setInterval(refreshDeliveries, 10000);

// ✅ Changement de slide tous les 15s (décalé pour éviter les conflits)
setInterval(shownextCard, 15000);