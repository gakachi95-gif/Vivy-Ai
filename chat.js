/* ==========================================================================
   VIVY AI — chat.js
   Page controller for chat.html. Handles: auth guard, loading/creating a
   conversation, sending messages through VivyAI.generate(), persisting to
   Firestore, and the header actions (pin, favorite, search, share, export).
   ========================================================================== */

let chatUser = null;
let convoRef = null;
let convoId = null;
let messages = []; // { role: "user" | "ai", text: string }
let convoTitle = "New Chat";
let isPinned = false;
let isFavorite = false;
let sending = false;

const chatMessagesEl = document.getElementById("chat-messages");
const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-input");
const chatTitleEl = document.getElementById("chat-title");

(async function initChat() {
  chatUser = await requireAuth();

  const params = new URLSearchParams(window.location.search);
  convoId = params.get("id");

  if (convoId) {
    await loadConversation(convoId);
  } else {
    renderEmptyState();
  }

  chatInput.addEventListener("input", autoResizeInput);
  chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      chatForm.requestSubmit();
    }
  });
})();

chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = cleanText(chatInput.value, 6000);
  if (!text || sending) return;
  chatInput.value = "";
  autoResizeInput();
  await sendMessage(text);
});

/* -----------------------------  LOADING  ----------------------------------- */
async function loadConversation(id) {
  convoRef = db.collection("users").doc(chatUser.uid).collection("conversations").doc(id);
  const snap = await convoRef.get();
  if (!snap.exists) {
    showNotification("error", "That conversation could not be found.");
    renderEmptyState();
    convoRef = null;
    convoId = null;
    return;
  }
  const data = snap.data();
  messages = data.messages || [];
  convoTitle = data.title || "New Chat";
  isPinned = !!data.pinned;
  isFavorite = !!data.favorite;

  chatTitleEl.textContent = convoTitle;
  updatePinFavIcons();
  chatMessagesEl.innerHTML = "";
  messages.forEach((m) => renderBubble(m.role, m.text));
  scrollToBottom();
}

function renderEmptyState() {
  chatMessagesEl.innerHTML = `
    <div class="empty-state">
      <span class="material-icons">chat_bubble_outline</span>
      <p>Say hello to start a new conversation.</p>
    </div>`;
}

/* -----------------------------  SENDING  ------------------------------------ */
async function sendMessage(text) {
  sending = true;
  document.getElementById("send-btn").disabled = true;

  // Enforce the daily plan limit before spending a request
  const profile = await VivyUser.ensureDailyReset(chatUser.uid);
  const remaining = VivyUser.remaining(profile);
  if (remaining <= 0) {
    showNotification("warning", "You've hit your daily message limit. Upgrade to Premium for unlimited messages.");
    sending = false;
    document.getElementById("send-btn").disabled = false;
    return;
  }

  if (chatMessagesEl.querySelector(".empty-state")) chatMessagesEl.innerHTML = "";

  messages.push({ role: "user", text });
  renderBubble("user", text);
  scrollToBottom();

  const typingEl = renderTypingIndicator();

  try {
    const reply = await VivyAI.generate({
      task: "chat",
      prompt: text,
      meta: { conversation: messages.slice(-20) }
    });

    typingEl.remove();
    messages.push({ role: "ai", text: reply });
    renderBubble("ai", reply);
    scrollToBottom();

    await saveConversation();
  } catch (err) {
    typingEl.remove();
    // Roll back the optimistic user message so a failed send can be retried
    messages.pop();
    showNotification("error", err.message || "Failed to get a response. Please try again.");
  } finally {
    sending = false;
    document.getElementById("send-btn").disabled = false;
  }
}

