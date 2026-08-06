/* ==========================================================================
   routes/referrals.js
   GET  /referrals/me     — your referral code, link, and progress
   POST /referrals/apply  — links a newly-registered account to whoever
                             referred them (called once, right after signup)
   ========================================================================== */

const express = require("express");
const router = express.Router();

const { sendSuccess, sendError } = require("../utils/responses");
const { requireFirebaseAuth } = require("../middleware/auth");
const { getUserProfile, getPricingConfig, applyReferralCode, processReferralActivation } = require("../services/firestore");

router.use(requireFirebaseAuth);

router.get("/me", async (req, res) => {
  try {
    // Same fraud-prevention checkpoint as /marketing/access — cheap to
    // re-run here too since this page is exactly where a user checks their progress.
    await processReferralActivation(req.uid, req.firebaseUser.email_verified);

    const [profile, pricing] = await Promise.all([getUserProfile(req.uid), getPricingConfig()]);
    const frontendUrl = (process.env.FRONTEND_URL || "").replace(/\/$/, "");

    const nextMilestone = pricing.referralMilestones
      .filter((m) => !(profile.referralMilestonesGranted || []).includes(m.count))
      .sort((a, b) => a.count - b.count)[0] || null;

    return sendSuccess(res, {
      referralCode: profile.referralCode,
      referralLink: frontendUrl ? `${frontendUrl}/register.html?ref=${profile.referralCode}` : null,
      referralCount: profile.referralCount || 0,
      milestones: pricing.referralMilestones,
      milestonesGranted: profile.referralMilestonesGranted || [],
      nextMilestone
    });
  } catch (err) {
    console.error("GET /referrals/me error:", err.message);
    return sendError(res, "Could not load referral info.", 500);
  }
});

router.post("/apply", async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return sendError(res, "A referral code is required.", 400);

    await applyReferralCode(req.uid, code);
    return sendSuccess(res, { message: "Referral linked!" });
  } catch (err) {
    console.error("POST /referrals/apply error:", err.message);
    return sendError(res, err.message || "Could not apply referral code.", 400);
  }
});

module.exports = router;
