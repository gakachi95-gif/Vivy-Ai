/* ==========================================================================
   routes/summarize.js — POST /summarize
   Accepts: { text: string }
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
    text: { required: true, type: "string", maxLen: 12000 }
  }),
  enforceDailyLimit,
  async (req, res) => {
    try {
      const uid = req.uid;
      const { text } = req.validated;

      const result = await aiService.generate("summarize", { text });
      await firestoreService.incrementUsage(uid);

      return sendSuccess(res, { reply: result.reply, model: result.model, usage: result.usage });
    } catch (err) {
      console.error("POST /summarize error:", err.message);
      return sendError(res, "Failed to summarize text. Please try again.", 502);
    }
  }
);

module.exports = router;
