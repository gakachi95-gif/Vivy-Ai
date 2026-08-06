/* ==========================================================================
   routes/admin.js
   Admin API for editing pricing/limits without a redeploy. No admin UI
   page exists yet — this is the backend piece that one would call from
   (e.g. Postman, curl, or a future admin page). Protected by requireAdmin
   (ADMIN_UIDS allowlist env var).
   ========================================================================== */

const express = require("express");
const router = express.Router();

const { sendSuccess, sendError } = require("../utils/responses");
const { requireFirebaseAuth } = require("../middleware/auth");
const { requireAdmin } = require("../middleware/adminAuth");
const { getPricingConfig, updatePricingConfig } = require("../services/firestore");

router.use(requireFirebaseAuth, requireAdmin);

/** GET /admin/pricing — current live pricing config (or defaults if never edited). */
router.get("/pricing", async (req, res) => {
  try {
    const pricing = await getPricingConfig();
    return sendSuccess(res, { pricing });
  } catch (err) {
    console.error("GET /admin/pricing error:", err.message);
    return sendError(res, "Could not load pricing config.", 500);
  }
});

/**
 * PUT /admin/pricing — merges the given updates into the live config.
 * Body can include any subset of: costs, freePlanLimits, creditPacks,
 * premiumMonthlyNGN, premiumYearlyNGN.
 */
router.put("/pricing", async (req, res) => {
  try {
    const allowedKeys = ["costs", "freePlanLimits", "creditPacks", "premiumMonthlyNGN", "premiumYearlyNGN"];
    const updates = {};
    for (const key of allowedKeys) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    if (Object.keys(updates).length === 0) {
      return sendError(res, "No valid pricing fields provided.", 400);
    }

    const pricing = await updatePricingConfig(updates);
    return sendSuccess(res, { pricing });
  } catch (err) {
    console.error("PUT /admin/pricing error:", err.message);
    return sendError(res, "Could not update pricing config.", 500);
  }
});

module.exports = router;
