/* ==========================================================================
   middleware/credits.js
   Gates a route behind "premium OR enough credits", and deducts credits
   atomically on success. Must run AFTER requireFirebaseAuth (needs req.uid).

   Usage: router.post("/generate-caption", requireFirebaseAuth, requireCredits("generateCaption"), handler)
   ========================================================================== */

const { sendError } = require("../utils/responses");
const { getUserProfile, getPricingConfig, canAfford, deductCredits, isPremiumActive } = require("../services/firestore");

function requireCredits(featureKey) {
  return async (req, res, next) => {
    try {
      const [profile, pricing] = await Promise.all([getUserProfile(req.uid), getPricingConfig()]);
      const cost = pricing.costs[featureKey];

      if (cost === undefined) {
        console.error(`requireCredits: unknown featureKey "${featureKey}" — no cost configured.`);
        return sendError(res, "This feature isn't configured yet.", 500);
      }

      if (!canAfford(profile, cost)) {
        const balance = profile.credits || 0;
        const message = balance === 0
          ? "You're out of coins."
          : `You're out of coins for this — it costs 🪙 ${cost}, you have 🪙 ${balance}.`;
        return sendError(res, message, 402, {
          code: "INSUFFICIENT_CREDITS",
          required: cost,
          balance: profile.credits || 0
        });
      }

      // Deduct now (transactional — safe against concurrent requests). If the
      // AI call itself fails after this, the credit is still spent, same as
      // how daily message limits already work for chat/writer/etc. in this app.
      await deductCredits(req.uid, cost, featureKey);
      req.creditCost = cost;
      next();
    } catch (err) {
      console.error("requireCredits error:", err.message);
      return sendError(res, "Could not verify your credit balance. Please try again.", 500);
    }
  };
}

/** Enforces free-plan limits (max campaigns, max connected accounts, autopilot access). */
function requirePlanLimit(limitKey, currentCountFn) {
  return async (req, res, next) => {
    try {
      const [profile, pricing] = await Promise.all([getUserProfile(req.uid), getPricingConfig()]);
      if (isPremiumActive(profile)) return next(); // unlimited

      const limits = pricing.freePlanLimits;

      if (limitKey === "autopilotEnabled" || limitKey === "autoPublishEnabled" || limitKey === "analyticsEnabled") {
        if (!limits[limitKey]) {
          return sendError(res, "This feature requires Premium.", 402, { code: "PREMIUM_REQUIRED" });
        }
        return next();
      }

      const max = limits[limitKey];
      const current = await currentCountFn(req.uid);
      if (current >= max) {
        return sendError(res, `Free accounts are limited to ${max}. Upgrade to Premium for unlimited access.`, 402, {
          code: "PLAN_LIMIT_REACHED",
          limit: max,
          current
        });
      }
      next();
    } catch (err) {
      console.error("requirePlanLimit error:", err.message);
      return sendError(res, "Could not verify your plan limits. Please try again.", 500);
    }
  };
}

module.exports = { requireCredits, requirePlanLimit };
