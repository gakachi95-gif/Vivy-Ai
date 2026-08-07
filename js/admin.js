/* ==========================================================================
   VIVY AI — js/admin.js
   Page controller for pages/admin.html. Loads the live pricing config from
   GET /admin/pricing, renders it as editable fields, and saves changes via
   PUT /admin/pricing. Access is enforced entirely server-side (ADMIN_UIDS
   allowlist) — this page just shows "access denied" gracefully if the
   backend rejects the request, it doesn't attempt its own access check.
   ========================================================================== */

let adminUser = null;
let pricing = null;

const COST_LABELS = {
  generateCaption: "Generate Caption",
  generateImage: "Generate Image",
  generateBlog: "Generate Blog",
  analyzeMarketing: "Analyze Marketing (AutoPilot step 1)",
  generateCampaign: "Generate Campaign (per batch)",
  autopilotCampaign: "AutoPilot Campaign",
  growthCoach: "Growth Coach Advice"
};

const LIMIT_LABELS = {
  maxCampaigns: "Max Campaigns (free plan)",
  maxConnectedAccounts: "Max Connected Accounts (free plan)",
  autopilotEnabled: "AutoPilot Enabled (1 = on, 0 = off)",
  autoPublishEnabled: "Auto-Publish Enabled (1 = on, 0 = off)",
  analyticsEnabled: "Analytics Enabled (1 = on, 0 = off)"
};

