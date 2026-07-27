/* ==========================================================================
   utils/responses.js
   Standard success/error response shapes so every endpoint returns a
   consistent JSON contract to the frontend.
   ========================================================================== */

function sendSuccess(res, data = {}, statusCode = 200) {
  return res.status(statusCode).json({ success: true, ...data });
}

function sendError(res, message = "Something went wrong.", statusCode = 400, extra = {}) {
  return res.status(statusCode).json({ success: false, message, ...extra });
}

module.exports = { sendSuccess, sendError };
