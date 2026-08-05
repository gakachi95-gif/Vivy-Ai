/* ==========================================================================
   services/linkedinAuth.js
   LinkedIn OAuth 2.0 + posting via the current /rest/posts API (the older
   /v2/ugcPosts endpoint is legacy — this uses the one LinkedIn documents
   as current for 2026).
   ========================================================================== */

// LinkedIn-Version header, format YYYYMM. LinkedIn sunsets each version after
// ~12 months, so this is overridable via env var without a code change —
// bump LINKEDIN_API_VERSION in Render whenever posts start failing with
// "Requested version ... is not active".
const LI_VERSION_HEADER = process.env.LINKEDIN_API_VERSION || "202606"; // current as of June 2026

function getLinkedInAuthUrl(state) {
  const url = new URL("https://www.linkedin.com/oauth/v2/authorization");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", process.env.LINKEDIN_CLIENT_ID);
  url.searchParams.set("redirect_uri", process.env.LINKEDIN_REDIRECT_URI);
  url.searchParams.set("scope", "openid profile w_member_social");
  url.searchParams.set("state", state);
  return url.toString();
}

/** Exchanges the authorization code for an access token (form-encoded, per LinkedIn's spec). */
async function exchangeLinkedInCode(code) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: process.env.LINKEDIN_REDIRECT_URI,
    client_id: process.env.LINKEDIN_CLIENT_ID,
    client_secret: process.env.LINKEDIN_CLIENT_SECRET
  });

  const res = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`LinkedIn token exchange failed: ${data.error_description || res.status}`);
  return data.access_token;
}

/** Gets the authenticated member's LinkedIn person URN via OpenID Connect userinfo. */
async function getLinkedInUserInfo(accessToken) {
  const res = await fetch("https://api.linkedin.com/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`LinkedIn userinfo failed: ${data.message || res.status}`);
  return { personUrn: `urn:li:person:${data.sub}`, name: data.name };
}

/**
 * Creates a text post on the member's own feed. Image posts require
 * LinkedIn's separate multi-step asset registration/upload flow — left
 * out of this first pass; text posts cover the common case.
 */
async function createLinkedInPost(accessToken, authorUrn, text) {
  const res = await fetch("https://api.linkedin.com/rest/posts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "X-Restli-Protocol-Version": "2.0.0",
      "LinkedIn-Version": LI_VERSION_HEADER
    },
    body: JSON.stringify({
      author: authorUrn,
      commentary: text,
      visibility: "PUBLIC",
      distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false
    })
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(`LinkedIn post failed: ${data.message || res.status}`);
  }
  // LinkedIn returns the new post's URN in a response header, not the body.
  return res.headers.get("x-restli-id");
}

module.exports = { getLinkedInAuthUrl, exchangeLinkedInCode, getLinkedInUserInfo, createLinkedInPost };
