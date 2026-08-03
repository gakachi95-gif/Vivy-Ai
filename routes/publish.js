/* ==========================================================================
   routes/publish.js
   Publishes a post to a connected Facebook Page or Instagram Business
   Account. Both require Firebase auth (normal fetch with Bearer header —
   unlike the OAuth connect flow, these aren't page navigations).

   Instagram's API has no text-only post type — every publish call MUST
   include a publicly reachable image URL. Facebook Pages support both:
   text-only status updates, or a photo post if an imageUrl is provided.
   ========================================================================== */

const express = require("express");
const router = express.Router();

const { sendSuccess, sendError } = require("../utils/responses");
const { requireFirebaseAuth } = require("../middleware/auth");
const { getSocialToken } = require("../services/firestore");
const { GRAPH_BASE, createLinkedInPost, createPinterestPin, createTumblrPost } = require("../services/socialAuth");
const { createWordPressPost } = require("../services/wordpressAuth");

router.use(requireFirebaseAuth);

/** POST /publish/facebook  { message, imageUrl? } */
router.post("/facebook", async (req, res) => {
  try {
    const { message, imageUrl } = req.body;
    if (!message || typeof message !== "string") {
      return sendError(res, "A message is required.", 400);
    }

    const account = await getSocialToken(req.uid, "facebook");
    if (!account?.pageAccessToken) {
      return sendError(res, "Facebook isn't connected yet. Connect it from the Accounts tab first.", 400);
    }

    const endpoint = imageUrl ? `${account.pageId}/photos` : `${account.pageId}/feed`;
    const body = imageUrl
      ? { url: imageUrl, caption: message, access_token: account.pageAccessToken }
      : { message, access_token: account.pageAccessToken };

    const fbRes = await fetch(`${GRAPH_BASE}/${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await fbRes.json();

    if (!fbRes.ok) {
      console.error("POST /publish/facebook Graph API error:", data.error?.message);
      return sendError(res, data.error?.message || "Facebook rejected the post.", 502);
    }

    return sendSuccess(res, { postId: data.post_id || data.id });
  } catch (err) {
    console.error("POST /publish/facebook error:", err.message);
    return sendError(res, "Failed to publish to Facebook. Please try again.", 502);
  }
});

/** POST /publish/instagram  { caption, imageUrl } — imageUrl is required by Instagram's API. */
router.post("/instagram", async (req, res) => {
  try {
    const { caption, imageUrl } = req.body;
    if (!imageUrl) {
      return sendError(res, "Instagram requires an image. Upload one for this post first.", 400);
    }

    const account = await getSocialToken(req.uid, "facebook"); // IG creds are stored alongside Facebook's
    if (!account?.instagramUserId || !account?.pageAccessToken) {
      return sendError(res, "Instagram isn't connected yet. Connect Facebook first — Instagram links automatically if your Page has a linked Instagram Business account.", 400);
    }

    // Step 1: create a media container
    const createRes = await fetch(`${GRAPH_BASE}/${account.instagramUserId}/media`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_url: imageUrl,
        caption: caption || "",
        access_token: account.pageAccessToken
      })
    });
    const createData = await createRes.json();
    if (!createRes.ok) {
      console.error("POST /publish/instagram media create error:", createData.error?.message);
      return sendError(res, createData.error?.message || "Instagram rejected the image.", 502);
    }

    // Step 2: publish the container
    const publishRes = await fetch(`${GRAPH_BASE}/${account.instagramUserId}/media_publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        creation_id: createData.id,
        access_token: account.pageAccessToken
      })
    });
    const publishData = await publishRes.json();
    if (!publishRes.ok) {
      console.error("POST /publish/instagram publish error:", publishData.error?.message);
      return sendError(res, publishData.error?.message || "Instagram publish step failed.", 502);
    }

    return sendSuccess(res, { postId: publishData.id });
  } catch (err) {
    console.error("POST /publish/instagram error:", err.message);
    return sendError(res, "Failed to publish to Instagram. Please try again.", 502);
  }
});

/** POST /publish/linkedin  { message } — text posts only in this first pass. */
router.post("/linkedin", async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return sendError(res, "A message is required.", 400);

    const account = await getSocialToken(req.uid, "linkedin");
    if (!account?.accessToken) {
      return sendError(res, "LinkedIn isn't connected yet. Connect it from the Accounts tab first.", 400);
    }

    const postUrn = await createLinkedInPost(account.accessToken, account.personUrn, message);
    return sendSuccess(res, { postId: postUrn });
  } catch (err) {
    console.error("POST /publish/linkedin error:", err.message);
    return sendError(res, err.message || "Failed to publish to LinkedIn.", 502);
  }
});

/** POST /publish/pinterest  { title, description, imageUrl, link? } — imageUrl is required. */
router.post("/pinterest", async (req, res) => {
  try {
    const { title, description, imageUrl, link } = req.body;
    if (!imageUrl) return sendError(res, "Pinterest requires an image. Add an image URL to this post first.", 400);

    const account = await getSocialToken(req.uid, "pinterest");
    if (!account?.accessToken) {
      return sendError(res, "Pinterest isn't connected yet. Connect it from the Accounts tab first.", 400);
    }

    const pinId = await createPinterestPin(account.accessToken, {
      boardId: account.boardId,
      imageUrl,
      title,
      description,
      link
    });
    return sendSuccess(res, { postId: pinId });
  } catch (err) {
    console.error("POST /publish/pinterest error:", err.message);
    return sendError(res, err.message || "Failed to publish to Pinterest.", 502);
  }
});

/** POST /publish/tumblr  { message, imageUrl?, tags? } */
router.post("/tumblr", async (req, res) => {
  try {
    const { message, imageUrl, tags } = req.body;
    if (!message) return sendError(res, "A message is required.", 400);

    const account = await getSocialToken(req.uid, "tumblr");
    if (!account?.accessToken) {
      return sendError(res, "Tumblr isn't connected yet. Connect it from the Accounts tab first.", 400);
    }

    const postId = await createTumblrPost(account.accessToken, account.blogName, {
      text: message,
      imageUrl,
      tags: Array.isArray(tags) ? tags : []
    });
    return sendSuccess(res, { postId });
  } catch (err) {
    console.error("POST /publish/tumblr error:", err.message);
    return sendError(res, err.message || "Failed to publish to Tumblr.", 502);
  }
});

/** POST /publish/wordpress  { title, content } */
router.post("/wordpress", async (req, res) => {
  try {
    const { title, content } = req.body;
    if (!content) return sendError(res, "Post content is required.", 400);

    const account = await getSocialToken(req.uid, "wordpress");
    if (!account?.applicationPassword) {
      return sendError(res, "WordPress isn't connected yet. Connect it from the Accounts tab first.", 400);
    }

    const post = await createWordPressPost(account.siteUrl, account.username, account.applicationPassword, {
      title: title || "New post from Vivy AI",
      content
    });
    return sendSuccess(res, { postId: post.id, link: post.link });
  } catch (err) {
    console.error("POST /publish/wordpress error:", err.message);
    return sendError(res, err.message || "Failed to publish to WordPress.", 502);
  }
});

module.exports = router;