async function saveConversation() {
  if (!convoRef) {
    convoRef = db.collection("users").doc(chatUser.uid).collection("conversations").doc();
    convoId = convoRef.id;
    convoTitle = messages[0].text.slice(0, 50) || "New Chat";
    chatTitleEl.textContent = convoTitle;
    window.history.replaceState(null, "", `chat.html?id=${convoId}`);

    await convoRef.set({
      title: convoTitle,
      messages,
      pinned: false,
      favorite: false,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  } else {
    await convoRef.update({
      messages,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  }
}

/* -----------------------------  RENDERING  ---------------------------------- */
function renderBubble(role, text) {
  const bubble = document.createElement("div");
  bubble.className = `msg msg-${role}`;
  bubble.innerHTML = role === "ai" ? markdownToHtml(text) : sanitizeInput(text);
  chatMessagesEl.appendChild(bubble);
  return bubble;
}

function renderTypingIndicator() {
  const bubble = document.createElement("div");
  bubble.className = "msg msg-ai";
  bubble.id = "typing-indicator";
  bubble.innerHTML = `<span class="typing-dots"><span></span><span></span><span></span></span>`;
  chatMessagesEl.appendChild(bubble);
  scrollToBottom();
  return bubble;
}

function scrollToBottom() {
  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
}

function autoResizeInput() {
  chatInput.style.height = "auto";
  chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + "px";
}

/* -----------------------------  HEADER ACTIONS  ------------------------------ */
function updatePinFavIcons() {
  document.getElementById("pin-btn").classList.toggle("active", isPinned);
  document.getElementById("fav-btn").classList.toggle("active", isFavorite);
}

async function togglePin() {
  if (!convoRef) {
    showNotification("info", "Send a message first to start a conversation.");
    return;
  }
  isPinned = !isPinned;
  updatePinFavIcons();
  await convoRef.update({ pinned: isPinned });
  showNotification("success", isPinned ? "Conversation pinned." : "Conversation unpinned.");
}

async function toggleFavorite() {
  if (!convoRef) {
    showNotification("info", "Send a message first to start a conversation.");
    return;
  }
  isFavorite = !isFavorite;
  updatePinFavIcons();
  await convoRef.update({ favorite: isFavorite });
  showNotification("success", isFavorite ? "Added to favorites." : "Removed from favorites.");
}

function searchInChat(query) {
  const q = query.trim().toLowerCase();
  chatMessagesEl.querySelectorAll(".msg").forEach((bubble, i) => {
    const text = (messages[i]?.text || "").toLowerCase();
    bubble.style.display = !q || text.includes(q) ? "" : "none";
  });
}

async function shareConversation() {
  if (!convoId) {
    showNotification("info", "Send a message first to create a shareable conversation.");
    return;
  }
  const url = `${window.location.origin}${window.location.pathname}?id=${convoId}`;
  if (navigator.share) {
    try {
      await navigator.share({ title: convoTitle, url });
    } catch (e) {
      /* user cancelled the share sheet — nothing to do */
    }
  } else {
    await navigator.clipboard.writeText(url);
    showNotification("success", "Link copied to clipboard.");
  }
}

function downloadAsTxt() {
  if (messages.length === 0) {
    showNotification("info", "There's nothing to export yet.");
    return;
  }
  const lines = messages.map((m) => `${m.role === "user" ? "You" : "Vivy AI"}: ${m.text}`);
  const blob = new Blob([lines.join("\n\n")], { type: "text/plain" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${convoTitle.replace(/[^a-z0-9]/gi, "_")}.txt`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function downloadAsPdf() {
  if (messages.length === 0) {
    showNotification("info", "There's nothing to export yet.");
    return;
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "pt" });
  const margin = 40;
  const maxWidth = doc.internal.pageSize.getWidth() - margin * 2;
  let y = margin;

  doc.setFontSize(14);
  doc.text(convoTitle, margin, y);
  y += 24;
  doc.setFontSize(11);

  messages.forEach((m) => {
    const label = m.role === "user" ? "You:" : "Vivy AI:";
    const lines = doc.splitTextToSize(`${label} ${m.text}`, maxWidth);
    lines.forEach((line) => {
      if (y > doc.internal.pageSize.getHeight() - margin) {
        doc.addPage();
        y = margin;
      }
      doc.text(line, margin, y);
      y += 16;
    });
    y += 8;
  });

  doc.save(`${convoTitle.replace(/[^a-z0-9]/gi, "_")}.pdf`);
}
