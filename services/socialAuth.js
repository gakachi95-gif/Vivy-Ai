/* ==========================================================================
   services/socialAuth.js
   Facebook/Instagram OAuth helpers.

   Why "state" is signed: the OAuth connect flow is a full browser redirect
   (Facebook -> our callback), so we can't attach an Authorization header
   the way normal fetch() calls do. Instead the frontend verifies the user
   with Firebase first, we mint a signed, timestamped "state" string that
   proves which uid initiated the request, and the callback verifies that
   signature before trusting anything in it — this is what stops someone
   else from forging a callback and linking their Facebook account to your
   account.
   ========================================================================== */

const crypto = require("crypto");

const GRAPH_API_VERSION = "v25.0"; // current as of Feb 2026 — bump when Meta deprecates this
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;
const STATE_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes to complete the OAuth dance

function getStateSecret() {
  if (!process.env.OAUTH_STATE_SECRET) {
    throw new Error("OAUTH_STATE_SECRET environment variable is missing.");
  }
  return process.env.OAUTH_STATE_SECRET;
}

/** Creates a signed "uid.platform.timestamp.signature" state string. */
function signState(uid, platform) {
  const payload = `${uid}.${platform}.${Date.now()}`;
  const signature = crypto.createHmac("sha256", getStateSecret()).update(payload).digest("base64url");
  return Buffer.from(`${payload}.${signature}`).toString("base64url");
}

/** Verifies a state string and returns { uid, platform }, or throws if invalid/expired/tampered. */
function verifyState(state, expectedPlatform) {
  const decoded = Buffer.from(state, "base64url").toString("utf8");
  const [uid, platform, timestamp, signature] = decoded.split(".");
  if (!uid || !platform || !timestamp || !signature) throw new Error("Malformed state.");
  if (expectedPlatform && platform !== expectedPlatform) throw new Error("State platform mismatch.");

  const expectedSig = crypto
    .createHmac("sha256", getStateSecret())
    .update(`${uid}.${platform}.${timestamp}`)
    .digest("base64url");

  const sigBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSig);
  if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
    throw new Error("State signature mismatch — possible tampering.");
  }
  if (Date.now() - parseInt(timestamp, 10) > STATE_MAX_AGE_MS) {
    throw new Error("State expired — please try connecting again.");
  }
  return { uid, platform };
}

/** Step 1 of the exchange: authorization code -> short-lived user access token. */
async function exchangeCodeForToken(code) {
  const url = new URL(`${GRAPH_BASE}/oauth/access_token`);
  url.searchParams.set("client_id", process.env.FACEBOOK_APP_ID);
  url.searchParams.set("client_secret", process.env.FACEBOOK_APP_SECRET);
  url.searchParams.set("redirect_uri", process.env.FACEBOOK_REDIRECT_URI);
  url.searchParams.set("code", code);

  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) throw new Error(`Facebook token exchange failed: ${data.error?.message || res.status}`);
  return data.access_token;
}

/** Step 2: short-lived token -> long-lived token (~60 days instead of ~2 hours). */
async function exchangeForLongLivedToken(shortLivedToken) {
  const url = new URL(`${GRAPH_BASE}/oauth/access_token`);
  url.searchParams.set("grant_type", "fb_exchange_token");
  url.searchParams.set("client_id", process.env.FACEBOOK_APP_ID);
  url.searchParams.set("client_secret", process.env.FACEBOOK_APP_SECRET);
  url.searchParams.set("fb_exchange_token", shortLivedToken);

  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) throw new Error(`Facebook long-lived token exchange failed: ${data.error?.message || res.status}`);
  return data.access_token;
}

/** Fetches the Pages this user manages, each with its own (effectively non-expiring) Page Access Token. */
async function getManagedPages(userAccessToken) {
  const url = new URL(`${GRAPH_BASE}/me/accounts`);
  url.searchParams.set("access_token", userAccessToken);

  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) throw new Error(`Fetching Facebook Pages failed: ${data.error?.message || res.status}`);
  return data.data || []; // [{ id, name, access_token, ... }]
}

/** Given a Page, looks up its linked Instagram Business Account (if any). */
async function getInstagramBusinessAccount(pageId, pageAccessToken) {
  const url = new URL(`${GRAPH_BASE}/${pageId}`);
  url.searchParams.set("fields", "instagram_business_account{id,username}");
  url.searchParams.set("access_token", pageAccessToken);

  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) throw new Error(`Fetching Instagram account failed: ${data.error?.message || res.status}`);
  return data.instagram_business_account || null; // { id, username } or null if not linked
}

module.exports = {
  GRAPH_BASE,
  signState,
  verifyState,
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  getManagedPages,
  getInstagramBusinessAccount,
  ...require("./linkedinAuth"),
  ...require("./pinterestAuth"),
  ...require("./tumblrAuth")
};
