/* ==========================================================================
   VIVY AI — service-worker.js
   Offline-first caching for the app shell. Uses NETWORK-FIRST for app
   files (HTML/CSS/JS) so a fresh deploy is always picked up immediately —
   the cache is only a fallback for when the network is unavailable, never
   the first choice. Bump CACHE_NAME whenever you want to force a full
   cache reset (e.g. after removing/renaming files in APP_SHELL).
   ========================================================================== */

const CACHE_NAME = "vivy-ai-cache-v4";

const APP_SHELL = [
  "./index.html",
  "./login.html",
  "./register.html",
  "./dashboard.html",
  "./chat.html",
  "./writer.html",
  "./summarizer.html",
  "./translator.html",
  "./brainstorm.html",
  "./image-analysis.html",
  "./history.html",
  "./settings.html",
  "./styles.css",
  "./utils.js",
  "./auth.js",
  "./chat.js",
  "./writer.js",
  "./firebase-config.js",
  "./manifest.json"
];

// Install: pre-cache the app shell (best-effort — a missing file shouldn't block install)
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch((err) => {
      console.warn("Service worker precache skipped some files:", err);
    })
  );
  self.skipWaiting();
});

// Activate: drop every cache that isn't the current version
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

// Fetch: network-first for same-origin app files, with cache as an offline fallback only.
// Anything cross-origin (Firebase, the chat API, Google Fonts, CDNs) is left completely
// alone — the browser handles those requests natively, no interception at all.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Only ever handle same-origin GET requests for our own app files.
  if (url.origin !== self.location.origin || event.request.method !== "GET") {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Fresh copy succeeded — use it, and update the cache for offline use later.
        if (response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() =>
        // Network failed (offline) — fall back to whatever we have cached.
        // Only fall back to index.html for actual page navigations, never
        // for scripts/styles, so a missing asset fails loudly instead of
        // silently swapping in the wrong content.
        caches.match(event.request).then((cached) => {
          if (cached) return cached;
          if (event.request.mode === "navigate") return caches.match("./index.html");
          return Response.error();
        })
      )
  );
});
￼Enter
