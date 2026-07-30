/* ==========================================================================
   VIVY AI — writer.js
   Powers writer.html: content-type selection (blog, email, story, social
   posts, YouTube metadata, business plans...), generation, and saving
   results to Firestore history.
   ========================================================================== */

let writerUser = null;
let selectedFormat = "Blog Post";

const WRITER_FORMATS = [
  "Blog Post", "Email", "Story", "Essay", "Product Description",
  "Facebook Post", "Instagram Caption", "LinkedIn Post", "X (Twitter) Post",
  "YouTube Title", "YouTube Description", "YouTube Tags", "Business Plan"
];

(async function initWriter() {
  writerUser = await requireAuth();
  renderFormatTabs();
})();

function renderFormatTabs() {
  const wrap = document.getElementById("format-tabs");
  wrap.innerHTML = WRITER_FORMATS.map(
    (f, i) => `<button class="tab-btn ${i === 0 ? "active" : ""}" data-format="${f}">${f}</button>`
  ).join("");
  wrap.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      wrap.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      selectedFormat = btn.dataset.format;
    });
  });
}

async function generateWriterContent() {
  const topic = cleanText(document.getElementById("writer-topic").value);
  const tone = document.getElementById("writer-tone").value;
  const resultBox = document.getElementById("writer-result");

  if (!topic) {
    showNotification("warning", "Please describe what you'd like written.");
    return;
  }

  const profile = await VivyUser.ensureDailyReset(writerUser.uid);
  if (VivyUser.remaining(profile) <= 0) {
    showNotification("warning", "Daily AI limit reached. Upgrade to Premium for unlimited generations.");
    return;
  }

  setWriterLoading(true);
  try {
    const text = await VivyAI.generate({
      task: "writer",
      prompt: topic,
      meta: { format: selectedFormat, tone }
    });
    resultBox.innerHTML = markdownToHtml(text);
    resultBox.dataset.raw = text;
    document.getElementById("writer-result-actions").style.display = "flex";
    await saveWriterHistory(selectedFormat, topic, text);
  } catch (err) {
    showNotification("error", "Generation failed. Please try again.");
  } finally {
    setWriterLoading(false);
  }
}

function setWriterLoading(loading) {
  const btn = document.getElementById("writer-generate-btn");
  btn.disabled = loading;
  btn.innerHTML = loading
    ? `<span class="spinner" style="width:18px;height:18px;border-width:2px;"></span> Generating...`
    : `<span class="material-icons">auto_awesome</span> Generate`;
  if (loading) {
    document.getElementById("writer-result").innerHTML = `
      <div class="skeleton skeleton-line" style="width:90%;"></div>
      <div class="skeleton skeleton-line" style="width:75%;"></div>
      <div class="skeleton skeleton-line" style="width:85%;"></div>`;
  }
}

function copyWriterResult() {
  const raw = document.getElementById("writer-result").dataset.raw || "";
  navigator.clipboard.writeText(raw).then(() => showNotification("success", "Copied to clipboard"));
}

async function saveWriterHistory(format, topic, text) {
  await db.collection("users").doc(writerUser.uid).collection("history").add({
    type: "writer",
    title: `${format}: ${topic.slice(0, 30)}`,
    content: text,
    pinned: false,
    favorite: false,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
}
