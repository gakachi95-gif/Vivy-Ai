/* ==========================================================================
   services/wordpressAuth.js
   WordPress uses Application Passwords (built into WordPress core since
   5.6) instead of OAuth — no developer account, no app review, no
   redirect flow. The user generates one from their own site's
   Users -> Profile -> Application Passwords screen and pastes it in.
   Self-hosted WordPress.org sites only (not WordPress.com-hosted blogs,
   which use a different, OAuth-based API).
   ========================================================================== */

function normalizeSiteUrl(siteUrl) {
  return siteUrl.replace(/\/+$/, ""); // strip trailing slash
}

function basicAuthHeader(username, applicationPassword) {
  const token = Buffer.from(`${username}:${applicationPassword}`).toString("base64");
  return `Basic ${token}`;
}

/** Verifies the credentials actually work before we save them. */
async function verifyWordPressCredentials(siteUrl, username, applicationPassword) {
  const url = `${normalizeSiteUrl(siteUrl)}/wp-json/wp/v2/users/me`;
  const res = await fetch(url, {
    headers: { Authorization: basicAuthHeader(username, applicationPassword) }
  });
  if (!res.ok) {
    throw new Error(
      res.status === 401
        ? "WordPress rejected those credentials. Check the site URL, username, and application password."
        : `Could not reach that WordPress site (${res.status}). Check the site URL.`
    );
  }
  const data = await res.json();
  return { name: data.name, id: data.id };
}

/** Creates a post (defaults to publishing immediately). */
async function createWordPressPost(siteUrl, username, applicationPassword, { title, content, status = "publish" }) {
  const url = `${normalizeSiteUrl(siteUrl)}/wp-json/wp/v2/posts`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(username, applicationPassword),
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ title, content, status })
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || `WordPress rejected the post (${res.status}).`);
  }
  return { id: data.id, link: data.link };
}

module.exports = { verifyWordPressCredentials, createWordPressPost };
