/* ==========================================================================
   routes/writer.js — POST /writer
   Accepts: { topic: string, format?: string, tone?: string }
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
    topic: { required: true, type: "string", maxLen: 2000 },
    format: { required: false, type: "string", maxLen: 60 },
    tone: { required: false, type: "string", maxLen: 40 }
  }),
  enforceDailyLimit,
  async (req, res) => {
    try {
      const uid = req.uid;
      const { topic, format, tone } = req.validated;

      const result = await aiService.generate("writer", { topic, format, tone });
      await firestoreService.incrementUsage(uid);

      return sendSuccess(res, { reply: result.reply, model: result.model, usage: result.usage });
    } catch (err) {
      console.error("POST /writer error:", err.message);
      return sendError(res, "Failed to generate content. Please try again.", 502);
    }
  }
);

module.exports = router;
