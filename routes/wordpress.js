/* ==========================================================================
   routes/wordpress.js
   WordPress connects differently from the other platforms: no developer
   app, no OAuth redirect. The user generates an Application Password from
   their own WordPress admin (Users -> Profile -> Application Passwords,
   built into WordPress core since 5.6) and pastes in their site URL,
   username, and that password. We verify it works, then store it.

     POST /wordpress/connect     { siteUrl, username, applicationPassword }
     POST /wordpress/disconnect
   ========================================================================== */

const express = require("express");
const router = express.Router();

const { sendSuccess, sendError } = require("../utils/responses");
const { requireFirebaseAuth } = require("../middleware/auth");
const { verifyWordPressCredentials } = require("../services/wordpressAuth");
const { saveSocialToken, removeSocialToken, setConnectedAccountStatus } = require("../services/firestore");

router.use(requireFirebaseAuth);

router.post("/connect", async (req, res) => {
  try {
    const { siteUrl, username, applicationPassword } = req.body;
    if (!siteUrl || !username || !applicationPassword) {
      return sendError(res, "Site URL, username, and application password are all required.", 400);
    }

    const account = await verifyWordPressCredentials(siteUrl, username, applicationPassword);

    await saveSocialToken(req.uid, "wordpress", { siteUrl, username, applicationPassword });
    await setConnectedAccountStatus(req.uid, { wordpress: { connected: true, handle: siteUrl } });

    return sendSuccess(res, { message: `Connected as ${account.name}.` });
  } catch (err) {
    console.error("POST /wordpress/connect error:", err.message);
    return sendError(res, err.message || "Could not connect to WordPress.", 400);
  }
});

router.post("/disconnect", async (req, res) => {
  try {
    await removeSocialToken(req.uid, "wordpress");
    await setConnectedAccountStatus(req.uid, { wordpress: { connected: false, handle: "" } });
    return sendSuccess(res, { message: "WordPress disconnected." });
  } catch (err) {
    console.error("POST /wordpress/disconnect error:", err.message);
    return sendError(res, "Could not disconnect. Please try again.", 500);
  }
});

module.exports = router;
