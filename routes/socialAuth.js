/* ==========================================================================
   routes/socialAuth.js
   The real Facebook/Instagram OAuth connect flow.

     GET  /auth/facebook/start?idToken=...   -> redirects to Facebook's consent screen
     GET  /auth/facebook/callback?code&state -> exchanges code, saves tokens, redirects back
     POST /auth/facebook/disconnect          -> removes stored tokens (Bearer auth, normal fetch)

   Setup required in Render's Environment tab:
     FACEBOOK_APP_ID          from your Meta for Developers app
     FACEBOOK_APP_SECRET      from the same app — never exposed to the frontend
     FACEBOOK_REDIRECT_URI    e.g. https://vivy-ai.onrender.com/auth/facebook/callback
                               (must also be registered in the Meta app's
                               "Valid OAuth Redirect URIs" setting, exactly)
     OAUTH_STATE_SECRET       any long random string, used only to sign state tokens
     FRONTEND_URL             e.g. https://yourusername.github.io/Vivy-Ai
                               (where we redirect back to after connecting)
   ========================================================================== */

const express = require("express");
const admin = require("firebase-admin");
const router = express.Router();

const { sendSuccess, sendError } = require("../utils/responses");
const { requireFirebaseAuth } = require("../middleware/auth");
const {
  signState,
  verifyState,
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  getManagedPages,
  getInstagramBusinessAccount,
  getLinkedInAuthUrl,
  exchangeLinkedInCode,
  getLinkedInUserInfo,
  getPinterestAuthUrl,
  exchangePinterestCode,
  getPinterestBoards,
  getTumblrAuthUrl,
  exchangeTumblrCode,
  getTumblrUserInfo
} = require("../services/socialAuth");
const { saveSocialToken, removeSocialToken, setConnectedAccountStatus } = require("../services/firestore");

const FB_OAUTH_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
  "instagram_basic",
  "instagram_content_publish"
].join(",");

/**
 * Starts the OAuth flow. This is hit by a full page navigation (not fetch),
 * so we can't send a Bearer header — the frontend passes the Firebase ID
 * token as a query param instead, which we verify here before minting a
 * signed state and handing off to Facebook.
 */
router.get("/facebook/start", async (req, res) => {
  try {
    const { idToken } = req.query;
    if (!idToken) return sendError(res, "Missing idToken.", 400);

    const decoded = await admin.auth().verifyIdToken(idToken);
    const state = signState(decoded.uid, "facebook");

    const url = new URL("https://www.facebook.com/v25.0/dialog/oauth");
    url.searchParams.set("client_id", process.env.FACEBOOK_APP_ID);
    url.searchParams.set("redirect_uri", process.env.FACEBOOK_REDIRECT_URI);
    url.searchParams.set("scope", FB_OAUTH_SCOPES);
    url.searchParams.set("state", state);
    url.searchParams.set("response_type", "code");

    res.redirect(url.toString());
  } catch (err) {
    console.error("GET /auth/facebook/start error:", err.message);
    return sendError(res, "Could not start Facebook connection. Please sign in again and retry.", 401);
  }
});

/**
 * Facebook redirects here after the user approves (or denies) access.
 * On success: exchanges the code, fetches the user's Pages and any linked
 * Instagram Business Account, stores the tokens, and bounces the browser
 * back to the Marketing Agent page.
 */
router.get("/facebook/callback", async (req, res) => {
  const frontendUrl = process.env.FRONTEND_URL || "/";
  const marketingPage = `${frontendUrl.replace(/\/$/, "")}/pages/marketing-agent.html`;

  try {
    const { code, state, error: fbError } = req.query;
    if (fbError) return res.redirect(`${marketingPage}?connect_error=${encodeURIComponent(fbError)}`);
    if (!code || !state) return res.redirect(`${marketingPage}?connect_error=missing_params`);

    const uid = verifyState(state, "facebook").uid;

    const shortLivedToken = await exchangeCodeForToken(code);
    const longLivedToken = await exchangeForLongLivedToken(shortLivedToken);
    const pages = await getManagedPages(longLivedToken);

    if (pages.length === 0) {
      return res.redirect(`${marketingPage}?connect_error=no_pages`);
    }

    // Phase 1 supports one Page per account — the first one returned.
    // (Multi-Page selection is a natural Phase 2 addition to this same flow.)
    const page = pages[0];
    const igAccount = await getInstagramBusinessAccount(page.id, page.access_token);

    await saveSocialToken(uid, "facebook", {
      pageId: page.id,
      pageName: page.name,
      pageAccessToken: page.access_token,
      instagramUserId: igAccount?.id || null,
      instagramUsername: igAccount?.username || null
    });

    const statusUpdate = {
      facebook: { connected: true, handle: page.name }
    };
    if (igAccount) {
      statusUpdate.instagram = { connected: true, handle: `@${igAccount.username}` };
    }
    await setConnectedAccountStatus(uid, statusUpdate);

    res.redirect(`${marketingPage}?connected=facebook`);
  } catch (err) {
    console.error("GET /auth/facebook/callback error:", err.message);
    res.redirect(`${marketingPage}?connect_error=server_error`);
  }
});

