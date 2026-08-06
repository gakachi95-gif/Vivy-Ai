/* ==========================================================================
   VIVY AI BACKEND — server.js
   --------------------------------------------------------------------------
   Thin entry point: wires up middleware, mounts every route module, and
   starts the server. All actual logic lives in routes/, providers/,
   middleware/, services/, and utils/.

   Architecture:
     GitHub Pages Frontend -> Render Backend (this) -> OpenRouter -> AI Model
                                        |
                                        +-> Flutterwave (payments)
                                        +-> Firestore (users, usage, plans)

   Required environment variables (set in Render Dashboard -> Environment):
     OPENROUTER_API_KEY        Your OpenRouter API key
     OPENROUTER_MODEL           e.g. anthropic/claude-sonnet-4
     ALLOWED_ORIGIN             Your GitHub Pages origin, e.g. https://you.github.io
     FLW_SECRET_KEY             Flutterwave secret key
     FLW_WEBHOOK_HASH            Random string, also set in Flutterwave webhook settings
     FIREBASE_SERVICE_ACCOUNT     Full service account JSON, as one string
     NODE_ENV                   "production" on Render
     FREE_DAILY_MESSAGES          e.g. 20
     PREMIUM_DAILY_MESSAGES         e.g. 1000
     MAX_TOKENS                 e.g. 1024
     TEMPERATURE                 e.g. 0.7

   Facebook/Instagram connect (Marketing Agent — Phase 2 social publishing):
     FACEBOOK_APP_ID            from your Meta for Developers app
     FACEBOOK_APP_SECRET        from the same app
     FACEBOOK_REDIRECT_URI      e.g. https://vivy-ai.onrender.com/auth/facebook/callback
     OAUTH_STATE_SECRET         any long random string
     FRONTEND_URL               e.g. https://yourusername.github.io/Vivy-Ai

   LinkedIn connect:
     LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET
     LINKEDIN_REDIRECT_URI      e.g. https://vivy-ai.onrender.com/auth/linkedin/callback

   Pinterest connect:
     PINTEREST_APP_ID, PINTEREST_APP_SECRET
     PINTEREST_REDIRECT_URI    e.g. https://vivy-ai.onrender.com/auth/pinterest/callback

   Tumblr connect:
     TUMBLR_CONSUMER_KEY, TUMBLR_CONSUMER_SECRET
     TUMBLR_REDIRECT_URI       e.g. https://vivy-ai.onrender.com/auth/tumblr/callback

   WordPress: no env vars needed — connects via user-supplied Application
   Password instead of OAuth (see routes/wordpress.js).

   Credit system / Marketing Agent billing:
     STARTER_CREDITS           free credits a new user starts with (default 200)
     ADMIN_UIDS                comma-separated Firebase UIDs allowed to hit
                                /admin/* routes (edit pricing/costs/limits)
   All credit costs, free-plan limits, and credit-pack prices are further
   editable live via PUT /admin/pricing — see services/firestore.js
   DEFAULT_PRICING for the fallback values used until that's ever edited.
   ========================================================================== */

require("dotenv").config();
const express = require("express");
const cors = require("cors");

const app = express();

// ---- Body parsing. Higher limit needed for base64 image-analysis payloads ----
app.use(express.json({ limit: "15mb" }));

// ---- CORS: only allow requests from the deployed frontend origin ----
const allowedOrigin = process.env.ALLOWED_ORIGIN || "*";
app.use(cors({ origin: allowedOrigin }));

// ---- Basic request timing log (never logs bodies/headers/keys) ----
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    console.log(`${req.method} ${req.path} -> ${res.statusCode} (${Date.now() - start}ms)`);
  });
  next();
});

// ---- Health check — confirms the service deployed correctly ----
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "vivy-ai-backend",
    model: process.env.OPENROUTER_MODEL || "not configured",
    env: process.env.NODE_ENV || "development"
  });
});

// ---- AI routes (all require Firebase auth + enforce daily limits) ----
app.use("/chat", require("./routes/chat"));
app.use("/writer", require("./routes/writer"));
app.use("/summarize", require("./routes/summarize"));
app.use("/translate", require("./routes/translate"));
app.use("/brainstorm", require("./routes/brainstorm"));
app.use("/image-analysis", require("./routes/imageAnalysis"));

// ---- Marketing Agent: Facebook/Instagram OAuth connect + publish ----
app.use("/auth", require("./routes/socialAuth"));
app.use("/publish", require("./routes/publish"));
app.use("/wordpress", require("./routes/wordpress"));
app.use("/marketing", require("./routes/marketing"));
app.use("/admin", require("./routes/admin"));

// ---- Payment routes (Flutterwave — unauthenticated by design, Flutterwave
//      calls the webhook server-to-server; verify-payment is called by the
//      frontend right after checkout and independently re-verifies with
//      Flutterwave before trusting anything) ----
app.use("/", require("./routes/payment"));

// ---- 404 fallback ----
app.use((req, res) => {
  res.status(404).json({ success: false, message: "Not found." });
});

// ---- Global error handler (catches anything that slipped past try/catch) ----
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err.message);
  res.status(500).json({ success: false, message: "Internal server error." });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Vivy AI backend running on port ${PORT} (model: ${process.env.OPENROUTER_MODEL || "not set"})`);
});
