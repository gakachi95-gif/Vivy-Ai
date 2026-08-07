/* ==========================================================================
   VIVY AI — js/firebase-marketing.js
   Firestore data layer for the Marketing Agent. Every other marketing-*.js
   file goes through VivyMarketing rather than touching `db` directly, so
   the storage schema only has to change in one place.

   FIRESTORE SCHEMA
   users/{uid}/campaigns/{campaignId}
       name, businessName, businessDescription, targetAudience, goal,
       platforms: string[], days: number, status: "draft"|"active"|"completed",
       createdAt, updatedAt
   users/{uid}/campaigns/{campaignId}/posts/{postId}
       platform, day (1-based index), date (ISO string), caption, cta,
       hashtags: string[], imagePrompt, status: "draft"|"scheduled"|"published",
       createdAt, updatedAt
   users/{uid}/marketingSettings/connectedAccounts
       { facebook: {connected, handle}, instagram: {...}, linkedin: {...},
         x: {...}, pinterest: {...}, threads: {...} }

   This file relies on the global `db` and `firebase` objects already
   initialized by firebase-config.js, and `sanitizeInput`/`cleanText` from
   utils.js — both must be loaded before this file on the page.
   ========================================================================== */

const VivyMarketing = {
  /* ---------------------------  CAMPAIGNS  ------------------------------- */

  campaignsRef(uid) {
    return db.collection("users").doc(uid).collection("campaigns");
  },

  postsRef(uid, campaignId) {
    return this.campaignsRef(uid).doc(campaignId).collection("posts");
  },

  /** Creates a new campaign document and returns its id. */
  async createCampaign(uid, campaign) {
    const ref = this.campaignsRef(uid).doc();
    await ref.set({
      name: campaign.name,
      businessName: campaign.businessName,
      businessDescription: campaign.businessDescription,
      targetAudience: campaign.targetAudience,
      goal: campaign.goal,
      platforms: campaign.platforms || [],
      days: campaign.days || 7,
      status: "draft",
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    return ref.id;
  },

  /** Fetches every campaign for a user, most recent first. */
  async getCampaigns(uid) {
    const snap = await this.campaignsRef(uid).orderBy("createdAt", "desc").get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  },

  async getCampaign(uid, campaignId) {
    const snap = await this.campaignsRef(uid).doc(campaignId).get();
    return snap.exists ? { id: snap.id, ...snap.data() } : null;
  },

  async updateCampaign(uid, campaignId, fields) {
    await this.campaignsRef(uid).doc(campaignId).update({
      ...fields,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  },

  async deleteCampaign(uid, campaignId) {
    // Delete every post under the campaign first, then the campaign itself.
    const postsSnap = await this.postsRef(uid, campaignId).get();
    const batch = db.batch();
    postsSnap.docs.forEach((d) => batch.delete(d.ref));
    batch.delete(this.campaignsRef(uid).doc(campaignId));
    await batch.commit();
  },

  /* -----------------------------  POSTS  ---------------------------------- */

  /** Saves a batch of generated posts for a campaign in one write. */
  async savePosts(uid, campaignId, posts) {
    const batch = db.batch();
    posts.forEach((post) => {
      const ref = this.postsRef(uid, campaignId).doc();
      batch.set(ref, {
        platform: post.platform,
        day: post.day,
        date: post.date,
        caption: post.caption,
        cta: post.cta,
        hashtags: post.hashtags || [],
        imagePrompt: post.imagePrompt,
        imageUrl: post.imageUrl || "",
        recommendedTime: post.recommendedTime || "",
        status: post.status || "draft",
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    });
    await batch.commit();
  },

  async getPosts(uid, campaignId) {
    const snap = await this.postsRef(uid, campaignId).orderBy("day", "asc").get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  },

  /** Fetches every post across every campaign — used by the calendar/dashboard. */
  async getAllPosts(uid) {
    const campaigns = await this.getCampaigns(uid);
    const results = await Promise.all(
      campaigns.map(async (c) => {
        const posts = await this.getPosts(uid, c.id);
        return posts.map((p) => ({ ...p, campaignId: c.id, campaignName: c.name }));
      })
    );
    return results.flat();
  },

  async updatePost(uid, campaignId, postId, fields) {
    await this.postsRef(uid, campaignId).doc(postId).update({
      ...fields,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  },

  async deletePost(uid, campaignId, postId) {
    await this.postsRef(uid, campaignId).doc(postId).delete();
  },

  async duplicatePost(uid, campaignId, post) {
    const ref = this.postsRef(uid, campaignId).doc();
    const { id, createdAt, updatedAt, ...rest } = post;
    await ref.set({
      ...rest,
      status: "draft",
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    return ref.id;
  },

  /* -----------------------------  DRAFTS  ---------------------------------- */

  async getDrafts(uid) {
    const all = await this.getAllPosts(uid);
    return all.filter((p) => p.status === "draft");
  },

  /* -------------------------  CONNECTED ACCOUNTS  --------------------------- */

  settingsRef(uid) {
    return db.collection("users").doc(uid).collection("marketingSettings").doc("connectedAccounts");
  },

  DEFAULT_PLATFORMS: ["facebook", "instagram", "linkedin", "x", "pinterest", "threads", "wordpress"],

  async getConnectedAccounts(uid) {
    const snap = await this.settingsRef(uid).get();
    if (!snap.exists) {
      const defaults = {};
      this.DEFAULT_PLATFORMS.forEach((p) => (defaults[p] = { connected: false, handle: "" }));
      return defaults;
    }
    const data = snap.data();
    // Guarantee every platform key exists even if the doc predates a new platform
    this.DEFAULT_PLATFORMS.forEach((p) => {
      if (!data[p]) data[p] = { connected: false, handle: "" };
    });
    return data;
  },

  /** Phase 1: UI-only toggle. Real OAuth wiring is a Phase 2 concern. */
  async setAccountConnected(uid, platform, connected, handle = "") {
    await this.settingsRef(uid).set(
      { [platform]: { connected, handle } },
      { merge: true }
    );
  }
};
