/* ==========================================================================
   middleware/adminAuth.js
   Minimal admin gate: checks the authenticated user's uid against a
   comma-separated allowlist in the ADMIN_UIDS env var. Must run AFTER
   requireFirebaseAuth (needs req.uid). No separate admin role system yet —
   this is intentionally simple until a real Admin Dashboard UI exists.
   ========================================================================== */

const { sendError } = require("../utils/responses");

function requireAdmin(req, res, next) {
  const adminUids = (process.env.ADMIN_UIDS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!adminUids.includes(req.uid)) {
    return sendError(res, "Admin access required.", 403);
  }
  next();
}

module.exports = { requireAdmin };
