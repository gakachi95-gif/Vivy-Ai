/* ==========================================================================
   middleware/validation.js
   Lightweight, dependency-free request validation + sanitization.
   validateBody(schema) returns an Express middleware that checks required
   fields exist, are the right type, and trims/caps string length before
   the request ever reaches an AI provider call.
   ========================================================================== */

const { sendError } = require("../utils/responses");

/** Strips control characters and caps length. Does NOT escape HTML — this
 *  is server-side text going to an LLM, not being injected into a DOM. */
function sanitizeText(value, maxLen = 8000) {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, maxLen);
}

/**
 * @param {Object} schema - e.g. { message: { required: true, type: "string", maxLen: 4000 } }
 */
function validateBody(schema) {
  return (req, res, next) => {
    const body = req.body || {};
    const cleaned = {};

    for (const [field, rules] of Object.entries(schema)) {
      let value = body[field];

      if (rules.required && (value === undefined || value === null || value === "")) {
        return sendError(res, `Missing required field: "${field}".`, 400);
      }

      if (value !== undefined && value !== null) {
        if (rules.type === "string") {
          value = sanitizeText(value, rules.maxLen || 8000);
          if (rules.required && value.length === 0) {
            return sendError(res, `Field "${field}" cannot be empty.`, 400);
          }
        } else if (rules.type === "array") {
          if (!Array.isArray(value)) {
            return sendError(res, `Field "${field}" must be an array.`, 400);
          }
          value = value.slice(0, rules.maxItems || 50);
        } else if (rules.type === "number") {
          value = Number(value);
          if (Number.isNaN(value)) {
            return sendError(res, `Field "${field}" must be a number.`, 400);
          }
        }
      }

      cleaned[field] = value;
    }

    req.validated = cleaned;
    next();
  };
}

module.exports = { validateBody, sanitizeText };
