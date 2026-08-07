/* ==========================================================================
   VIVY AI — js/marketing-agent.js
   Page controller for pages/marketing-agent.html. Handles the auth guard,
   view switching between Dashboard / Calendar / Connected Accounts /
   Analytics, the "+ New Campaign" form, and the animated AI workflow.
   ========================================================================== */

let mktUser = null;
let mktAccess = null; // last result from GET /marketing/access
let mktCurrency = null; // "USD" | "NGN" — currently selected checkout currency

(async function initMarketingAgent() {
  mktUser = await requireAuth();
  VivyCalendar.init(mktUser.uid, refreshCalendarAndDashboard);

  document.querySelectorAll("[data-platform-checkbox]").forEach((cb) => {
    cb.addEventListener("change", updatePlatformSelectionUI);
  });

  try {
    mktAccess = await fetchMarketingAccess();
    mktCurrency = (mktAccess && mktAccess.currency) || FLW_CONFIG.defaultCurrency || "USD";
    renderCreditBalance();

    if (!mktAccess.hasAnyAccess) {
      renderCurrencyToggle();
      showPaywall();
      return; // don't bother loading dashboard data behind the paywall
    }

    await refreshCalendarAndDashboard();
    await renderConnectedAccounts();
  } catch (err) {
    console.error("Marketing Agent init error:", err);
    showNotification("error", err.message || "Couldn't load your Marketing Agent data. Check that your Firestore rules have been published.");
  }

  showView("dashboard");
  handleOAuthRedirectParams();
})();

/** Renders the USD/NGN toggle on the paywall and re-renders prices when it changes. */
function renderCurrencyToggle() {
  const container = document.getElementById("currency-toggle");
  if (!container) return;

  const currencies = (FLW_CONFIG.supportedCurrencies && FLW_CONFIG.supportedCurrencies.length)
    ? FLW_CONFIG.supportedCurrencies
    : ["USD", "NGN"];

  container.innerHTML = currencies
    .map(
      (c) => `
      <button
        type="button"
        class="btn ${c === mktCurrency ? "btn-primary" : "btn-outline"}"
        style="padding:4px 14px;margin:0 4px;font-size:13px;"
        onclick="setMktCurrency('${c}')"
      >${c}</button>`
    )
    .join("");

  renderPremiumButtonLabel();
  renderCreditPacks();
}

function setMktCurrency(currency) {
  mktCurrency = currency;
  renderCurrencyToggle();
}

function currencySymbol(currency) {
  return currency === "NGN" ? "₦" : "$";
}

function renderPremiumButtonLabel() {
  const btn = document.getElementById("premium-upgrade-btn");
  if (!btn || !mktAccess) return;
  const price = (mktAccess.premiumMonthly && mktAccess.premiumMonthly[mktCurrency]) || 0;
  btn.textContent = `Upgrade to Premium — ${currencySymbol(mktCurrency)}${price.toLocaleString()}/mo`;
}

/** Renders the credit-pack buttons on the paywall using live prices from the backend, in the selected currency. */
function renderCreditPacks() {
  const container = document.getElementById("credit-packs");
  const packs = mktAccess?.creditPacks || [];
  if (packs.length === 0) {
    container.innerHTML = `<p class="text-sm text-muted">Credit packs are being set up — try Premium instead for now.</p>`;
    return;
  }
  container.innerHTML = packs
    .map((p) => {
      const price = (p.price && p.price[mktCurrency]) || 0;
      const disabled = !price || price <= 0;
      return `
      <button class="btn btn-outline" style="width:100%;margin-bottom:8px;" ${disabled ? "disabled" : ""}
        onclick="purchaseCredits('${p.id}', ${p.credits}, ${price}, '${mktCurrency}')">
        ${p.credits.toLocaleString()} credits — ${disabled ? "unavailable in " + mktCurrency : currencySymbol(mktCurrency) + price.toLocaleString()}
      </button>`;
    })
    .join("");
}

