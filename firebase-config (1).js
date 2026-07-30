/* ==========================================================================
   FIREBASE CONFIG — Vivy AI
   --------------------------------------------------------------------------
   Replace the values below with your own Firebase project credentials.
   Get them from: Firebase Console -> Project Settings -> General -> Your apps
   This project uses the Firebase COMPAT SDK (loaded via <script> tags in
   every HTML page) so it can run with zero build tools, directly on
   GitHub Pages.
   ========================================================================== */

const firebaseConfig = {
  apiKey: "AIzaSyDjcjJf7dIyYLbxYrX5r2oXwpgSUr7gkLA",
  authDomain: "vivylive-62c7d.firebaseapp.com",
  projectId: "vivylive-62c7d",
  storageBucket: "vivylive-62c7d.firebasestorage.app",
  messagingSenderId: "279820446345",
  appId: "1:279820446345:web:a806cbad950d720a463458"
};
// Initialize Firebase (compat mode — works with plain <script> tags, no bundler)
firebase.initializeApp(firebaseConfig);

// Shared references used across every page
const auth = firebase.auth();
const db = firebase.firestore();
const storage = firebase.storage();

// Analytics is optional — only initialize if supported (avoids errors on
// browsers/environments that block it, e.g. some in-app browsers).
let analytics = null;
try {
  if (firebase.analytics && firebase.analytics.isSupported) {
    firebase.analytics.isSupported().then((supported) => {
      if (supported) analytics = firebase.analytics();
    });
  }
} catch (e) {
  console.warn("Analytics not available:", e.message);
}

/* --------------------------------------------------------------------------
   AI PROVIDER CONFIG
   --------------------------------------------------------------------------
   Vivy AI never calls an AI provider with a secret key directly from the
   browser (that would leak the key to every visitor). Instead, all AI
   requests are sent to AI_ENDPOINT — a small serverless/cloud function
   (Firebase Cloud Function, Cloudflare Worker, Vercel Edge Function, etc.)
   that holds the real API key server-side and forwards the request to your
   AI provider of choice (OpenAI, Anthropic, Gemini...).

   Until you deploy that function, Vivy AI automatically falls back to a
   local "offline mode" so every screen in this app is still fully usable
   and demoable — see ai-fallback logic inside utils.js -> VivyAI.
   ========================================================================== */
const AI_CONFIG = {
  endpoint: "https://vivy-ai.onrender.com",
  enabled: true,
  freeDailyLimit: 20,
  premiumDailyLimit: Infinity
};

/* --------------------------------------------------------------------------
   FLUTTERWAVE PAYMENT CONFIG
   --------------------------------------------------------------------------
   publicKey is safe to expose in the browser (that's how Flutterwave's
   inline checkout is designed to work). The SECRET key must only ever live
   on the backend (see vivy-ai-backend/server.js) — never put it here.
   ========================================================================== */
const FLW_CONFIG = {
  publicKey: "FLWPUBK_TEST-xxxxxxxxxxxxxxxxxxxxxxxxx-X", // <-- your Flutterwave PUBLIC key
  verifyEndpoint: "https://vivy-ai-backend.onrender.com/verify-payment", // <-- your Render backend URL
  premiumPriceNGN: 2500, // set your actual premium price
  currency: "NGN"
};
