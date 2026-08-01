/* ==========================================================================
   VIVY AI — js/marketing-agent.js
   Page controller for pages/marketing-agent.html. Handles the auth guard,
   view switching between Dashboard / Calendar / Connected Accounts /
   Analytics, the "+ New Campaign" form, and the animated AI workflow.
   ========================================================================== */

let mktUser = null;

(async function initMarketingAgent() {
  mktUser = await requireAuth();
  VivyCalendar.init(mktUser.uid, refreshCalendarAndDashboard);

  document.querySelectorAll("[data-platform-checkbox]").forEach((cb) => {
    cb.addEventListener("change", updatePlatformSelectionUI);
  });

  await refreshCalendarAndDashboard();
  await renderConnectedAccounts();
  showView("dashboard");
})();

/* -----------------------------  VIEW SWITCHING  ------------------------------- */
function showView(name) {
  document.querySelectorAll("[data-view]").forEach((el) => {
    el.style.display = el.dataset.view === name ? "block" : "none";
  });
  document.querySelectorAll("[data-nav-tab]").forEach((el) => {
    el.classList.toggle("active", el.dataset.navTab === name);
  });
  if (name === "analytics") loadAnalytics();
}

/* -----------------------------  DASHBOARD + CALENDAR  ------------------------------- */
async function refreshCalendarAndDashboard() {
  const [campaigns, posts] = await Promise.all([
    VivyMarketing.getCampaigns(mktUser.uid),
    VivyMarketing.getAllPosts(mktUser.uid)
  ]);

  // Dashboard summary cards
  document.getElementById("dash-active-campaigns").textContent = campaigns.filter((c) => c.status === "active").length;
  document.getElementById("dash-scheduled-posts").textContent = posts.filter((p) => p.status === "scheduled").length;
  document.getElementById("dash-published-posts").textContent = posts.filter((p) => p.status === "published").length;
  document.getElementById("dash-drafts").textContent = posts.filter((p) => p.status === "draft").length;

  renderCampaignList(campaigns);
  VivyCalendar.render(document.getElementById("calendar-container"), posts);

  window._mktCampaigns = campaigns;
  window._mktPosts = posts;
}

function renderCampaignList(campaigns) {
  const el = document.getElementById("campaign-list");
  if (campaigns.length === 0) {
    el.innerHTML = `<div class="empty-state"><span class="material-icons">campaign</span><p>No campaigns yet. Create your first one below.</p></div>`;
    return;
  }
  el.innerHTML = campaigns
    .map(
      (c) => `
      <div class="card campaign-card">
        <div class="campaign-card-head">
          <div class="campaign-card-title">${sanitizeInput(c.name)}</div>
          <span class="post-status status-${c.status}">${c.status}</span>
        </div>
        <p class="text-sm text-muted">${sanitizeInput(c.businessName)} · ${c.days} days · ${(c.platforms || []).length} platforms</p>
        <button class="btn btn-outline mt-8" onclick="deleteCampaign('${c.id}')"><span class="material-icons">delete</span> Delete Campaign</button>
      </div>`
    )
    .join("");
}

async function deleteCampaign(campaignId) {
  if (!confirm("Delete this campaign and all its posts? This can't be undone.")) return;
  await VivyMarketing.deleteCampaign(mktUser.uid, campaignId);
  showNotification("success", "Campaign deleted.");
  await refreshCalendarAndDashboard();
}

/* -----------------------------  CAMPAIGN FORM  ------------------------------- */
function updatePlatformSelectionUI() {
  document.querySelectorAll("[data-platform-checkbox]").forEach((cb) => {
    cb.closest(".platform-chip").classList.toggle("selected", cb.checked);
  });
}

function openCampaignForm() {
  document.getElementById("campaign-form").reset();
  updatePlatformSelectionUI();
  showView("campaign-form");
}

