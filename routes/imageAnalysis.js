/* ==========================================================================
   routes/imageAnalysis.js — POST /image-analysis
   Accepts: { imageBase64: string (data URL), question?: string }
   Returns: { success, reply, model, usage }

   NOTE: requires a vision-capable OPENROUTER_MODEL (e.g. anthropic/claude-
   sonnet-4, openai/gpt-5, google/gemini-2.5-pro). Text-only models will
   reject the image content block with a provider-level error.
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
    // base64 data URLs are large — allow up to ~12MB of encoded text
    imageBase64: { required: true, type: "string", maxLen: 12 * 1024 * 1024 },
    question: { required: false, type: "string", maxLen: 500 }
  }),
  enforceDailyLimit,
  async (req, res) => {
    try {
      const uid = req.uid;
      const { imageBase64, question } = req.validated;

      if (!imageBase64.startsWith("data:image/")) {
        return sendError(res, "imageBase64 must be a valid image data URL.", 400);
      }

      const result = await aiService.generate("imageAnalysis", { imageBase64, question });
      await firestoreService.incrementUsage(uid);

      return sendSuccess(res, { reply: result.reply, model: result.model, usage: result.usage });
    } catch (err) {
      console.error("POST /image-analysis error:", err.message);
      return sendError(res, "Failed to analyze image. Please try again.", 502);
    }
  }
);

module.exports = router;
