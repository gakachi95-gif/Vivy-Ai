/* ==========================================================================
   middleware/auth.js
   Verifies the Firebase ID token sent by the frontend as:
     Authorization: Bearer <idToken>
   On success attaches req.uid and req.firebaseUser. Rejects anything else
   with 401 before it ever reaches an AI route (and therefore before any
   OpenRouter credits get spent).
   ========================================================================== */

const admin = require("firebase-admin");
const { sendError } = require("../utils/responses");

async function requireFirebaseAuth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const [scheme, token] = header.split(" ");

    if (scheme !== "Bearer" || !token) {
      return sendError(res, "Missing or invalid Authorization header.", 401);
    }

    const decoded = await admin.auth().verifyIdToken(token);
    req.uid = decoded.uid;
    req.firebaseUser = decoded;
    next();
  } catch (err) {
    console.error("Auth verification failed:", err.message);
    return sendError(res, "Authentication failed. Please sign in again.", 401);
  }
}

module.exports = { requireFirebaseAuth };
