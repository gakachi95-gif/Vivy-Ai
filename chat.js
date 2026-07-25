/* ==========================================================================
   VIVY AI — chat.js
   Powers chat.html: conversation state, Firestore persistence, message
   rendering (markdown), typing animation, copy/regenerate/delete, search,
   pin/favorite, share, and export to TXT/PDF.
   ========================================================================== */

let currentUser = null;
let currentConvoId = null;
let messages = []; // { id, role: 'user'|'ai', text, ts }
let isGenerating = false;

const elMessages = () => document.getElementById("chat-messages");
const elInput = () => document.getElementById("chat-input");

/* -----------------------------  INIT  --------------------------------------- */
(async function initChat() {
  currentUser = await requireAuth();

  // Load an existing conversation if id passed in URL (?id=...), else start fresh
  const params = new URLSearchParams(window.location.search);
  currentConvoId = params.get("id");

  if (currentConvoId) {
    await loadConversation(currentConvoId);
  } else {
    renderEmptyState();
  }

  document.getElementById("chat-form").addEventListener("submit", handleSend);
  elInput().addEventListener("input", autoGrow);
  elInput().addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      document.getElementById("chat-form").requestSubmit();
    }
  });
})();

function autoGrow() {
  const el = elInput();
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 120) + "px";
}

function renderEmptyState() {
  elMessages().innerHTML = `
    <div class="empty-state">
      <span class="material-icons">forum</span>
      <p>Start a conversation with Vivy AI</p>
    </div>`;
}

/* -----------------------------  SEND MESSAGE  --------------------------------- */
async function handleSend(e) {
  e.preventDefault();
  if (isGenerating) return;

  const text = cleanText(elInput().value);
  if (!text) return;

  // Check usage limits
  const profile = await VivyUser.ensureDailyReset(currentUser.uid);
  const remaining = VivyUser.remaining(profile);
  if (remaining <= 0) {
    showNotification("warning", "Daily AI limit reached. Upgrade to Premium for unlimited messages.");
    return;
  }

  elInput().value = "";
  autoGrow();

  addMessage("user", text);
  await persistMessage("user", text);

  await generateAiReply(text);
}

/* -----------------------------  RENDER MESSAGE  -------------------------------- */
function addMessage(role, text, id = uid()) {
  if (document.querySelector(".empty-state")) elMessages().innerHTML = "";

  const wrap = document.createElement("div");
  wrap.className = `msg ${role === "user" ? "msg-user" : "msg-ai"}`;
  wrap.dataset.id = id;
  wrap.dataset.role = role;
  wrap.dataset.raw = text;
  wrap.innerHTML = markdownToHtml(text);

  if (role === "ai") {
    const actions = document.createElement("div");
    actions.className = "msg-actions";
    actions.innerHTML = `
      <button data-action="copy"><span class="material-icons">content_copy</span>Copy</button>
      <button data-action="regenerate"><span class="material-icons">refresh</span>Regenerate</button>
      <button data-action="delete"><span class="material-icons">delete</span>Delete</button>
    `;
    wrap.appendChild(actions);
    actions.addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      const action = btn.dataset.action;
      if (action === "copy") copyMessage(wrap.dataset.raw);
      if (action === "regenerate") regenerateMessage(id);
      if (action === "delete") deleteMessage(id);
    });
  }

  elMessages().appendChild(wrap);
  elMessages().scrollTop = elMessages().scrollHeight;
  messages.push({ id, role, text });
  return wrap;
}

function copyMessage(text) {
  navigator.clipboard.writeText(text).then(() => showNotification("success", "Copied to clipboard"));
}

function deleteMessage(id) {
  messages = messages.filter((m) => m.id !== id);
  document.querySelector(`[data-id="${id}"]`)?.remove();
  saveConversation();
  if (messages.length === 0) renderEmptyState();
}

async function regenerateMessage(id) {
  const idx = messages.findIndex((m) => m.id === id);
  if (idx < 1) return;
  const userMsg = messages[idx - 1];
  deleteMessage(id);
  await generateAiReply(userMsg.text, true);
}

/* -----------------------------  AI REPLY + TYPING ANIMATION  -------------------- */
async function generateAiReply(prompt, isRegen = false) {
  isGenerating = true;
  document.getElementById("send-btn").disabled = true;

  const typingEl = document.createElement("div");
  typingEl.className = "msg msg-ai";
  typingEl.innerHTML = `<div class="typing-dots"><span></span><span></span><span></span></div>`;
  elMessages().appendChild(typingEl);
  elMessages().scrollTop = elMessages().scrollHeight;

  try {
    const reply = await VivyAI.generate({ task: "chat", prompt });
    typingEl.remove();
    await typeOutMessage(reply);
    await persistMessage("ai", reply);
    await VivyUser.incrementUsage(currentUser.uid);
  } catch (err) {
    typingEl.remove();
    showNotification("error", "Failed to get AI response. Please try again.");
  } finally {
    isGenerating = false;
    document.getElementById("send-btn").disabled = false;
  }
}

