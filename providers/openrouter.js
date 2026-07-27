/* ==========================================================================
   providers/openrouter.js
   Thin, model-agnostic client for OpenRouter's chat completions API.
   Nothing in this file knows or cares which model is being used — that's
   entirely controlled by the OPENROUTER_MODEL environment variable, so
   swapping between Claude / GPT / Gemini / DeepSeek / Llama / Mistral etc.
   requires zero code changes.

   Docs: https://openrouter.ai/docs
   ========================================================================== */

const fetch = require("node-fetch");

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

/**
 * Sends a chat completion request to OpenRouter.
 * @param {Array<{role: string, content: any}>} messages - OpenAI-style message array
 *        (content can be a string, or an array of {type, text}/{type, image_url}
 *        parts for multimodal/vision requests)
 * @param {Object} [options]
 * @param {string} [options.model] - overrides OPENROUTER_MODEL for this call
 * @param {number} [options.maxTokens]
 * @param {number} [options.temperature]
 * @returns {Promise<{ text: string, model: string, usage: object }>}
 */
async function callOpenRouter(messages, options = {}) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not configured on the server.");
  }

  const model = options.model || process.env.OPENROUTER_MODEL;
  if (!model) {
    throw new Error("OPENROUTER_MODEL is not configured on the server.");
  }

  const maxTokens = options.maxTokens || parseInt(process.env.MAX_TOKENS || "1024", 10);
  const temperature = options.temperature !== undefined
    ? options.temperature
    : parseFloat(process.env.TEMPERATURE || "0.7");

  const startedAt = Date.now();

  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      // OpenRouter uses these two (optional but recommended) for attribution/rankings
      "HTTP-Referer": process.env.ALLOWED_ORIGIN || "https://vivy-ai.app",
      "X-Title": "Vivy AI"
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: maxTokens,
      temperature
    })
  });

  const elapsedMs = Date.now() - startedAt;

  if (!response.ok) {
    const errBody = await response.text().catch(() => "");
    console.error(`[OpenRouter] ${response.status} error in ${elapsedMs}ms — model: ${model}`);
    throw new Error(`OpenRouter request failed (${response.status}): ${errBody.slice(0, 300)}`);
  }

  const data = await response.json();
  const choice = data.choices && data.choices[0];

  if (!choice) {
    throw new Error("OpenRouter returned no completion choices.");
  }

  console.log(`[OpenRouter] model=${model} time=${elapsedMs}ms tokens=${data.usage?.total_tokens ?? "n/a"}`);

  return {
    text: choice.message?.content || "",
    model: data.model || model,
    usage: data.usage || {},
    elapsedMs
  };
}

module.exports = { callOpenRouter };
