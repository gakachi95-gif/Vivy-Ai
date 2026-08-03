/* ==========================================================================
   VIVY AI — utils.js
   Shared helpers used across every page: notifications, form validation,
   sanitization, markdown rendering, theming, auth guarding, plan/usage
   limits and the AI request wrapper.
   ========================================================================== */

/* -----------------------------  NOTIFICATIONS  --------------------------- */
/**
 * Show a floating glass-style toast notification.
 * @param {"success"|"error"|"warning"|"info"} type
 * @param {string} message
 */
function showNotification(type, message) {
  let container = document.getElementById("notification-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "notification-container";
    document.body.appendChild(container);
  }

  const icons = {
    success: "check_circle",
    error: "error",
    warning: "warning",
    info: "info"
  };

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span class="material-icons toast-icon">${icons[type] || "info"}</span>
    <span class="toast-message"></span>
    <button class="toast-close" aria-label="Close">&times;</button>
  `;
  // Use textContent to avoid any HTML injection from dynamic messages
  toast.querySelector(".toast-message").textContent = message;

  toast.querySelector(".toast-close").addEventListener("click", () => toast.remove());
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add("toast-hide");
    setTimeout(() => toast.remove(), 300);
  }, 4200);
}

/* -----------------------------  SANITIZATION  ----------------------------- */
/** Escape HTML special characters to prevent XSS when injecting user text. */
function sanitizeInput(str = "") {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

/** Strip anything that isn't plain text/whitespace, trims length. */
function cleanText(str = "", maxLen = 8000) {
  return String(str).trim().slice(0, maxLen);
}

/* -----------------------------  MARKDOWN  --------------------------------- */
/**
 * Minimal, dependency-free markdown -> HTML converter (safe: escapes first).
 * Supports: **bold**, *italic*, `code`, ```code blocks```, # headings,
 * bullet lists, numbered lists, links, line breaks.
 */
function markdownToHtml(raw = "") {
  let text = sanitizeInput(raw);

  // Code blocks first (```...```)
  text = text.replace(/```([\s\S]*?)```/g, (_, code) => `<pre class="code-block"><code>${code.trim()}</code></pre>`);
  // Inline code
  text = text.replace(/`([^`]+)`/g, "<code>$1</code>");
  // Headings
  text = text.replace(/^### (.*$)/gim, "<h4>$1</h4>");
  text = text.replace(/^## (.*$)/gim, "<h3>$1</h3>");
  text = text.replace(/^# (.*$)/gim, "<h2>$1</h2>");
  // Bold / italic
  text = text.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/\*(.*?)\*/g, "<em>$1</em>");
  // Links [text](url)
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  // Bullet lists
  text = text.replace(/^\s*[-*] (.*)$/gim, "<li>$1</li>");
  text = text.replace(/(<li>[\s\S]*?<\/li>)/g, (m) => `<ul>${m}</ul>`);
  // Numbered lists
  text = text.replace(/^\s*\d+\. (.*)$/gim, "<li>$1</li>");
  // Line breaks (double newline = paragraph)
  text = text.replace(/\n\n/g, "<br><br>").replace(/\n/g, "<br>");

  return text;
}

/* -----------------------------  THEME  ------------------------------------ */
const VivyTheme = {
  KEY: "vivy_theme",
  init() {
    const saved = localStorage.getItem(this.KEY) || "dark";
    this.apply(saved);
  },
  apply(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(this.KEY, theme);
  },
  toggle() {
    const current = document.documentElement.getAttribute("data-theme");
    const next = current === "dark" ? "light" : "dark";
    this.apply(next);
    return next;
  }
};
VivyTheme.init();

/* -----------------------------  AUTH GUARD  -------------------------------- */
/**
 * Protects a page: redirects to login.html if no user is signed in.
 * Call at the top of every protected page. Resolves with the Firebase user.
 *
 * Uses auth.currentUser when Firebase has already restored the session
 * (fast path), and falls back to onAuthStateChanged (first load / cold start).
 * This prevents a stuck-at-loading bug caused by onAuthStateChanged firing
 * with null before Firebase has confirmed the cached session.
 */
function requireAuth() {
  return new Promise((resolve) => {
    // Fast path: Firebase has already restored the session synchronously.
    if (auth.currentUser) {
      resolve(auth.currentUser);
      return;
    }
    // Slow path: wait for Firebase to confirm the session (first load).
    const unsubscribe = auth.onAuthStateChanged((user) => {
      unsubscribe(); // only fire once — avoid memory leaks on navigation
      if (!user) {
        window.location.href = "login.html";
      } else {
        resolve(user);
      }
    });
  });
}

/** Redirects an already-logged-in user away from login/register pages. */
function redirectIfAuthed() {
  if (auth.currentUser) {
    window.location.href = "dashboard.html";
    return;
  }
  const unsubscribe = auth.onAuthStateChanged((user) => {
    unsubscribe();
    if (user) window.location.href = "dashboard.html";
  });
}

/* -----------------------------  USER / PLAN DATA  --------------------------- */
const VivyUser = {
  /** Fetch (or lazily create) the user's Firestore profile document. */
  async getProfile(uid) {
    const ref = db.collection("users").doc(uid);
    const snap = await ref.get();
    if (!snap.exists) {
      const defaults = {
        plan: "free",
        dailyUsed: 0,
        dailyDate: new Date().toISOString().slice(0, 10),
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      };
      await ref.set(defaults, { merge: true });
      return defaults;
    }
    return snap.data();
  },

  /** Resets the daily counter if the stored date isn't today. */
  async ensureDailyReset(uid) {
    const ref = db.collection("users").doc(uid);
    const profile = await this.getProfile(uid);
    const today = new Date().toISOString().slice(0, 10);
    if (profile.dailyDate !== today) {
      await ref.update({ dailyUsed: 0, dailyDate: today });
      profile.dailyUsed = 0;
      profile.dailyDate = today;
    }
    return profile;
  },

  /** Returns remaining messages for the day based on plan. */
  remaining(profile) {
    const limit = profile.plan === "premium" ? AI_CONFIG.premiumDailyLimit : AI_CONFIG.freeDailyLimit;
    if (limit === Infinity) return Infinity;
    return Math.max(0, limit - (profile.dailyUsed || 0));
  },

  /** Increments today's usage counter by 1. */
  async incrementUsage(uid) {
    await db.collection("users").doc(uid).update({
      dailyUsed: firebase.firestore.FieldValue.increment(1)
    });
  }
};

/* -----------------------------  AI SERVICE  --------------------------------- */
/**
 * Central AI request wrapper. All feature pages (chat, writer, summarizer,
 * translator, brainstorm, image-analysis) call VivyAI.generate() so the
 * provider/endpoint only needs to change in ONE place.
 *
 * Every task talks to its real backend route on Render, authenticated with
 * the current Firebase user's ID token:
 *   chat        -> POST /chat            { message, conversation }
 *   writer      -> POST /writer          { topic, format, tone }
 *   summarize   -> POST /summarize       { text }
 *   translate   -> POST /translate       { text, targetLang }
 *   brainstorm  -> POST /brainstorm      { topic, category }
 *   vision      -> POST /image-analysis  { imageBase64, question }
 *
 * Every route returns { success, reply, model, usage } on success, or
 * { success: false, message } on failure — generate() throws with that
 * message so the caller's catch block shows the real reason, not a generic
 * status code.
 */
const VIVY_API_BASE = "https://vivy-ai.onrender.com";

const VIVY_TASK_ENDPOINTS = {
  chat: "/chat",
  writer: "/writer",
  summarize: "/summarize",
  translate: "/translate",
  brainstorm: "/brainstorm",
  vision: "/image-analysis"
};

/** Builds the exact request body each backend route expects. */
function buildVivyRequestBody(task, prompt, meta, imageBase64) {
  switch (task) {
    case "chat":
      return { message: prompt, conversation: meta.conversation || [] };
    case "writer":
      return { topic: prompt, format: meta.format, tone: meta.tone };
    case "summarize":
      return { text: prompt };
    case "translate":
      return { text: prompt, targetLang: meta.targetLang };
    case "brainstorm":
      return { topic: prompt, category: meta.category };
    case "vision":
      return { imageBase64, question: prompt };
    default:
      throw new Error(`Unknown AI task: "${task}"`);
  }
}

const VivyAI = {
  /**
   * @param {Object} opts
   * @param {string} opts.task - "chat" | "writer" | "summarize" | "translate" | "brainstorm" | "vision"
   * @param {string} opts.prompt - the user's text prompt
   * @param {Object} [opts.meta] - extra structured params (tone, language, format, category, conversation...)
   * @param {string} [opts.imageBase64] - required for "vision" tasks
   * @returns {Promise<string>} the AI's text response
   */
  async generate({ task, prompt, meta = {}, imageBase64 = null }) {
    const endpoint = VIVY_TASK_ENDPOINTS[task];
    if (!endpoint) throw new Error(`Unknown AI task: "${task}"`);

    const user = firebase.auth().currentUser;
    if (!user) throw new Error("You must be signed in to use Vivy AI.");
    const token = await user.getIdToken();

    const res = await fetch(VIVY_API_BASE + endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify(buildVivyRequestBody(task, prompt, meta, imageBase64))
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data.success) {
      throw new Error(data.message || `AI service error: ${res.status}`);
    }

    return data.reply || "";
  }
};

/* -----------------------------  MISC HELPERS  -------------------------------- */
/** Debounce utility for search inputs etc. */
function debounce(fn, delay = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

/** Formats a Firestore Timestamp or Date into a readable string. */
function formatDate(ts) {
  const date = ts?.toDate ? ts.toDate() : new Date(ts);
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Generates a short random id (for local temp keys). */
function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

/* -----------------------------  BOTTOM NAV / SIDEBAR ACTIVE STATE ------------- */
/** Highlights the current page's nav link, based on file name. */
function highlightActiveNav() {
  const current = window.location.pathname.split("/").pop() || "dashboard.html";
  document.querySelectorAll("[data-nav-link]").forEach((link) => {
    if (link.getAttribute("href") === current) link.classList.add("active");
  });
}
document.addEventListener("DOMContentLoaded", highlightActiveNav);