/** Reveals the AI's reply progressively for a "typing" feel. */
function typeOutMessage(fullText) {
  return new Promise((resolve) => {
    const id = uid();
    const el = addMessage("ai", "", id);
    let i = 0;
    const speed = fullText.length > 400 ? 4 : 14; // chars per tick, faster for long text
    const interval = setInterval(() => {
      i += speed;
      const partial = fullText.slice(0, i);
      el.innerHTML = markdownToHtml(partial);
      elMessages().scrollTop = elMessages().scrollHeight;
      if (i >= fullText.length) {
        clearInterval(interval);
        el.dataset.raw = fullText;
        el.innerHTML = markdownToHtml(fullText);
        // Re-attach action buttons since innerHTML was replaced
        attachMessageActions(el, id, fullText);
        messages[messages.length - 1].text = fullText;
        resolve();
      }
    }, 25);
  });
}

function attachMessageActions(wrap, id, text) {
  const actions = document.createElement("div");
  actions.className = "msg-actions";
  actions.innerHTML = `
    <button data-action="copy"><span class="material-icons">content_copy</span>Copy</button>
    <button data-action="regenerate"><span class="material-icons">refresh</span>Regenerate</button>
    <button data-action="delete"><span class="material-icons">delete</span>Delete</button>
  `;
  wrap.appendChild(actions);
  actions.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === "copy") copyMessage(text);
    if (action === "regenerate") regenerateMessage(id);
    if (action === "delete") deleteMessage(id);
  });
}

/* -----------------------------  FIRESTORE PERSISTENCE  --------------------------- */
async function persistMessage(role, text) {
  if (!currentConvoId) {
    // Create a new conversation document on first message
    const ref = await db.collection("users").doc(currentUser.uid).collection("conversations").add({
      title: text.slice(0, 40) || "New chat",
      pinned: false,
      favorite: false,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      messages: []
    });
    currentConvoId = ref.id;
    history.replaceState(null, "", `chat.html?id=${currentConvoId}`);
  }
  await db.collection("users").doc(currentUser.uid).collection("conversations").doc(currentConvoId).update({
    messages: firebase.firestore.FieldValue.arrayUnion({ role, text, ts: Date.now() }),
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  });
}

/** Full re-save (used after local delete, where arrayUnion won't help). */
async function saveConversation() {
  if (!currentConvoId) return;
  await db.collection("users").doc(currentUser.uid).collection("conversations").doc(currentConvoId).update({
    messages: messages.map((m) => ({ role: m.role, text: m.text, ts: Date.now() })),
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  });
}

async function loadConversation(id) {
  const doc = await db.collection("users").doc(currentUser.uid).collection("conversations").doc(id).get();
  if (!doc.exists) {
    renderEmptyState();
    return;
  }
  const data = doc.data();
  elMessages().innerHTML = "";
  messages = [];
  (data.messages || []).forEach((m) => addMessage(m.role, m.text));
  document.getElementById("chat-title").textContent = data.title || "Chat";
}

/* -----------------------------  SHARE / EXPORT  ------------------------------------ */
function shareConversation() {
  const text = messages.map((m) => `${m.role === "user" ? "You" : "Vivy AI"}: ${m.text}`).join("\n\n");
  if (navigator.share) {
    navigator.share({ title: "Vivy AI Conversation", text }).catch(() => {});
  } else {
    navigator.clipboard.writeText(text);
    showNotification("info", "Sharing not supported here — conversation copied to clipboard instead.");
  }
}

function downloadAsTxt() {
  const text = messages.map((m) => `${m.role === "user" ? "You" : "Vivy AI"}: ${m.text}`).join("\n\n");
  const blob = new Blob([text], { type: "text/plain" });
  triggerDownload(blob, "vivy-ai-chat.txt");
}

function downloadAsPdf() {
  if (!window.jspdf) {
    showNotification("error", "PDF export library failed to load.");
    return;
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const lines = doc.splitTextToSize(
    messages.map((m) => `${m.role === "user" ? "You" : "Vivy AI"}: ${m.text}`).join("\n\n"),
    180
  );
  doc.setFontSize(11);
  doc.text(lines, 15, 20);
  doc.save("vivy-ai-chat.pdf");
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/* -----------------------------  SEARCH (within current chat)  ----------------------- */
function searchInChat(query) {
  const q = query.trim().toLowerCase();
  document.querySelectorAll(".msg").forEach((el) => {
    const match = !q || (el.dataset.raw || "").toLowerCase().includes(q);
    el.style.display = match ? "" : "none";
  });
}

/* -----------------------------  PIN / FAVORITE (current conversation)  --------------- */
async function togglePin() {
  if (!currentConvoId) return;
  const ref = db.collection("users").doc(currentUser.uid).collection("conversations").doc(currentConvoId);
  const snap = await ref.get();
  const newVal = !snap.data().pinned;
  await ref.update({ pinned: newVal });
  showNotification("success", newVal ? "Conversation pinned" : "Unpinned conversation");
}

async function toggleFavorite() {
  if (!currentConvoId) return;
  const ref = db.collection("users").doc(currentUser.uid).collection("conversations").doc(currentConvoId);
  const snap = await ref.get();
  const newVal = !snap.data().favorite;
  await ref.update({ favorite: newVal });
  showNotification("success", newVal ? "Added to favorites" : "Removed from favorites");
}
