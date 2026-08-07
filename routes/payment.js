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
   Body: { transaction_id, uid, purchaseType: "premium" | "credits", packId?, expectedAmount? }
   For "credits" purchases, packId must match one of the live creditPacks in
   config/pricing — the credited amount and required price both come from
   that server-side config, never from the client, so a tampered request
   body can't grant free credits.
   -------------------------------------------------------------------------- */
router.post("/verify-payment", async (req, res) => {
  try {
    const { transaction_id, uid, purchaseType = "premium", packId, expectedAmount } = req.body;

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

    if (purchaseType === "credits") {
      const pricing = await firestoreService.getPricingConfig();
      const pack = pricing.creditPacks.find((p) => p.id === packId);
      if (!pack) return sendError(res, "Unknown credit pack.", 400);
      if (flwData.data.amount < pack.priceUSD) {
        return sendError(res, "Paid amount does not match the credit pack price.", 400);
      }

      const totalCredits = pack.credits + (pack.bonusCredits || 0);
      await firestoreService.addCredits(uid, totalCredits, `purchase:${pack.id}`);
      return sendSuccess(res, { message: `${totalCredits.toLocaleString()} coins added!`, creditsAdded: totalCredits });
    }

    const pricing = await firestoreService.getPricingConfig();
    const planType = req.body.planType === "yearly" ? "yearly" : "monthly";
    const expectedPrice = planType === "yearly" ? pricing.premiumYearlyUSD : pricing.premiumMonthlyUSD;
    const durationDays = planType === "yearly" ? 365 : 30;

    if (flwData.data.amount < expectedPrice) {
      return sendError(res, "Paid amount does not match expected plan price.", 400);
    }

    await firestoreService.upgradeToPremium(uid, transaction_id, durationDays);
    return sendSuccess(res, { message: `Upgraded to Premium (${planType})!`, durationDays });
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
      const meta = event.data.meta || {};
      const uid = meta.uid; // passed as "meta" when initiating checkout
      if (uid) {
        if (meta.purchaseType === "credits" && meta.packId) {
          const pricing = await firestoreService.getPricingConfig();
          const pack = pricing.creditPacks.find((p) => p.id === meta.packId);
          if (pack && event.data.amount >= pack.priceUSD) {
            const totalCredits = pack.credits + (pack.bonusCredits || 0);
            await firestoreService.addCredits(uid, totalCredits, `webhook:purchase:${pack.id}`);
          }
        } else {
          await firestoreService.upgradeToPremium(uid, String(event.data.id));
        }
      }
    }

    res.status(200).send("ok");
  } catch (err) {
    console.error("webhook error:", err.message);
    res.status(500).send("error");
  }
});

module.exports = router;