(async function initAdmin() {
  adminUser = await requireAuth();

  try {
    const token = await adminUser.getIdToken();
    const res = await fetch(`${VIVY_API_BASE}/admin/pricing`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    const data = await res.json().catch(() => ({}));

    if (res.status === 403) {
      document.getElementById("access-denied").style.display = "block";
      return;
    }

    if (!res.ok || !data.success) {
      throw new Error(data.message || "Could not load pricing.");
    }

    pricing = data.pricing;

    document.getElementById("admin-content").style.display = "block";

    renderAll();
  } catch (err) {
    showNotification("error", err.message || "Could not load admin data.");
  }
})();

function renderAll() {
  renderNumberFields("costs-card", pricing.costs, COST_LABELS);
  renderLimitFields();
  renderPriceFields();
  renderPacks();
  renderMilestones();
}

function renderNumberFields(containerId, obj, labels) {
  const container = document.getElementById(containerId);

  container.innerHTML = Object.keys(labels)
    .map(
      (key) => `
      <div class="admin-row">
        <label>${labels[key]}</label>
        <input
          class="form-input"
          type="number"
          min="0"
          data-cost-key="${key}"
          value="${obj[key] ?? 0}"
        >
      </div>`
    )
    .join("");
}

function renderLimitFields() {
  const container = document.getElementById("limits-card");
  const limits = pricing.freePlanLimits;

  container.innerHTML = Object.keys(LIMIT_LABELS)
    .map((key) => {
      const isBool = typeof limits[key] === "boolean";
      const value = isBool
        ? (limits[key] ? 1 : 0)
        : (limits[key] ?? 0);

      return `
      <div class="admin-row">
        <label>${LIMIT_LABELS[key]}</label>
        <input
          class="form-input"
          type="number"
          min="0"
          data-limit-key="${key}"
          data-is-bool="${isBool}"
          value="${value}"
        >
      </div>`;
    })
    .join("");
}

function renderPriceFields() {
  document.getElementById("prices-card").innerHTML = `
    <div class="admin-row">
      <label>Premium Monthly — USD ($)</label>
      <input
        class="form-input"
        type="number"
        min="0"
        step="0.01"
        id="price-monthly-usd"
        value="${pricing.premiumMonthly?.USD ?? 0}"
      >
    </div>

    <div class="admin-row">
      <label>Premium Monthly — NGN (₦)</label>
      <input
        class="form-input"
        type="number"
        min="0"
        step="1"
        id="price-monthly-ngn"
        value="${pricing.premiumMonthly?.NGN ?? 0}"
      >
    </div>

    <div class="admin-row">
      <label>Premium Yearly — USD ($)</label>
      <input
        class="form-input"
        type="number"
        min="0"
        step="0.01"
        id="price-yearly-usd"
        value="${pricing.premiumYearly?.USD ?? 0}"
      >
    </div>

    <div class="admin-row">
      <label>Premium Yearly — NGN (₦)</label>
      <input
        class="form-input"
        type="number"
        min="0"
        step="1"
        id="price-yearly-ngn"
        value="${pricing.premiumYearly?.NGN ?? 0}"
      >
    </div>
  `;
}

function renderPacks() {
  document.getElementById("packs-list").innerHTML = pricing.creditPacks
    .map(
      (p, i) => `
      <div class="pack-row" data-pack-index="${i}">
        <input
          class="form-input"
          placeholder="id"
          value="${p.id}"
          data-pack-field="id"
        >

        <input
          class="form-input"
          type="number"
          min="0"
          placeholder="credits"
          value="${p.credits}"
          data-pack-field="credits"
        >

        <input
          class="form-input"
          type="number"
          min="0"
          step="0.01"
          placeholder="price USD"
          value="${p.price?.USD ?? 0}"
          data-pack-field="priceUSD"
        >

        <input
          class="form-input"
          type="number"
          min="0"
          step="1"
          placeholder="price NGN"
          value="${p.price?.NGN ?? 0}"
          data-pack-field="priceNGN"
        >

        <button
          class="btn-icon"
          onclick="removePackRow(${i})"
        >
          <span class="material-icons">delete</span>
        </button>
      </div>`
    )
    .join("");
}

function addPackRow() {
  pricing.creditPacks.push({
    id: `pack_${Date.now()}`,
    credits: 100,
    price: { USD: 1, NGN: 1500 }
  });

  renderPacks();
}

function removePackRow(i) {
  pricing.creditPacks.splice(i, 1);
  renderPacks();
}

function renderMilestones() {
  document.getElementById("milestones-list").innerHTML =
    pricing.referralMilestones
      .map(
        (m, i) => `
      <div class="milestone-row" data-milestone-index="${i}">
        <input
          class="form-input"
          type="number"
          placeholder="referral count"
          value="${m.count}"
          data-milestone-field="count"
        >

        <input
          class="form-input"
          placeholder="credits or premiumDays"
          value="${m.rewardType}"
          data-milestone-field="rewardType"
        >

        <input
          class="form-input"
          type="number"
          placeholder="amount"
          value="${m.amount}"
          data-milestone-field="amount"
        >

        <button
          class="btn-icon"
          onclick="removeMilestoneRow(${i})"
        >
          <span class="material-icons">delete</span>
        </button>
      </div>`
      )
      .join("");
}

function addMilestoneRow() {
  pricing.referralMilestones.push({
    count: 10,
    rewardType: "credits",
    amount: 100
  });

  renderMilestones();
}

function removeMilestoneRow(i) {
  pricing.referralMilestones.splice(i, 1);
  renderMilestones();
}

/**
 * Reads every input back into the pricing object,
 * then saves via PUT /admin/pricing.
 */
async function savePricing() {
  // AI feature costs
  document.querySelectorAll("[data-cost-key]").forEach((el) => {
    pricing.costs[el.dataset.costKey] =
      parseInt(el.value, 10) || 0;
  });

  // Free plan limits
  document.querySelectorAll("[data-limit-key]").forEach((el) => {
    const raw = parseInt(el.value, 10) || 0;

    pricing.freePlanLimits[el.dataset.limitKey] =
      el.dataset.isBool === "true"
        ? raw === 1
        : raw;
  });

  // Premium pricing — both currencies
  pricing.premiumMonthly = {
    USD: parseFloat(document.getElementById("price-monthly-usd").value) || 0,
    NGN: parseFloat(document.getElementById("price-monthly-ngn").value) || 0
  };

  pricing.premiumYearly = {
    USD: parseFloat(document.getElementById("price-yearly-usd").value) || 0,
    NGN: parseFloat(document.getElementById("price-yearly-ngn").value) || 0
  };

  // Credit packs
  document.querySelectorAll("[data-pack-index]").forEach((row) => {
    const i = parseInt(row.dataset.packIndex, 10);
    if (!pricing.creditPacks[i].price) pricing.creditPacks[i].price = {};

    row.querySelectorAll("[data-pack-field]").forEach((el) => {
      const field = el.dataset.packField;

      if (field === "id") {
        pricing.creditPacks[i][field] = el.value;
      } else if (field === "priceUSD") {
        pricing.creditPacks[i].price.USD = parseFloat(el.value) || 0;
      } else if (field === "priceNGN") {
        pricing.creditPacks[i].price.NGN = parseFloat(el.value) || 0;
      } else {
        pricing.creditPacks[i][field] =
          parseInt(el.value, 10) || 0;
      }
    });
  });

  // Referral milestones
  document.querySelectorAll("[data-milestone-index]").forEach((row) => {
    const i = parseInt(row.dataset.milestoneIndex, 10);

    row.querySelectorAll("[data-milestone-field]").forEach((el) => {
      const field = el.dataset.milestoneField;

      pricing.referralMilestones[i][field] =
        field === "rewardType"
          ? el.value
          : parseInt(el.value, 10) || 0;
    });
  });

  try {
    const token = await adminUser.getIdToken();

    const res = await fetch(`${VIVY_API_BASE}/admin/pricing`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(pricing)
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data.success) {
      throw new Error(data.message || "Save failed.");
    }

    pricing = data.pricing;

    showNotification("success", "Pricing config saved.");

    renderAll();
  } catch (err) {
    showNotification(
      "error",
      err.message || "Could not save changes."
    );
  }
}