/** Buys a credit pack via Flutterwave checkout, then verifies server-side and refreshes the balance. */
function purchaseCredits(packId, credits, amount, currency) {
  FlutterwaveCheckout({
    public_key: FLW_CONFIG.publicKey,
    tx_ref: "vivy-credits-" + mktUser.uid + "-" + Date.now(),
    amount,
    currency,
    payment_options: "card,mobilemoney,ussd",
    customer: { email: mktUser.email, name: mktUser.displayName || "Vivy User" },
    meta: { uid: mktUser.uid, purchaseType: "credits", packId },
    customizations: {
      title: "Vivy AI Credits",
      description: `${credits} credits for the Marketing Agent`,
      logo: "../icons/icon-192.png"
    },
    callback: async function (response) {
      if (response.status !== "successful" && response.status !== "completed") return;
      try {
        const res = await fetch(FLW_CONFIG.verifyEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            transaction_id: response.transaction_id,
            uid: mktUser.uid,
            purchaseType: "credits",
            packId
          })
        });
        const data = await res.json().catch(() => ({}));
        if (!data.success) throw new Error(data.message || "Could not verify payment.");

        showNotification("success", data.message || "Credits added!");
        await refreshCreditBalance();
        if (mktAccess.hasAnyAccess) {
          await refreshCalendarAndDashboard();
          await renderConnectedAccounts();
          showView("dashboard");
        }
      } catch (err) {
        showNotification("error", err.message || "Could not verify payment. Contact support if you were charged.");
      }
    },
    onclose: function () {}
  });
}
async function fetchMarketingAccess() {
  const token = await mktUser.getIdToken();
  const res = await fetch(`${VIVY_API_BASE}/marketing/access`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) throw new Error(data.message || "Could not load account status.");
  return data;
}

async function refreshCreditBalance() {
  mktAccess = await fetchMarketingAccess();
  renderCreditBalance();
}

function renderCreditBalance() {
  const el = document.getElementById("credit-balance");
  if (!el || !mktAccess) return;
  el.textContent = mktAccess.plan === "premium" ? "Premium ✨" : `${mktAccess.credits} credits`;
}

/** Shows the paywall view — used when the user has no premium and no credits. */
function showPaywall() {
  showView("paywall");

  const balance = mktAccess?.credits ?? 0;
  document.getElementById("paywall-message").textContent =
    balance > 0
      ? `You have ${balance} credits — not quite enough for this. Buy more, or go unlimited with Premium.`
      : "The Marketing Agent runs on credits or a Premium plan. Get started with either below.";

  renderCurrencyToggle(); // also refreshes credit packs + premium button label for the current currency
}

/** Reads ?connected=facebook or ?connect_error=... left by the backend's OAuth callback redirect. */
function handleOAuthRedirectParams() {
  const params = new URLSearchParams(window.location.search);
  const connected = params.get("connected");
  const error = params.get("connect_error");

  if (connected) {
    showNotification("success", `${VivyCampaigns.PLATFORM_LABELS[connected] || connected} connected!`);
    renderConnectedAccounts();
  } else if (error) {
    const messages = {
      no_pages: "No Facebook Pages found on that account. You need to manage at least one Page to connect.",
      server_error: "Something went wrong connecting Facebook. Please try again.",
      missing_params: "The connection request was incomplete. Please try again."
    };
    showNotification("error", messages[error] || "Facebook connection was cancelled or failed.");
  }

  if (connected || error) {
    // Clean the query string so a page refresh doesn't re-trigger the toast.
    window.history.replaceState(null, "", window.location.pathname);
  }
}

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
  renderDuePosts(posts);

  window._mktCampaigns = campaigns;
  window._mktPosts = posts;
}

/** Posts scheduled for today or earlier that haven't been published yet. */
function getDuePosts(posts) {
  const today = new Date().toISOString().slice(0, 10);
  return posts.filter((p) => p.status === "scheduled" && p.date <= today);
}