/** Disconnects Facebook (and the linked Instagram account, since they share one token). */
router.post("/facebook/disconnect", requireFirebaseAuth, async (req, res) => {
  try {
    await removeSocialToken(req.uid, "facebook");
    await setConnectedAccountStatus(req.uid, {
      facebook: { connected: false, handle: "" },
      instagram: { connected: false, handle: "" }
    });
    return sendSuccess(res, { message: "Facebook disconnected." });
  } catch (err) {
    console.error("POST /auth/facebook/disconnect error:", err.message);
    return sendError(res, "Could not disconnect. Please try again.", 500);
  }
});

/* ==========================================================================
   LINKEDIN
   Required env vars: LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET,
   LINKEDIN_REDIRECT_URI (e.g. https://vivy-ai.onrender.com/auth/linkedin/callback,
   must also be registered in the LinkedIn Developer Portal under your
   app's Auth settings -> Authorized redirect URLs).
   ========================================================================== */

router.get("/linkedin/start", async (req, res) => {
  try {
    const { idToken } = req.query;
    if (!idToken) return sendError(res, "Missing idToken.", 400);
    const decoded = await admin.auth().verifyIdToken(idToken);
    const state = signState(decoded.uid, "linkedin");
    res.redirect(getLinkedInAuthUrl(state));
  } catch (err) {
    console.error("GET /auth/linkedin/start error:", err.message);
    return sendError(res, "Could not start LinkedIn connection. Please sign in again and retry.", 401);
  }
});

router.get("/linkedin/callback", async (req, res) => {
  const frontendUrl = process.env.FRONTEND_URL || "/";
  const marketingPage = `${frontendUrl.replace(/\/$/, "")}/pages/marketing-agent.html`;
  try {
    const { code, state, error: liError } = req.query;
    if (liError) return res.redirect(`${marketingPage}?connect_error=${encodeURIComponent(liError)}`);
    if (!code || !state) return res.redirect(`${marketingPage}?connect_error=missing_params`);

    const uid = verifyState(state, "linkedin").uid;
    const accessToken = await exchangeLinkedInCode(code);
    const { personUrn, name } = await getLinkedInUserInfo(accessToken);

    await saveSocialToken(uid, "linkedin", { accessToken, personUrn, name });
    await setConnectedAccountStatus(uid, { linkedin: { connected: true, handle: name } });

    res.redirect(`${marketingPage}?connected=linkedin`);
  } catch (err) {
    console.error("GET /auth/linkedin/callback error:", err.message);
    res.redirect(`${marketingPage}?connect_error=server_error`);
  }
});

router.post("/linkedin/disconnect", requireFirebaseAuth, async (req, res) => {
  try {
    await removeSocialToken(req.uid, "linkedin");
    await setConnectedAccountStatus(req.uid, { linkedin: { connected: false, handle: "" } });
    return sendSuccess(res, { message: "LinkedIn disconnected." });
  } catch (err) {
    console.error("POST /auth/linkedin/disconnect error:", err.message);
    return sendError(res, "Could not disconnect. Please try again.", 500);
  }
});

/* ==========================================================================
   PINTEREST
   Required env vars: PINTEREST_APP_ID, PINTEREST_APP_SECRET,
   PINTEREST_REDIRECT_URI (e.g. https://vivy-ai.onrender.com/auth/pinterest/callback,
   must also be registered in your Pinterest app's settings).
   ========================================================================== */

router.get("/pinterest/start", async (req, res) => {
  try {
    const { idToken } = req.query;
    if (!idToken) return sendError(res, "Missing idToken.", 400);
    const decoded = await admin.auth().verifyIdToken(idToken);
    const state = signState(decoded.uid, "pinterest");
    res.redirect(getPinterestAuthUrl(state));
  } catch (err) {
    console.error("GET /auth/pinterest/start error:", err.message);
    return sendError(res, "Could not start Pinterest connection. Please sign in again and retry.", 401);
  }
});

