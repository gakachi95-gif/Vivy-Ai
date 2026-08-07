/* ==========================================================================
   routes/payment.js
   Flutterwave payment verification + webhook.
   Currency: USD
   ========================================================================== */

const express = require("express");
const router = express.Router();
const fetch = require("node-fetch");

const { sendSuccess, sendError } = require("../utils/responses");
const firestoreService = require("../services/firestore");

/* --------------------------------------------------------------------------
   POST /verify-payment
   Body:
   {
     transaction_id,
     uid,
     purchaseType: "premium" | "credits",
     packId?,
     expectedAmount?
   }

   All prices come from the server-side pricing config.
   The client cannot change the amount or credits granted.

   Currency: USD
   -------------------------------------------------------------------------- */
router.post("/verify-payment", async (req, res) => {
  try {
    const {
      transaction_id,
      uid,
      purchaseType = "premium",
      packId,
      expectedAmount
    } = req.body;

    if (!transaction_id || !uid) {
      return sendError(res, "Missing transaction_id or uid.", 400);
    }

    // Ask Flutterwave directly whether this transaction really succeeded
    const flwRes = await fetch(
      `https://api.flutterwave.com/v3/transactions/${transaction_id}/verify`,
      {
        headers: {
          Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`
        }
      }
    );

    const flwData = await flwRes.json();

    if (
      flwData.status !== "success" ||
      flwData.data.status !== "successful"
    ) {
      return sendError(res, "Payment not verified as successful.", 400);
    }

    // Make sure the transaction was actually paid in USD
    if (flwData.data.currency && flwData.data.currency !== "USD") {
      return sendError(res, "Payment currency must be USD.", 400);
    }

    /* ----------------------------------------------------------------------
       CREDIT PURCHASE
       ---------------------------------------------------------------------- */
    if (purchaseType === "credits") {
      const pricing = await firestoreService.getPricingConfig();

      const pack = pricing.creditPacks.find(
        (p) => p.id === packId
      );

      if (!pack) {
        return sendError(res, "Unknown credit pack.", 400);
      }

      if (flwData.data.amount < pack.priceUSD) {
        return sendError(
          res,
          "Paid amount does not match the credit pack price.",
          400
        );
      }

      await firestoreService.addCredits(
        uid,
        pack.credits,
        `purchase:${pack.id}`
      );

      return sendSuccess(res, {
        message: `${pack.credits} credits added!`,
        creditsAdded: pack.credits
      });
    }

    /* ----------------------------------------------------------------------
       PREMIUM PURCHASE
       ---------------------------------------------------------------------- */

    const pricing = await firestoreService.getPricingConfig();

    const planType =
      req.body.planType === "yearly"
        ? "yearly"
        : "monthly";

    const expectedPrice =
      planType === "yearly"
        ? pricing.premiumYearlyUSD
        : pricing.premiumMonthlyUSD;

    const durationDays =
      planType === "yearly"
        ? 365
        : 30;

    if (flwData.data.amount < expectedPrice) {
      return sendError(
        res,
        "Paid amount does not match expected plan price.",
        400
      );
    }

    await firestoreService.upgradeToPremium(
      uid,
      transaction_id,
      durationDays
    );

    return sendSuccess(res, {
      message: `Upgraded to Premium (${planType})!`,
      durationDays
    });

  } catch (err) {
    console.error(
      "verify-payment error:",
      err.message
    );

    return sendError(
      res,
      "Server error verifying payment.",
      500
    );
  }
});

/* --------------------------------------------------------------------------
   POST /flutterwave-webhook

   Backup path:
   Flutterwave calls this server-to-server on payment events.

   Currency: USD
   -------------------------------------------------------------------------- */
router.post("/flutterwave-webhook", async (req, res) => {
  try {
    const signature =
      req.headers["verif-hash"];

    if (
      !signature ||
      signature !== process.env.FLW_WEBHOOK_HASH
    ) {
      return res
        .status(401)
        .send("Invalid signature");
    }

    const event = req.body;

    if (
      event.event === "charge.completed" &&
      event.data.status === "successful"
    ) {
      // Make sure the webhook payment was made in USD
      if (
        event.data.currency &&
        event.data.currency !== "USD"
      ) {
        return res
          .status(400)
          .send("Invalid payment currency");
      }

      const meta = event.data.meta || {};

      // Passed as "meta" when initiating checkout
      const uid = meta.uid;

      if (uid) {

        /* ------------------------------------------------------------------
           CREDIT PURCHASE
           ------------------------------------------------------------------ */
        if (
          meta.purchaseType === "credits" &&
          meta.packId
        ) {
          const pricing =
            await firestoreService.getPricingConfig();

          const pack =
            pricing.creditPacks.find(
              (p) => p.id === meta.packId
            );

          if (
            pack &&
            event.data.amount >= pack.priceUSD
          ) {
            await firestoreService.addCredits(
              uid,
              pack.credits,
              `webhook:purchase:${pack.id}`
            );
          }

        } else {

          /* ---------------------------------------------------------------
             PREMIUM PURCHASE
             --------------------------------------------------------------- */

          await firestoreService.upgradeToPremium(
            uid,
            String(event.data.id)
          );
        }
      }
    }

    res.status(200).send("ok");

  } catch (err) {
    console.error(
      "webhook error:",
      err.message
    );

    res.status(500).send("error");
  }
});

module.exports = router;
