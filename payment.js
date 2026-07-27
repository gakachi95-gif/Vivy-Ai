/* ==========================================================================
   routes/payment.js
   Flutterwave payment verification + webhook. Behavior is unchanged from
   the original server.js — only relocated here to keep server.js thin.
   ========================================================================== */

const express = require("express");
const router = express.Router();
const fetch = require("node-fetch");

const { sendSuccess, sendError } = require("../utils/responses");
const firestoreService = require("../services/firestore");

/* --------------------------------------------------------------------------
   POST /verify-payment
   Body: { transaction_id: string, uid: string, expectedAmount: number }
   -------------------------------------------------------------------------- */
router.post("/verify-payment", async (req, res) => {
  try {
    const { transaction_id, uid, expectedAmount } = req.body;

    if (!transaction_id || !uid) {
      return sendError(res, "Missing transaction_id or uid.", 400);
    }

    // Ask Flutterwave directly whether this transaction really succeeded
    const flwRes = await fetch(
      `https://api.flutterwave.com/v3/transactions/${transaction_id}/verify`,
      { headers: { Authorization: `Bearer ${process.env.FLW_SECRET_KEY}` } }
    );
    const flwData = await flwRes.json();

    if (flwData.status !== "success" || flwData.data.status !== "successful") {
      return sendError(res, "Payment not verified as successful.", 400);
    }

    // Guard against amount tampering — reject if paid amount is less than expected
    if (expectedAmount && flwData.data.amount < expectedAmount) {
      return sendError(res, "Paid amount does not match expected plan price.", 400);
    }

    await firestoreService.upgradeToPremium(uid, transaction_id);

    return sendSuccess(res, { message: "Upgraded to Premium!" });
  } catch (err) {
    console.error("verify-payment error:", err.message);
    return sendError(res, "Server error verifying payment.", 500);
  }
});

/* --------------------------------------------------------------------------
   POST /flutterwave-webhook
   Backup path: Flutterwave calls this server-to-server on payment events.
   -------------------------------------------------------------------------- */
router.post("/flutterwave-webhook", async (req, res) => {
  try {
    const signature = req.headers["verif-hash"];
    if (!signature || signature !== process.env.FLW_WEBHOOK_HASH) {
      return res.status(401).send("Invalid signature");
    }

    const event = req.body;
    if (event.event === "charge.completed" && event.data.status === "successful") {
      const uid = event.data.meta?.uid; // passed as "meta" when initiating checkout
      if (uid) {
        await firestoreService.upgradeToPremium(uid, String(event.data.id));
      }
    }

    res.status(200).send("ok");
  } catch (err) {
    console.error("webhook error:", err.message);
    res.status(500).send("error");
  }
});

module.exports = router;
