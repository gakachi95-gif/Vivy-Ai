/* ==========================================================================
   services/tumblrAuth.js
   Tumblr OAuth 2.0 + posting via the Neue Post Format (NPF) content-block API.
   ========================================================================== */

function getTumblrAuthUrl(state) {
  const url = new URL("https://www.tumblr.com/oauth2/authorize");
  url.searchParams.set("client_id", process.env.TUMBLR_CONSUMER_KEY);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "write offline_access");
  url.searchParams.set("redirect_uri", process.env.TUMBLR_REDIRECT_URI);
  url.searchParams.set("state", state);
  return url.toString();
}

async function exchangeTumblrCode(code) {
  const res = await fetch("https://api.tumblr.com/v2/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: process.env.TUMBLR_CONSUMER_KEY,
      client_secret: process.env.TUMBLR_CONSUMER_SECRET,
      redirect_uri: process.env.TUMBLR_REDIRECT_URI
    })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Tumblr token exchange failed: ${data.error_description || res.status}`);
  return data.access_token;
}

/** Returns the user's own blogs — Phase 1 uses the first (primary) blog. */
async function getTumblrUserInfo(accessToken) {
  const res = await fetch("https://api.tumblr.com/v2/user/info", {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Tumblr user info failed: ${res.status}`);
  const blogs = data.response?.user?.blogs || [];
  return blogs.length ? { blogName: blogs[0].name, title: blogs[0].title } : null;
}

/** Creates a post using NPF content blocks — a text block, plus an image block if provided. */
async function createTumblrPost(accessToken, blogIdentifier, { text, imageUrl, tags = [] }) {
  const content = [{ type: "text", text }];
  if (imageUrl) content.push({ type: "image", media: [{ type: "image/jpeg", url: imageUrl }] });

  const res = await fetch(`https://api.tumblr.com/v2/blog/${blogIdentifier}/posts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ content, tags: tags.join(",") })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Tumblr post failed: ${data.meta?.msg || res.status}`);
  return data.response?.id;
}

module.exports = { getTumblrAuthUrl, exchangeTumblrCode, getTumblrUserInfo, createTumblrPost };
