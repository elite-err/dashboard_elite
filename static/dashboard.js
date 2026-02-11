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
      <div class="p-3 border-top bg-white text-muted" style="font-size: 1.65rem;">
        Progression livraison : aucun BL actif
      </div>
    `;
  }

  const pct = Math.max(0, Math.min(100, k.pct ?? 0));
  const truckLeft = Math.max(3, Math.min(97, pct + 2));

  return `
    <div class="p-3 border-top bg-white">
      <div class="d-flex justify-content-between align-items-center mb-2">
        <div class="fw-semibold" style="font-size: 1.65rem;">Progression livraison</div>
        <div class="fw-semibold" style="font-size: 1.65rem;">${pct}%</div>
      </div>

      <div class="progress-wrap" style="height: 30px;">
        <div class="progress" role="progressbar"
             aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"
             style="height: 100%;">
          <div class="progress-bar bg-success" style="width: ${pct}%"></div>
        </div>

        <i class="fa-solid fa-truck truck" style="left:${truckLeft}%; font-size: 32px;"></i>
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
      <div class="p-3 border-top bg-white text-muted" style="font-size: 1.8rem;">
        Confirmation client : aucun BL actif
      </div>
    `;
  }

  const pct = Math.max(0, Math.min(100, k.pct ?? 0));

  return `
    <div class="p-3 border-top bg-white">
      <div class="d-flex justify-content-between align-items-center mb-2">
        <div class="fw-semibold" style="font-size: 1.65rem;">Confirmation client</div>
        <div class="fw-semibold" style="font-size: 1.65rem;">${pct}%</div>
      </div>

      <div class="progress" role="progressbar"
           aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"
           style="height: 25px;">
        <div class="progress-bar bg-primary" style="width: ${pct}%"></div>
      </div>
    </div>
  `;
}

let allCards = [];
let currentCardIndex = 0;

function renderCard(card) {
  const header = `
    <div class="card-header">
      <div class="d-flex justify-content-between align-items-start">
        <div>
          <div class="fw-bold" style="font-size: 2.1rem;">
            ${esc(card.date)} - ${esc(card.area)}
          </div>
          <div class="text-muted" style="font-size: 1.7rem;">
            • ${esc(card.drivers)}
          </div>
        </div>
        <div class="d-flex align-items-center gap-2">
          <span class="badge text-bg-dark" style="font-size: 1.7rem; padding: 0.65rem 1.1rem;">
            Camion ${esc(card.truck)}
          </span>
          <span class="badge ${esc(card.status_badge_class || 'text-bg-secondary')}" style="font-size: 1.8rem; padding: 0.65rem 1.1rem;">
            ${esc(card.status_label)}
          </span>
        </div>
      </div>
    </div>
  `;

  const lines = (card.pickings || []).map(p => {
    const timeBadgeClass = p.time_badge_class || p.badge_class;
    const time = p.x_time_from
      ? `<span class="badge ${esc(timeBadgeClass)} me-3" style="font-size: 1.8rem; padding: 0.6rem 1rem;">${esc(p.x_time_from)}</span>`
      : "";
    const city = p.x_city ? `<span class="text-muted ms-2" style="font-size: 1.65rem;">• ${esc(p.x_city)}</span>` : "";
    const name = p.partner_name || "";
    const bl = p.name || "";

    return `
      <div class="list-group-item d-flex justify-content-between align-items-center ${esc(p.row_class)}">
        <div class="text-truncate flex-grow-1">
          ${time}
          <span class="fw-semibold" style="font-size: 1.8rem;">${esc(name)}</span>
          ${city}
        </div>
        <div class="ms-3 text-nowrap">
          <span class="badge text-bg-light border" style="font-size: 1.8rem; padding: 0.6rem 1rem;">${esc(bl)}</span>
        </div>
      </div>
    `;
  }).join("");

  const showDeliveryProgress = (card.status === "on_the_way");
  const showConfirmProgress  = (card.status === "open" || card.status === "full");

  const body = `
    <div class="card-body">
      <div class="list-group list-group-flush">
        ${lines || `<div class="list-group-item text-muted">Aucun BL</div>`}
      </div>
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

let lastRenderedCardIndex = null;

function displayCurrentCard() {
  const container = document.getElementById("deliveries_container");
  const navContainer = document.getElementById("nav_controls");

  if (!allCards.length) return;

  const card = allCards[currentCardIndex];

  // Vérifie si on change réellement de carte
  const isCardChanged = lastRenderedCardIndex !== currentCardIndex;

  // Créer le wrapper
  const newCardWrapper = document.createElement("div");
  newCardWrapper.className = "col-12";
  newCardWrapper.innerHTML = renderCard(card);

  // Vider et injecter dans le DOM
  container.innerHTML = "";
  container.appendChild(newCardWrapper);

  // Jouer l’animation uniquement si la carte change
  if (isCardChanged) {
    newCardWrapper.classList.add("card-fade");
    void newCardWrapper.offsetWidth;
    newCardWrapper.classList.add("show");
  }

  // Mettre à jour la référence
  lastRenderedCardIndex = currentCardIndex;

  // Mettre à jour le compteur
  navContainer.innerHTML =
    `<span class="text-muted mx-2" style="font-size: 1.65rem;">
      ${currentCardIndex + 1} / ${allCards.length}
     </span>`;
}


const shownextCard = () => {
  if (!allCards.length) return;
  
  if (currentCardIndex < allCards.length - 1) {
    currentCardIndex++;
  } else {
    currentCardIndex = 0;
  }

  displayCurrentCard();
};

refreshDeliveries();

// ✅ Rafraîchissement tous les 10s
setInterval(refreshDeliveries, 10000);

// ✅ Changement de slide tous les 15s (décalé pour éviter les conflits)
setInterval(shownextCard, 15000);