router.get("/pinterest/callback", async (req, res) => {
  const frontendUrl = process.env.FRONTEND_URL || "/";
  const marketingPage = `${frontendUrl.replace(/\/$/, "")}/pages/marketing-agent.html`;
  try {
    const { code, state, error: pinError } = req.query;
    if (pinError) return res.redirect(`${marketingPage}?connect_error=${encodeURIComponent(pinError)}`);
    if (!code || !state) return res.redirect(`${marketingPage}?connect_error=missing_params`);

    const uid = verifyState(state, "pinterest").uid;
    const accessToken = await exchangePinterestCode(code);
    const boards = await getPinterestBoards(accessToken);

    if (boards.length === 0) {
      return res.redirect(`${marketingPage}?connect_error=no_boards`);
    }

    // Phase 1 supports one default board — the first one returned.
    const board = boards[0];
    await saveSocialToken(uid, "pinterest", { accessToken, boardId: board.id, boardName: board.name });
    await setConnectedAccountStatus(uid, { pinterest: { connected: true, handle: board.name } });

    res.redirect(`${marketingPage}?connected=pinterest`);
  } catch (err) {
    console.error("GET /auth/pinterest/callback error:", err.message);
    res.redirect(`${marketingPage}?connect_error=server_error`);
  }
});

router.post("/pinterest/disconnect", requireFirebaseAuth, async (req, res) => {
  try {
    await removeSocialToken(req.uid, "pinterest");
    await setConnectedAccountStatus(req.uid, { pinterest: { connected: false, handle: "" } });
    return sendSuccess(res, { message: "Pinterest disconnected." });
  } catch (err) {
    console.error("POST /auth/pinterest/disconnect error:", err.message);
    return sendError(res, "Could not disconnect. Please try again.", 500);
  }
});

/* ==========================================================================
   TUMBLR
   Required env vars: TUMBLR_CONSUMER_KEY, TUMBLR_CONSUMER_SECRET,
   TUMBLR_REDIRECT_URI (e.g. https://vivy-ai.onrender.com/auth/tumblr/callback,
   must also be registered in your Tumblr app's OAuth2 redirect URL setting).
   ========================================================================== */

router.get("/tumblr/start", async (req, res) => {
  try {
    const { idToken } = req.query;
    if (!idToken) return sendError(res, "Missing idToken.", 400);
    const decoded = await admin.auth().verifyIdToken(idToken);
    const state = signState(decoded.uid, "tumblr");
    res.redirect(getTumblrAuthUrl(state));
  } catch (err) {
    console.error("GET /auth/tumblr/start error:", err.message);
    return sendError(res, "Could not start Tumblr connection. Please sign in again and retry.", 401);
  }
});

router.get("/tumblr/callback", async (req, res) => {
  const frontendUrl = process.env.FRONTEND_URL || "/";
  const marketingPage = `${frontendUrl.replace(/\/$/, "")}/pages/marketing-agent.html`;
  try {
    const { code, state, error: tumblrError } = req.query;
    if (tumblrError) return res.redirect(`${marketingPage}?connect_error=${encodeURIComponent(tumblrError)}`);
    if (!code || !state) return res.redirect(`${marketingPage}?connect_error=missing_params`);

    const uid = verifyState(state, "tumblr").uid;
    const accessToken = await exchangeTumblrCode(code);
    const userInfo = await getTumblrUserInfo(accessToken);

    if (!userInfo) {
      return res.redirect(`${marketingPage}?connect_error=no_blogs`);
    }

    await saveSocialToken(uid, "tumblr", { accessToken, blogName: userInfo.blogName });
    await setConnectedAccountStatus(uid, { tumblr: { connected: true, handle: userInfo.blogName } });

    res.redirect(`${marketingPage}?connected=tumblr`);
  } catch (err) {
    console.error("GET /auth/tumblr/callback error:", err.message);
    res.redirect(`${marketingPage}?connect_error=server_error`);
  }
});

router.post("/tumblr/disconnect", requireFirebaseAuth, async (req, res) => {
  try {
    await removeSocialToken(req.uid, "tumblr");
    await setConnectedAccountStatus(req.uid, { tumblr: { connected: false, handle: "" } });
    return sendSuccess(res, { message: "Tumblr disconnected." });
  } catch (err) {
    console.error("POST /auth/tumblr/disconnect error:", err.message);
    return sendError(res, "Could not disconnect. Please try again.", 500);
  }
});

module.exports = router;
