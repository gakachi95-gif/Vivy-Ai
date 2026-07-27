/* ==========================================================================
   routes/chat.js — POST /chat
   Accepts: { message: string, conversation?: Array<{role, text}>, uid: string }
   Returns: { success, reply, model, usage, remaining }
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
    message: { required: true, type: "string", maxLen: 6000 },
    conversation: { required: false, type: "array", maxItems: 40 }
  }),
  enforceDailyLimit,
  async (req, res) => {
    try {
      // uid always comes from the verified token, never trusted from the body
      const uid = req.uid;
      const { message, conversation } = req.validated;

      const result = await aiService.generate("chat", { message, conversation });

      await firestoreService.incrementUsage(uid);

      return sendSuccess(res, {
        reply: result.reply,
        model: result.model,
        usage: result.usage
      });
    } catch (err) {
      console.error("POST /chat error:", err.message);
      return sendError(res, "Failed to generate a response. Please try again.", 502);
    }
  }
);

module.exports = router;
