/* ==========================================================================
   routes/marketing.js
   Every AI action inside the Marketing Agent goes through here instead of
   the shared /writer route, so it can be credit-gated independently of the
   free-to-use standalone Writer tool. Also exposes /marketing/access, a
   cheap read-only endpoint the frontend calls on page load to decide
   whether to show the dashboard or a paywall.
   ========================================================================== */

const express = require("express");
const router = express.Router();

const { sendSuccess, sendError } = require("../utils/responses");
const { requireFirebaseAuth } = require("../middleware/auth");
const { requireCredits, requirePlanLimit } = require("../middleware/credits");
const { generate } = require("../providers/aiService");
const {
  getUserProfile,
  isPremiumActive,
  processReferralActivation,
  getPricingConfig,
  getCampaignCount,
  getConnectedAccountCount
} = require("../services/firestore");

router.use(requireFirebaseAuth);

/**
 * GET /marketing/access
 * Read-only summary the frontend uses to decide what to show: current
 * credit balance, plan, live pricing/costs, and free-plan usage so far.
 * No credits are spent just by checking this.
 */
router.get("/access", async (req, res) => {
  try {
    // Fraud-prevention checkpoint: only counts a referral once the referred
    // user genuinely shows up here with a verified email — can't be spoofed
    // since email_verified comes from Firebase's own signed token, not the client.
    await processReferralActivation(req.uid, req.firebaseUser.email_verified);

    const [profile, pricing, campaignCount, connectedAccountCount] = await Promise.all([
      getUserProfile(req.uid),
      getPricingConfig(),
      getCampaignCount(req.uid),
      getConnectedAccountCount(req.uid)
    ]);
    const premiumActive = isPremiumActive(profile);

    return sendSuccess(res, {
      plan: premiumActive ? "premium" : "free",
      premiumUntil: profile.premiumUntil ? profile.premiumUntil.toDate().toISOString() : null,
      credits: profile.credits || 0,
      costs: pricing.costs,
      freePlanLimits: pricing.freePlanLimits,
      creditPacks: pricing.creditPacks,
      premiumMonthlyNGN: pricing.premiumMonthlyNGN,
      premiumYearlyNGN: pricing.premiumYearlyNGN,
      campaignCount,
      connectedAccountCount,
      hasAnyAccess: premiumActive || (profile.credits || 0) > 0
    });
  } catch (err) {
    console.error("GET /marketing/access error:", err.message);
    return sendError(res, "Could not load your account status.", 500);
  }
});

/**
 * POST /marketing/generate-batch
 * Used by the campaign workflow to generate a batch of days' worth of
 * posts. Charged once per batch call (each is a real AI request).
 * Body: { topic, format, tone } — same shape the /writer route accepts.
 */
router.post(
  "/generate-batch",
  requirePlanLimit("maxCampaigns", getCampaignCount),
  requireCredits("generateCampaign"),
  async (req, res) => {
    try {
      const { topic, format, tone } = req.body;
      if (!topic) return sendError(res, "A topic/prompt is required.", 400);

      const result = await generate("writer", { topic, format, tone });
      return sendSuccess(res, { reply: result.reply, creditsSpent: req.creditCost });
    } catch (err) {
      console.error("POST /marketing/generate-batch error:", err.message);
      return sendError(res, "Failed to generate content. Your credits were not spent for this failed attempt.", 502);
    }
  }
);

/**
 * POST /marketing/generate-caption
 * A single caption/post for one platform — the cheaper, smaller unit
 * (e.g. for a "regenerate this one post" action, separate from a full
 * campaign batch).
 */
router.post("/generate-caption", requireCredits("generateCaption"), async (req, res) => {
  try {
    const { topic, format, tone } = req.body;
    if (!topic) return sendError(res, "A topic/prompt is required.", 400);
    const result = await generate("writer", { topic, format, tone });
    return sendSuccess(res, { reply: result.reply, creditsSpent: req.creditCost });
  } catch (err) {
    console.error("POST /marketing/generate-caption error:", err.message);
    return sendError(res, "Failed to generate a caption.", 502);
  }
});

/**
 * POST /marketing/analyze
 * Business/audience analysis — a lighter-weight AI call than a full
 * campaign, used by AutoPilot's first step.
 */
router.post("/analyze", requireCredits("analyzeMarketing"), async (req, res) => {
  try {
    const { topic } = req.body;
    if (!topic) return sendError(res, "A topic is required.", 400);
    const result = await generate("writer", {
      topic: `Analyze this business/goal for a marketing campaign and summarize target audience, tone, and content angles in 4-6 sentences: ${topic}`,
      format: "marketing analysis",
      tone: "professional"
    });
    return sendSuccess(res, { reply: result.reply, creditsSpent: req.creditCost });
  } catch (err) {
    console.error("POST /marketing/analyze error:", err.message);
    return sendError(res, "Failed to analyze. Please try again.", 502);
  }
});

/**
 * POST /marketing/generate-image
 * STUBBED — no image-generation AI provider is wired up yet (this backend
 * currently only calls text models via OpenRouter). This route exists so
 * the credit cost and the API shape are already correct for when a real
 * image model (e.g. Flux/SDXL via OpenRouter) gets added — it intentionally
 * returns an honest "not available yet" error rather than pretending to work.
 */
router.post("/generate-image", async (req, res) => {
  return sendError(res, "AI image generation isn't connected yet — this is a placeholder endpoint for a future update. No credits were charged.", 501);
});

/**
 * POST /marketing/growth-coach
 * Body: { stats: { totalPosts, platformBreakdown, avgCaptionLength,
 *                   avgHashtagsPerPost, postsPerWeek, daysSinceFirstPost } }
 * The frontend computes these stats from the user's own real post data
 * (it already has it loaded) and sends the summary — the backend never
 * fabricates numbers, and explicitly tells the AI not to invent engagement
 * metrics we don't actually track (no real click/like data exists yet).
 */
router.post("/growth-coach", requireCredits("growthCoach"), async (req, res) => {
  try {
    const { stats } = req.body;
    if (!stats || typeof stats !== "object") {
      return sendError(res, "Post statistics are required.", 400);
    }

    const prompt = [
      "You are a social media growth coach. Based ONLY on the real data below,",
      "give 4-6 short, specific, actionable tips to improve this content strategy.",
      "Do NOT invent engagement numbers, click counts, or audience activity times —",
      "only give advice that logically follows from the data actually provided.",
      "One tip per line, no numbering, no preamble.",
      "",
      `Total posts generated: ${stats.totalPosts}`,
      `Posts per platform: ${JSON.stringify(stats.platformBreakdown)}`,
      `Average caption length: ${stats.avgCaptionLength} characters`,
      `Average hashtags per post: ${stats.avgHashtagsPerPost}`,
      `Posting cadence: ~${stats.postsPerWeek} posts/week over ${stats.daysSinceFirstPost} days`
    ].join("\n");

    const result = await generate("writer", { topic: prompt, format: "growth tips", tone: "direct and practical" });
    const tips = result.reply
      .split("\n")
      .map((line) => line.replace(/^[-*•\d.)\s]+/, "").trim())
      .filter(Boolean);

    return sendSuccess(res, { tips, creditsSpent: req.creditCost });
  } catch (err) {
    console.error("POST /marketing/growth-coach error:", err.message);
    return sendError(res, "Failed to generate growth tips.", 502);
  }
});

module.exports = router;