function renderDuePosts(posts) {
  const due = getDuePosts(posts);
  const section = document.getElementById("due-posts-section");
  const list = document.getElementById("due-posts-list");

  if (due.length === 0) {
    section.style.display = "none";
    return;
  }

  section.style.display = "block";
  list.innerHTML = due
    .map(
      (p) => `
      <div class="card post-card">
        <div class="post-card-head">
          <span class="material-icons post-platform-icon">${VivyCalendar.PLATFORM_ICONS[p.platform] || "public"}</span>
          <span class="post-platform-name">${sanitizeInput(VivyCampaigns.PLATFORM_LABELS[p.platform] || p.platform)}</span>
          <span class="post-status status-scheduled">${p.date}</span>
        </div>
        <p class="post-caption">${sanitizeInput(p.caption).slice(0, 140)}${p.caption.length > 140 ? "…" : ""}</p>
        <div class="post-actions">
          <button class="btn btn-primary" style="flex:1;" onclick="VivyCalendar.copyToClipboard('${p.campaignId}','${p.id}')"><span class="material-icons">content_paste</span> Copy & Post</button>
        </div>
      </div>`
    )
    .join("");

  notifyDuePosts(due.length);
}

/** Best-effort browser notification while the tab is open/backgrounded — not a background push. */
let _notifiedDueCount = 0;
async function notifyDuePosts(count) {
  if (!("Notification" in window) || count === 0 || count === _notifiedDueCount) return;
  _notifiedDueCount = count;

  if (Notification.permission === "default") {
    await Notification.requestPermission();
  }
  if (Notification.permission === "granted") {
    new Notification("Vivy AI Marketing Agent", {
      body: `You have ${count} post${count > 1 ? "s" : ""} ready to publish today. Open the app to copy and post them.`,
      icon: "../icons/icon-192.png"
    });
  }
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

function openAutoPilot() {
  document.getElementById("autopilot-form").reset();
  showView("autopilot");
}

document.getElementById("autopilot-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const goal = cleanText(document.getElementById("autopilot-goal").value, 200);
  if (!goal) return;

  // AutoPilot publishes across whatever the user has actually connected —
  // falls back to a sensible default set inside runAutoPilot if nothing's connected yet.
  const accounts = await VivyMarketing.getConnectedAccounts(mktUser.uid);
  const connectedPlatforms = Object.keys(accounts).filter((p) => accounts[p].connected);

  showView("workflow");
  renderWorkflowSteps();

  try {
    const { posts } = await VivyCampaigns.runAutoPilot(
      mktUser.uid,
      { goal, connectedPlatforms },
      (stepIndex) => updateWorkflowStep(stepIndex),
      (done, total) => updateWorkflowProgress(done, total)
    );
    showNotification("success", `AutoPilot built a 30-day campaign with ${posts.length} posts!`);
    await refreshCalendarAndDashboard();
    await refreshCreditBalance();
    showView("calendar");
  } catch (err) {
    if (err.code === "INSUFFICIENT_CREDITS" || err.code === "PREMIUM_REQUIRED" || err.code === "PLAN_LIMIT_REACHED") {
      showNotification("warning", err.message);
      showPaywall();
    } else {
      showNotification("error", err.message || "AutoPilot failed. Please try again.");
      showView("dashboard");
    }
  }
});

function openCampaignForm() {
  if (mktAccess && mktAccess.plan !== "premium") {
    const max = mktAccess.freePlanLimits.maxCampaigns;
    if (mktAccess.campaignCount >= max) {
      showNotification("warning", `Free accounts are limited to ${max} campaigns. Upgrade to Premium for unlimited campaigns.`);
      showPaywall();
      return;
    }
  }
  document.getElementById("campaign-form").reset();
  updatePlatformSelectionUI();
  showView("campaign-form");
}

