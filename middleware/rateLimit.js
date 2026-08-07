/* ==========================================================================
   middleware/rateLimit.js

   Enforces each user's daily AI message allowance (Free vs Premium)
   using Firestore as the source of truth.

   Runs after authentication so req.uid is already available.
   Attaches req.userProfile so downstream routes do not need to
   fetch the profile again.
   ========================================================================== */

const firestoreService = require("../services/firestore");
const { sendError } = require("../utils/responses");

async function enforceDailyLimit(req, res, next) {
  try {
    const profile = await firestoreService.ensureDailyReset(req.uid);

    if (!firestoreService.hasRemainingMessages(profile)) {
      const limit = firestoreService.limitForPlan(profile.plan);

      return sendError(
        res,
        `Daily AI limit reached (${limit}/day on the ${profile.plan} plan). Upgrade to Premium for more.`,
        429,
        {
          limitReached: true,
          plan: profile.plan
        }
      );
    }

    req.userProfile = profile;

    return next();
  } catch (err) {
    console.error(
      "Rate limit check failed:",
      err.message
    );

    return sendError(
      res,
      "Could not verify your usage limits right now.",
      500
    );
  }
}

module.exports = {
  enforceDailyLimit
};