document.getElementById("campaign-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();

  const platforms = Array.from(document.querySelectorAll("[data-platform-checkbox]:checked")).map((cb) => cb.value);
  if (platforms.length === 0) {
    showNotification("warning", "Select at least one platform.");
    return;
  }

  const form = {
    name: cleanText(document.getElementById("campaign-name").value, 100),
    businessName: cleanText(document.getElementById("business-name").value, 100),
    businessDescription: cleanText(document.getElementById("business-description").value, 1000),
    targetAudience: cleanText(document.getElementById("target-audience").value, 500),
    goal: cleanText(document.getElementById("campaign-goal").value, 300),
    platforms,
    days: parseInt(document.getElementById("campaign-days").value, 10)
  };

  if (!form.name || !form.businessName || !form.businessDescription || !form.targetAudience || !form.goal) {
    showNotification("warning", "Please fill in every field before generating your campaign.");
    return;
  }

  showView("workflow");
  renderWorkflowSteps();

  try {
    const { posts } = await VivyCampaigns.runWorkflow(mktUser.uid, form, (stepIndex) => {
      updateWorkflowStep(stepIndex);
    });
    showNotification("success", `Campaign generated with ${posts.length} posts!`);
    await refreshCalendarAndDashboard();
    showView("calendar");
  } catch (err) {
    showNotification("error", err.message || "Campaign generation failed. Please try again.");
    showView("dashboard");
  }
});

/* -----------------------------  WORKFLOW ANIMATION  ------------------------------- */
function renderWorkflowSteps() {
  const container = document.getElementById("workflow-steps");
  container.innerHTML = VivyCampaigns.WORKFLOW_STEPS.map(
    (step, i) => `
      <div class="workflow-step" id="wf-step-${i}">
        <div class="wf-dot"><span class="material-icons wf-check">check</span><span class="wf-spinner"></span></div>
        <div class="wf-label">${step.label}</div>
      </div>`
  ).join("");
}

function updateWorkflowStep(activeIndex) {
  VivyCampaigns.WORKFLOW_STEPS.forEach((_, i) => {
    const el = document.getElementById(`wf-step-${i}`);
    if (!el) return;
    el.classList.remove("active", "done");
    if (i < activeIndex) el.classList.add("done");
    else if (i === activeIndex) el.classList.add("active");
  });
}

/* -----------------------------  CONNECTED ACCOUNTS  ------------------------------- */
async function renderConnectedAccounts() {
  const accounts = await VivyMarketing.getConnectedAccounts(mktUser.uid);
  const icons = { facebook: "thumb_up", instagram: "photo_camera", linkedin: "work", x: "tag", pinterest: "push_pin", threads: "forum" };
  const container = document.getElementById("accounts-container");

  container.innerHTML = VivyMarketing.DEFAULT_PLATFORMS.map((platform) => {
    const acc = accounts[platform];
    const label = VivyCampaigns.PLATFORM_LABELS[platform] || platform;
    return `
      <div class="card account-card">
        <div class="qc-icon"><span class="material-icons">${icons[platform] || "public"}</span></div>
        <div class="account-info">
          <div class="account-name">${label}</div>
          <div class="account-status ${acc.connected ? "text-success" : "text-muted"}">${acc.connected ? "Connected" : "Not connected"}</div>
        </div>
        <button class="btn ${acc.connected ? "btn-outline" : "btn-primary"}" onclick="toggleAccount('${platform}', ${!acc.connected})">
          ${acc.connected ? "Disconnect" : "Connect"}
        </button>
      </div>`;
  }).join("");
}

async function toggleAccount(platform, connect) {
  // Phase 1: UI-only placeholder. Real OAuth flow per platform is a Phase 2 integration —
  // this just records the intended state so the UI and Firestore schema are ready for it.
  await VivyMarketing.setAccountConnected(mktUser.uid, platform, connect, connect ? `@your-${platform}-handle` : "");
  showNotification("info", connect
    ? `${VivyCampaigns.PLATFORM_LABELS[platform]} marked as connected (demo — real login coming in Phase 2).`
    : `${VivyCampaigns.PLATFORM_LABELS[platform]} disconnected.`);
  await renderConnectedAccounts();
}

/* -----------------------------  ANALYTICS  ------------------------------- */
async function loadAnalytics() {
  const campaigns = window._mktCampaigns || (await VivyMarketing.getCampaigns(mktUser.uid));
  const posts = window._mktPosts || (await VivyMarketing.getAllPosts(mktUser.uid));
  await VivyAnalytics.render(campaigns, posts);
}
