/* ==========================================================================
   VIVY AI — js/campaigns.js
   Campaign creation and the AI generation workflow. Reuses the existing
   VivyAI.generate() wrapper from utils.js (task: "writer"). Content is
   generated in small BATCHES of days rather than one giant request for
   the whole campaign — asking a free-tier model for 30 fully-detailed
   days in a single call risks hitting token limits or timing out; batching
   keeps every individual request small, fast, and reliable regardless of
   campaign length.
   ========================================================================== */

const VivyCampaigns = {
  PLATFORM_LABELS: {
    facebook: "Facebook",
    instagram: "Instagram",
    linkedin: "LinkedIn",
    x: "X",
    threads: "Threads",
    pinterest: "Pinterest",
    wordpress: "WordPress"
  },

  /** Days generated per AI call. Smaller = more reliable, more requests; tune as needed. */
  BATCH_SIZE: 5,

  /**
   * The visual workflow steps shown while a campaign is generating.
   * The first four are strategy steps folded into the batched generation
   * calls below (Phase 1 keeps this lightweight); the rest are real steps.
   */
  WORKFLOW_STEPS: [
    { key: "analysis", label: "Business Analysis" },
    { key: "audience", label: "Audience Research" },
    { key: "keywords", label: "Keyword Research" },
    { key: "strategy", label: "Content Strategy" },
    { key: "posts", label: "Generating Posts" },
    { key: "hashtags", label: "Generating Hashtags" },
    { key: "images", label: "Generating Image Prompts" },
    { key: "ctas", label: "Generating Call-To-Actions" },
    { key: "calendar", label: "Building Content Calendar" },
    { key: "save", label: "Saving Campaign" }
  ],

  /** Assigns a platform to every day up front, rotating through the selected platforms in order. */
  buildDayPlatformPairs(form) {
    const pairs = [];
    for (let day = 1; day <= form.days; day++) {
      pairs.push({ day, platform: form.platforms[(day - 1) % form.platforms.length] });
    }
    return pairs;
  },

  /**
   * Builds a prompt for ONE batch of days only. Pre-assigning the platform
   * per day (rather than asking the AI to rotate them itself) makes
   * parsing far more reliable — we already know what each block should be.
   */
  buildBatchPrompt(form, batchPairs) {
    return [
      `You are a senior social media marketer writing part of a content calendar.`,
      `Business name: ${form.businessName}`,
      `Business description: ${form.businessDescription}`,
      `Target audience: ${form.targetAudience}`,
      `Campaign goal: ${form.goal}`,
      ``,
      `Generate one post for EACH of the following day/platform pairs, each in EXACTLY this block format:`,
      ``,
      `### DAY <n> - <PLATFORM> ###`,
      `CAPTION: <the post caption, written for that platform's style and length norms>`,
      `CTA: <a short, punchy call to action>`,
      `HASHTAGS: <5-8 relevant hashtags, space separated, each starting with #>`,
      `IMAGE PROMPT: <a detailed prompt describing an image that would accompany this post>`,
      ``,
      `Required day/platform pairs for this batch:`,
      ...batchPairs.map((p) => `Day ${p.day}: ${this.PLATFORM_LABELS[p.platform] || p.platform}`),
      ``,
      `Output exactly ${batchPairs.length} block(s), nothing else — no commentary, headings, or summaries outside those blocks.`
    ].join("\n");
  },

  /**
   * Parses one batch's response into structured post objects. Falls back
   * to the pre-assigned platform for that day if the AI's own header text
   * doesn't clearly match one, since we already know what was requested.
   */
  parseGeneratedContent(raw, startDate, batchPairs = []) {
    const blocks = raw.split(/### DAY\s+(\d+)\s*-\s*([^#]+?)\s*###/gi);
    const posts = [];
    const pairsByDay = Object.fromEntries(batchPairs.map((p) => [p.day, p.platform]));

    for (let i = 1; i < blocks.length; i += 3) {
      const dayNum = parseInt(blocks[i], 10);
      const platformRaw = (blocks[i + 1] || "").trim().toLowerCase();
      const body = blocks[i + 2] || "";
      if (!dayNum || !body) continue;

      const caption = this._extractField(body, "CAPTION");
      const cta = this._extractField(body, "CTA");
      const hashtagsRaw = this._extractField(body, "HASHTAGS");
      const imagePrompt = this._extractField(body, "IMAGE PROMPT");

      const date = new Date(startDate);
      date.setDate(date.getDate() + (dayNum - 1));

      posts.push({
        day: dayNum,
        platform: pairsByDay[dayNum] || this._matchPlatform(platformRaw),
        date: date.toISOString().slice(0, 10),
        caption: cleanText(caption, 2000),
        cta: cleanText(cta, 200),
        hashtags: (hashtagsRaw.match(/#[\w]+/g) || []),
        imagePrompt: cleanText(imagePrompt, 500),
        status: "scheduled"
      });
    }
    return posts.sort((a, b) => a.day - b.day);
  },

  _extractField(body, label) {
    const re = new RegExp(`${label}:\\s*([\\s\\S]*?)(?=\\n[A-Z][A-Z ]*:|$)`, "i");
    const match = body.match(re);
    return match ? match[1].trim() : "";
  },

  _matchPlatform(text) {
    const known = Object.keys(this.PLATFORM_LABELS);
    return known.find((p) => text.includes(p)) || known.find((p) => text.includes(this.PLATFORM_LABELS[p].toLowerCase())) || known[0];
  },

  /**
   * Runs the full workflow for a new campaign: saves the campaign doc,
   * calls onStep(stepIndex) before each visual step, generates content in
   * small batches via VivyAI (calling onProgress(done, total) after each
   * batch so the UI can show real progress), parses and saves the posts,
   * and marks the campaign active. Returns { campaignId, posts }.
   */
  async runWorkflow(uid, form, onStep, onProgress) {
    const tick = async (i) => {
      if (onStep) onStep(i, this.WORKFLOW_STEPS[i]);
      await new Promise((r) => setTimeout(r, 450)); // keep each strategy step visibly readable
    };

    // Steps 0-3: business analysis / audience / keywords / strategy — visual only for Phase 1.
    for (let i = 0; i < 4; i++) await tick(i);

    // Step 4 onward: real batched generation. We stay on step 4's animation
    // for the whole batch loop and instead report fine-grained progress via
    // onProgress, since "days completed" is more meaningful here than which
    // of the four sub-labels (hashtags/images/CTAs) is technically active —
    // all four come back together in every batch anyway.
    if (onStep) onStep(4, this.WORKFLOW_STEPS[4]);

    const dayPlatformPairs = this.buildDayPlatformPairs(form);
    const allPosts = [];

    for (let start = 0; start < dayPlatformPairs.length; start += this.BATCH_SIZE) {
      const batchPairs = dayPlatformPairs.slice(start, start + this.BATCH_SIZE);
      const prompt = this.buildBatchPrompt(form, batchPairs);

      const raw = await VivyAI.generate({
        task: "writer",
        prompt,
        meta: { format: "social media content calendar", tone: "marketing" }
      });

      const batchPosts = this.parseGeneratedContent(raw, new Date(), batchPairs);
      allPosts.push(...batchPosts);

      if (onProgress) onProgress(Math.min(start + this.BATCH_SIZE, dayPlatformPairs.length), dayPlatformPairs.length);
    }

    if (allPosts.length === 0) {
      throw new Error("The AI response couldn't be parsed into posts. Please try generating again.");
    }

    await tick(5); // hashtags — already included in every batch above
    await tick(6); // image prompts — already included in every batch above
    await tick(7); // CTAs — already included in every batch above
    await tick(8); // build the content calendar (structuring what we parsed)

    await tick(9); // save everything to Firestore
    const campaignId = await VivyMarketing.createCampaign(uid, form);
    await VivyMarketing.savePosts(uid, campaignId, allPosts);
    await VivyMarketing.updateCampaign(uid, campaignId, { status: "active" });

    return { campaignId, posts: allPosts };
  }
};
