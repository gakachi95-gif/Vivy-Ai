/* ==========================================================================
   providers/aiService.js
   The single entry point every route calls. Knows about Vivy AI's TASKS
   (chat, writer, summarize, translate, brainstorm, image-analysis) and how
   to turn each one into a well-formed OpenRouter chat-completion request.
   Swapping AI providers in the future only means changing what this file
   imports — routes never talk to openrouter.js directly.
   ========================================================================== */

const { callOpenRouter } = require("./openrouter");

const SYSTEM_PROMPTS = {
  chat: "You are Vivy AI, a warm, helpful, and knowledgeable personal assistant. Give clear, well-formatted answers using markdown where useful.",
  writer: "You are Vivy AI's writing assistant. Produce polished, well-structured, ready-to-use content in the requested format and tone. Use markdown formatting.",
  summarize: "You are Vivy AI's summarization assistant. Given a block of text, respond with three clearly labeled markdown sections: '**Short Summary**' (2-3 sentences), '**Bullet Points**' (5-8 bullets), and '**Key Ideas**' (2-3 sentences on the core takeaway).",
  translate: "You are Vivy AI's translation assistant. Detect the source language automatically and translate accurately and naturally into the requested target language. Return ONLY the translated text, no explanations.",
  brainstorm: "You are Vivy AI's brainstorming assistant. Given a topic and category, generate 8-10 creative, distinct, actionable ideas as a numbered markdown list.",
  imageAnalysis: "You are Vivy AI's vision assistant. Carefully analyze the provided image and respond to the user's request — describing the image, reading any visible text (OCR), answering a specific question about it, or extracting key structured information, as requested."
};

/**
 * @param {string} task - "chat" | "writer" | "summarize" | "translate" | "brainstorm" | "imageAnalysis"
 * @param {Object} payload - task-specific fields (see routes/*.js for exact shape)
 * @returns {Promise<{ reply: string, model: string, usage: object }>}
 */
async function generate(task, payload) {
  const messages = buildMessages(task, payload);
  const result = await callOpenRouter(messages);
  return {
    reply: result.text,
    model: result.model,
    usage: result.usage
  };
}

function buildMessages(task, payload) {
  switch (task) {
    case "chat": {
      // Preserve prior turns if the frontend sends conversation history
      const history = Array.isArray(payload.conversation) ? payload.conversation.slice(-20) : [];
      const historyMessages = history
        .filter((m) => m && typeof m.text === "string" && (m.role === "user" || m.role === "ai"))
        .map((m) => ({ role: m.role === "ai" ? "assistant" : "user", content: m.text }));

      return [
        { role: "system", content: SYSTEM_PROMPTS.chat },
        ...historyMessages,
        { role: "user", content: payload.message }
      ];
    }

    case "writer": {
      const { topic, format = "Blog Post", tone = "Professional" } = payload;
      return [
        { role: "system", content: SYSTEM_PROMPTS.writer },
        { role: "user", content: `Write a ${format} with a ${tone} tone about: ${topic}` }
      ];
    }

    case "summarize": {
      return [
        { role: "system", content: SYSTEM_PROMPTS.summarize },
        { role: "user", content: payload.text }
      ];
    }

    case "translate": {
      const { text, targetLang = "Spanish" } = payload;
      return [
        { role: "system", content: SYSTEM_PROMPTS.translate },
        { role: "user", content: `Translate the following text into ${targetLang}:\n\n${text}` }
      ];
    }

    case "brainstorm": {
      const { topic, category = "Business" } = payload;
      return [
        { role: "system", content: SYSTEM_PROMPTS.brainstorm },
        { role: "user", content: `Category: ${category}\nTopic/keyword: ${topic}` }
      ];
    }

    case "imageAnalysis": {
      const { imageBase64, question = "Describe this image in detail." } = payload;
      // Multimodal message — OpenRouter follows the OpenAI vision content-array format.
      // The chosen OPENROUTER_MODEL must be vision-capable (e.g. anthropic/claude-sonnet-4,
      // openai/gpt-5, google/gemini-2.5-pro) or this will be rejected by the provider.
      return [
        { role: "system", content: SYSTEM_PROMPTS.imageAnalysis },
        {
          role: "user",
          content: [
            { type: "text", text: question },
            { type: "image_url", image_url: { url: imageBase64 } }
          ]
        }
      ];
    }

    default:
      throw new Error(`Unknown AI task: "${task}"`);
  }
}

module.exports = { generate };
