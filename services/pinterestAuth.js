/* ==========================================================================
   services/pinterestAuth.js
   Pinterest OAuth 2.0 + Pin creation via API v5.
   ========================================================================== */

function getPinterestAuthUrl(state) {
  const url = new URL("https://www.pinterest.com/oauth/");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", process.env.PINTEREST_APP_ID);
  url.searchParams.set("redirect_uri", process.env.PINTEREST_REDIRECT_URI);
  url.searchParams.set("scope", "boards:read,pins:write,user_accounts:read");
  url.searchParams.set("state", state);
  return url.toString();
}

/** Token exchange uses HTTP Basic auth with the app credentials, per Pinterest's spec. */
async function exchangePinterestCode(code) {
  const basicAuth = Buffer.from(`${process.env.PINTEREST_APP_ID}:${process.env.PINTEREST_APP_SECRET}`).toString("base64");

  const res = await fetch("https://api.pinterest.com/v5/oauth/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: process.env.PINTEREST_REDIRECT_URI
    })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Pinterest token exchange failed: ${data.message || res.status}`);
  return data.access_token;
}

/** Fetches the user's boards — Phase 1 just uses the first one returned. */
async function getPinterestBoards(accessToken) {
  const res = await fetch("https://api.pinterest.com/v5/boards", {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Fetching Pinterest boards failed: ${data.message || res.status}`);
  return data.items || [];
}

/** Creates an image Pin. Pinterest requires a board_id and a valid image URL on every Pin. */
async function createPinterestPin(accessToken, { boardId, imageUrl, title, description, link }) {
  const res = await fetch("https://api.pinterest.com/v5/pins", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      board_id: boardId,
      media_source: { source_type: "image_url", url: imageUrl },
      title,
      description,
      link
    })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Pinterest pin creation failed: ${data.message || res.status}`);
  return data.id;
}

module.exports = { getPinterestAuthUrl, exchangePinterestCode, getPinterestBoards, createPinterestPin };
