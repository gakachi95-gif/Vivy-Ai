/* ==========================================================================
   VIVY AI — service-worker.js
   Basic offline-first caching so the app shell loads instantly and works
   without a network connection. Bump CACHE_NAME whenever assets change to
   force a refresh.
   ========================================================================== */

const CACHE_NAME = "vivy-ai-cache-v1";

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

// Install: pre-cache the app shell
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch((err) => {
      console.warn("Service worker precache skipped some files:", err);
    })
  );
  self.skipWaiting();
});

// Activate: clean up old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

// Fetch: network-first for Firebase/API calls, cache-first for app shell
self.addEventListener("fetch", (event) => {
  const url = event.request.url;

  // Never intercept Firebase/Firestore/Auth/API calls — always go to network
  if (url.includes("googleapis.com") || url.includes("firebaseio.com") || url.includes("gstatic.com")) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          // Cache successful same-origin GET requests for future offline use
          if (event.request.method === "GET" && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match("./index.html"));
    })
  );
});
