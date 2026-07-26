/* ==========================================================================
   VIVY AI BACKEND — server.js
   --------------------------------------------------------------------------
   Small Express server deployed on Render. Two jobs only:
   1. POST /verify-payment — called by the frontend right after a Flutterwave
      checkout completes. Re-verifies the transaction directly with
      Flutterwave's server (never trusts the browser) using your SECRET key,
      then marks the user's Firestore doc as plan:'premium'.
   2. POST /flutterwave-webhook — Flutterwave also calls this directly as a
      backup, in case the user closes the tab right after paying. Verifies
      the webhook signature before trusting it.

   Environment variables required (set these in the Render dashboard, never
   commit them to git):
     FLW_SECRET_KEY         Your Flutterwave secret key (sk_live_... / sk_test_...)
     FLW_WEBHOOK_HASH        A secret string YOU choose, also entered in the
                             Flutterwave dashboard webhook settings, used to
                             verify webhook calls really came from Flutterwave
     FIREBASE_SERVICE_ACCOUNT  The full JSON of your Firebase service account
                             key, as a single-line string (see README-deploy.md)
     ALLOWED_ORIGIN          Your deployed frontend origin, e.g.
                             https://kachi95-gif.github.io  (for CORS)
   ========================================================================== */

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const admin = require("firebase-admin");

const app = express();
app.use(express.json());

// ---- CORS: only allow requests from your deployed frontend ----
const allowedOrigin = process.env.ALLOWED_ORIGIN || "*";
app.use(cors({ origin: allowedOrigin }));

// ---- Initialize Firebase Admin SDK from the service account env var ----
if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}
const db = admin.firestore();

// Health check — useful to confirm Render deployed correctly
app.get("/", (req, res) => {
  res.json({ status: "ok", service: "vivy-ai-backend" });
});

/* --------------------------------------------------------------------------
   POST /verify-payment
   Body: { transaction_id: string, uid: string, expectedAmount: number }
   -------------------------------------------------------------------------- */
app.post("/verify-payment", async (req, res) => {
  try {
    const { transaction_id, uid, expectedAmount } = req.body;

    if (!transaction_id || !uid) {
      return res.status(400).json({ success: false, message: "Missing transaction_id or uid." });
    }

    // Ask Flutterwave directly whether this transaction really succeeded
    const flwRes = await fetch(
      `https://api.flutterwave.com/v3/transactions/${transaction_id}/verify`,
      { headers: { Authorization: `Bearer ${process.env.FLW_SECRET_KEY}` } }
    );
    const flwData = await flwRes.json();

    if (flwData.status !== "success" || flwData.data.status !== "successful") {
      return res.status(400).json({ success: false, message: "Payment not verified as successful." });
    }

    // Guard against amount tampering — reject if paid amount is less than expected
    if (expectedAmount && flwData.data.amount < expectedAmount) {
      return res.status(400).json({ success: false, message: "Paid amount does not match expected plan price." });
    }

    // All good — upgrade the user to Premium
    await db.collection("users").doc(uid).update({
      plan: "premium",
      premiumSince: admin.firestore.FieldValue.serverTimestamp(),
      lastPaymentRef: transaction_id
    });

    return res.json({ success: true, message: "Upgraded to Premium!" });
  } catch (err) {
    console.error("verify-payment error:", err);
    return res.status(500).json({ success: false, message: "Server error verifying payment." });
  }
});

/* --------------------------------------------------------------------------
   POST /flutterwave-webhook
   Backup path: Flutterwave calls this server-to-server on payment events.
   -------------------------------------------------------------------------- */
app.post("/flutterwave-webhook", async (req, res) => {
  try {
    const signature = req.headers["verif-hash"];
    if (!signature || signature !== process.env.FLW_WEBHOOK_HASH) {
      return res.status(401).send("Invalid signature");
    }

    const event = req.body;
    if (event.event === "charge.completed" && event.data.status === "successful") {
      const uid = event.data.meta?.uid; // we pass uid as "meta" when initiating checkout
      if (uid) {
        await db.collection("users").doc(uid).update({
          plan: "premium",
          premiumSince: admin.firestore.FieldValue.serverTimestamp(),
          lastPaymentRef: String(event.data.id)
        });
      }
    }

    res.status(200).send("ok");
  } catch (err) {
    console.error("webhook error:", err);
    res.status(500).send("error");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Vivy AI backend running on port ${PORT}`));