/** Upgrades to Premium via Flutterwave — same flow as settings.html's upgrade button. */
function upgradeToPremiumFromMarketing() {
  const currency = mktCurrency || (mktAccess && mktAccess.currency) || FLW_CONFIG.defaultCurrency || "USD";
  const price =
    (mktAccess?.premiumMonthly && mktAccess.premiumMonthly[currency]) ||
    (currency === "NGN" ? FLW_CONFIG.premiumPriceNGN : FLW_CONFIG.premiumPriceUSD);

  if (!price || price <= 0) {
    showNotification("error", `Premium is not available in ${currency} right now.`);
    return;
  }

  FlutterwaveCheckout({
    public_key: FLW_CONFIG.publicKey,
    tx_ref: "vivy-" + mktUser.uid + "-" + Date.now(),
    amount: price,
    currency,
    payment_options: "card,mobilemoney,ussd",
    customer: { email: mktUser.email, name: mktUser.displayName || "Vivy User" },
    meta: { uid: mktUser.uid, purchaseType: "premium", planType: "monthly" },
    customizations: {
      title: "Vivy AI Premium",
      description: "Unlimited campaigns, credits, and connected accounts",
      logo: "../icons/icon-192.png"
    },
    callback: async function (response) {
      if (response.status !== "successful" && response.status !== "completed") return;
      try {
        const res = await fetch(FLW_CONFIG.verifyEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            transaction_id: response.transaction_id,
            uid: mktUser.uid,
            purchaseType: "premium",
            planType: "monthly"
          })
        });
        const data = await res.json().catch(() => ({}));
        if (!data.success) throw new Error(data.message || "Could not verify payment.");

        showNotification("success", "You're on Premium! Enjoy unlimited access.");
        await refreshCreditBalance();
        await refreshCalendarAndDashboard();
        await renderConnectedAccounts();
        showView("dashboard");
      } catch (err) {
        showNotification("error", err.message || "Could not verify payment. Contact support if you were charged.");
      }
    },
    onclose: function () {}
  });
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
    const { posts } = await VivyCampaigns.runWorkflow(
      mktUser.uid,
      form,
      (stepIndex) => updateWorkflowStep(stepIndex),
      (done, total) => updateWorkflowProgress(done, total)
    );
    showNotification("success", `Campaign generated with ${posts.length} posts!`);
    await refreshCalendarAndDashboard();
    await refreshCreditBalance();
    showView("calendar");
  } catch (err) {
    if (err.code === "INSUFFICIENT_CREDITS" || err.code === "PREMIUM_REQUIRED" || err.code === "PLAN_LIMIT_REACHED") {
      showNotification("warning", err.message);
      showPaywall();
    } else {
      showNotification("error", err.message || "Campaign generation failed. Please try again.");
      showView("dashboard");
    }
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
  document.getElementById("workflow-progress-text").textContent = "";
}

/** Shows real "X of Y days done" progress during the batched generation step. */
function updateWorkflowProgress(done, total) {
  document.getElementById("workflow-progress-text").textContent = `${done} of ${total} days generated…`;
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
  const icons = { facebook: "thumb_up", instagram: "photo_camera", linkedin: "work", x: "tag", pinterest: "push_pin", threads: "forum", wordpress: "rss_feed" };
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
  const OAUTH_PLATFORMS = ["facebook", "instagram", "linkedin", "pinterest", "tumblr"];

  if (OAUTH_PLATFORMS.includes(platform)) {
    // Facebook and Instagram share one OAuth flow (Instagram links automatically
    // via the connected Facebook Page), so both route through /auth/facebook/*.
    const authPlatform = platform === "instagram" ? "facebook" : platform;

    if (!connect) {
      const label = platform === "instagram" ? "Facebook and Instagram" : VivyCampaigns.PLATFORM_LABELS[platform];
      if (!confirm(`Disconnect ${label}?`)) return;
      try {
        const token = await mktUser.getIdToken();
        const res = await fetch(`${VIVY_API_BASE}/auth/${authPlatform}/disconnect`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` }
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) throw new Error(data.message || "Disconnect failed.");
        showNotification("success", "Disconnected.");
        await renderConnectedAccounts();
      } catch (err) {
        showNotification("error", err.message || "Could not disconnect. Please try again.");
      }
      return;
    }

    // Connecting is a full-page redirect to that platform's consent screen, so we
    // pass the Firebase ID token as a query param — the backend verifies it
    // before minting a signed state and handing off to the platform.
    const token = await mktUser.getIdToken();
    window.location.href = `${VIVY_API_BASE}/auth/${authPlatform}/start?idToken=${encodeURIComponent(token)}`;
    return;
  }

  if (platform === "wordpress") {
    if (!connect) {
      if (!confirm("Disconnect WordPress?")) return;
      try {
        const token = await mktUser.getIdToken();
        const res = await fetch(`${VIVY_API_BASE}/wordpress/disconnect`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` }
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) throw new Error(data.message || "Disconnect failed.");
        showNotification("success", "Disconnected.");
        await renderConnectedAccounts();
      } catch (err) {
        showNotification("error", err.message || "Could not disconnect. Please try again.");
      }
      return;
    }
    document.getElementById("wordpress-connect-modal").style.display = "flex";
    return;
  }

  // Phase 1: UI-only placeholder for the remaining platforms (X, Threads). Real
  // OAuth follows the same pattern as Facebook/LinkedIn/Pinterest/Tumblr above
  // whenever you're ready to add them.
  await VivyMarketing.setAccountConnected(mktUser.uid, platform, connect, connect ? `@your-${platform}-handle` : "");
  showNotification("info", connect
    ? `${VivyCampaigns.PLATFORM_LABELS[platform]} marked as connected (demo — real login coming soon).`
    : `${VivyCampaigns.PLATFORM_LABELS[platform]} disconnected.`);
  await renderConnectedAccounts();
}

