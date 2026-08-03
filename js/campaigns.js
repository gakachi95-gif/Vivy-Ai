/* ==========================================================================
   VIVY AI — js/campaigns.js
   Campaign creation and the AI generation workflow. Reuses the existing
   VivyAI.generate() wrapper from utils.js (task: "writer") rather than
   adding a new backend route — one well-structured prompt produces the
   whole campaign's worth of posts in a single request, which the parser
   below splits into individual post objects.
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

  /**
   * The visual workflow steps shown while a campaign is generating.
   * The first four are strategy steps folded into the single AI prompt
   * below (Phase 1 keeps this to one request for speed/cost); the rest
   * are real, separate operations.
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

  /**
   * Builds one structured prompt asking for the campaign's entire content
   * calendar in a single response, with a strict delimiter format so it
   * can be parsed reliably regardless of which model is behind VivyAI.
   */
  buildPrompt(form) {
    const platforms = form.platforms.map((p) => this.PLATFORM_LABELS[p] || p).join(", ");
    return [
      `You are a senior social media marketer building a ${form.days}-day content calendar.`,
      `Business name: ${form.businessName}`,
      `Business description: ${form.businessDescription}`,
      `Target audience: ${form.targetAudience}`,
      `Campaign goal: ${form.goal}`,
      `Platforms to rotate across (one platform per day, in order, repeating): ${platforms}`,
      ``,
      `For EACH of the ${form.days} days, output a block in EXACTLY this format, with nothing else before or after:`,
      ``,
      `### DAY <n> - <PLATFORM> ###`,
      `CAPTION: <the post caption, written for that platform's style and length norms>`,
      `CTA: <a short, punchy call to action>`,
      `HASHTAGS: <5-8 relevant hashtags, space separated, each starting with #>`,
      `IMAGE PROMPT: <a detailed prompt describing an image that would accompany this post>`,
      ``,
      `Repeat that block for all ${form.days} days. Do not add commentary, headings, or summaries outside those blocks.`
    ].join("\n");
  },

  /**
   * Parses the AI's raw text response into structured post objects using
   * the "### DAY n - PLATFORM ###" delimiters requested in the prompt.
   * Falls back gracefully — a block that doesn't fully match still produces
   * a post with whatever fields were found, rather than being dropped.
   */
  parseGeneratedContent(raw, startDate) {
    const blocks = raw.split(/### DAY\s+(\d+)\s*-\s*([^#]+?)\s*###/gi);
    const posts = [];
    // split() with capture groups yields: [preamble, day, platform, body, day, platform, body, ...]
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
        platform: this._matchPlatform(platformRaw),
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
   * calls onStep(stepIndex) before each visual step so the caller can
   * animate the UI, generates content via VivyAI, parses it, saves the
   * posts, and marks the campaign active. Returns { campaignId, posts }.
   */
  async runWorkflow(uid, form, onStep) {
    const totalSteps = this.WORKFLOW_STEPS.length;
    const tick = async (i) => {
      if (onStep) onStep(i, this.WORKFLOW_STEPS[i]);
      // Small delay so each strategy step is visibly readable, not instant.
      await new Promise((r) => setTimeout(r, 450));
    };

    // Steps 0-3: business analysis / audience / keywords / strategy — visual only,
    // folded into the single generation call below for Phase 1.
    for (let i = 0; i < 4; i++) await tick(i);

    // Step 4: the real AI call — produces posts, hashtags, image prompts and
    // CTAs together, but we still animate through steps 4-7 as the response
    // is parsed, since from the user's perspective those are distinct outputs.
    await tick(4);
    const prompt = this.buildPrompt(form);
    const raw = await VivyAI.generate({
      task: "writer",
      prompt,
      meta: { format: "social media content calendar", tone: "marketing" }
    });

    await tick(5); // hashtags (parsed from the same response)
    await tick(6); // image prompts (parsed from the same response)
    await tick(7); // CTAs (parsed from the same response)

    const posts = this.parseGeneratedContent(raw, new Date());
    if (posts.length === 0) {
      throw new Error("The AI response couldn't be parsed into posts. Please try generating again.");
    }

    // Step 8: build the content calendar (just structuring what we parsed)
    await tick(8);

    // Step 9: save everything to Firestore
    await tick(9);
    const campaignId = await VivyMarketing.createCampaign(uid, form);
    await VivyMarketing.savePosts(uid, campaignId, posts);
    await VivyMarketing.updateCampaign(uid, campaignId, { status: "active" });

    return { campaignId, posts };
  }
};
