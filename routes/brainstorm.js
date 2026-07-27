/* ==========================================================================
   routes/brainstorm.js — POST /brainstorm
   Accepts: { topic: string, category?: string }
   Returns: { success, reply, model, usage }
   ========================================================================== */

const express = require("express");
const router = express.Router();

const { requireFirebaseAuth } = require("../middleware/auth");
const { enforceDailyLimit } = require("../middleware/rateLimit");
const { validateBody } = require("../middleware/validation");
const { sendSuccess, sendError } = require("../utils/responses");
const aiService = require("../providers/aiService");
const firestoreService = require("../services/firestore");

router.post(
  "/",
  requireFirebaseAuth,
  validateBody({
    topic: { required: true, type: "string", maxLen: 1000 },
    category: { required: false, type: "string", maxLen: 40 }
  }),
  enforceDailyLimit,
  async (req, res) => {
    try {
      const uid = req.uid;
      const { topic, category } = req.validated;

      const result = await aiService.generate("brainstorm", { topic, category });
      await firestoreService.incrementUsage(uid);

      return sendSuccess(res, { reply: result.reply, model: result.model, usage: result.usage });
    } catch (err) {
      console.error("POST /brainstorm error:", err.message);
      return sendError(res, "Failed to generate ideas. Please try again.", 502);
    }
  }
);

module.exports = router;