/** Submits the WordPress connect form (Application Password credentials, not OAuth). */
async function saveWordPressConnect() {
  const siteUrl = cleanText(document.getElementById("wp-site-url").value, 200);
  const username = cleanText(document.getElementById("wp-username").value, 100);
  const applicationPassword = document.getElementById("wp-app-password").value.trim();

  if (!siteUrl || !username || !applicationPassword) {
    showNotification("warning", "Please fill in all three fields.");
    return;
  }

  try {
    const token = await mktUser.getIdToken();
    const res = await fetch(`${VIVY_API_BASE}/wordpress/connect`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
      body: JSON.stringify({ siteUrl, username, applicationPassword })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) throw new Error(data.message || "Connection failed.");

    document.getElementById("wordpress-connect-modal").style.display = "none";
    showNotification("success", "WordPress connected!");
    await renderConnectedAccounts();
  } catch (err) {
    showNotification("error", err.message || "Could not connect to WordPress.");
  }
}

/* -----------------------------  ANALYTICS  ------------------------------- */
async function loadAnalytics() {
  const campaigns = window._mktCampaigns || (await VivyMarketing.getCampaigns(mktUser.uid));
  const posts = window._mktPosts || (await VivyMarketing.getAllPosts(mktUser.uid));
  await VivyAnalytics.render(campaigns, posts);
}

/** Calls the credit-gated Growth Coach endpoint with real stats from the user's actual posts. */
async function runGrowthCoach() {
  const posts = window._mktPosts || [];
  const stats = VivyAnalytics.computeGrowthStats(posts);

  if (!stats) {
    showNotification("info", "Generate a campaign first so there's real data to analyze.");
    return;
  }

  const btn = document.getElementById("growth-coach-btn");
  btn.disabled = true;
  document.getElementById("growth-coach-tips").innerHTML = "";

  try {
    const token = await mktUser.getIdToken();
    const res = await fetch(`${VIVY_API_BASE}/marketing/growth-coach`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ stats })
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data.success) {
      const err = new Error(data.message || "Failed to get advice.");
      err.code = data.code;
      throw err;
    }

    document.getElementById("growth-coach-tips").innerHTML = data.tips
      .map((tip) => `<div class="suggestion-card"><span class="material-icons">lightbulb</span><p class="text-sm">${sanitizeInput(tip)}</p></div>`)
      .join("");

    await refreshCreditBalance();
  } catch (err) {
    if (err.code === "INSUFFICIENT_CREDITS" || err.code === "PREMIUM_REQUIRED") {
      showNotification("warning", err.message);
      showPaywall();
    } else {
      showNotification("error", err.message || "Failed to get advice. Please try again.");
    }
  } finally {
    btn.disabled = false;
  }
}
