/* ==========================================================================
   VIVY AI â€” utils.js
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
 * This prevents the stuck-at-loading bug caused by onAuthStateChanged firing
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
 * The "chat" task talks to the real Vivy backend
 * (POST https://vivy-ai.onrender.com/chat), authenticated with the current
 * Firebase user's ID token. There is no offline fallback for chat â€” if the
 * backend can't be reached, generate() throws so the caller can surface a
 * real error instead of a fake canned response.
 *
 * Other tasks (writer, summarize, translate, brainstorm, vision) don't have
 * a backend yet, so they still use the local offline demo generator.
 */
const VIVY_CHAT_ENDPOINT = "https://vivy-ai.onrender.com/chat";

const VivyAI = {
  /**
   * @param {Object} opts
   * @param {string} opts.task - e.g. "chat", "writer", "summarize", "translate", "brainstorm", "vision"
   * @param {string} opts.prompt - the user's text prompt
   * @param {Object} [opts.meta] - extra structured params (tone, language, format...)
   * @param {string} [opts.imageBase64] - optional base64 image for vision tasks
   * @returns {Promise<string>} the AI's text response
   */
  async generate({ task, prompt, meta = {}, imageBase64 = null }) {
    if (task === "chat") {
      return this._chat({ prompt, meta });
    }
    // ---- Offline / demo fallback for tasks with no live backend yet ----
    return this._offlineFallback({ task, prompt, meta, imageBase64 });
  },

  /** Calls the real chat backend, authenticated with the user's Firebase ID token. */
  async _chat({ prompt, meta = {} }) {
    const user = firebase.auth().currentUser;
    if (!user) throw new Error("You must be signed in to chat.");
    const token = await user.getIdToken();

    const res = await fetch(VIVY_CHAT_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({
        message: prompt,
        conversation: meta.conversation || []
      })
    });

    if (!res.ok) throw new Error("AI service error: " + res.status);

    const data = await res.json();
    if (!data.success) throw new Error("AI service returned an unsuccessful response.");
    return data.reply || "";
  },

  async _offlineFallback({ task, prompt, meta, imageBase64 }) {
    await new Promise((r) => setTimeout(r, 700 + Math.random() * 500)); // simulate latency
    const p = cleanText(prompt).slice(0, 160);
    switch (task) {
      case "writer":
        return `**${meta.format || "Content"} draft** (offline demo)\n\nTopic: ${p}\n\nThis is a placeholder draft showing formatting, tone (${meta.tone || "neutral"}) and structure. Connect a live AI endpoint to generate real long-form content here.`;
      case "summarize":
        return `**Short Summary**\n${p.slice(0, 90)}...\n\n**Bullet Points**\n- Key point one from your text\n- Key point two from your text\n- Key point three from your text\n\n**Key Ideas**\nThe main idea centers on the topic you pasted. Connect a live AI backend for a real summary.`;
      case "translate":
        return `[Offline demo translation to ${meta.targetLang || "target language"}]\n${p}`;
      case "brainstorm":
        return `**Ideas for ${meta.category || "your topic"}:**\n1. Idea inspired by "${p}" â€” angle A\n2. Idea inspired by "${p}" â€” angle B\n3. Idea inspired by "${p}" â€” angle C\n4. Idea inspired by "${p}" â€” angle D\n5. Idea inspired by "${p}" â€” angle E`;
      case "vision":
        return `**Image received.** Offline demo mode can't analyze pixels yet â€” connect a real vision-capable AI endpoint to get descriptions, OCR text, and Q&A about your uploaded image.`;
      default:
        return "AI response (offline demo mode).";
    }
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
document.addEventListener("DOMContentLoaded", highlightActiveNav); ==========================================================================
   VIVY AI â€” utils.js
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
 * This prevents the stuck-at-loading bug caused by onAuthStateChanged firing
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
