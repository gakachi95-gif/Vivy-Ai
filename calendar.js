/* ==========================================================================
   VIVY AI — js/calendar.js
   Renders the content calendar (all posts across all campaigns, grouped by
   date) and handles per-post actions: edit, delete, duplicate, move/
   reschedule, and publish status. Depends on VivyMarketing for storage and
   sanitizeInput/markdownToHtml/showNotification from utils.js.
   ========================================================================== */

const VivyCalendar = {
  PLATFORM_ICONS: {
    facebook: "thumb_up",
    instagram: "photo_camera",
    linkedin: "work",
    x: "tag",
    threads: "forum",
    pinterest: "push_pin"
  },

  STATUS_LABELS: { draft: "Draft", scheduled: "Scheduled", published: "Published" },

  /** Groups a flat post list into { "2026-08-01": [post, post], ... } */
  groupByDate(posts) {
    const groups = {};
    posts.forEach((p) => {
      if (!groups[p.date]) groups[p.date] = [];
      groups[p.date].push(p);
    });
    return groups;
  },

  /** Renders the calendar into the given container element. */
  render(container, posts) {
    if (posts.length === 0) {
      container.innerHTML = `<div class="empty-state"><span class="material-icons">calendar_month</span><p>No posts yet — generate a campaign to fill your calendar.</p></div>`;
      return;
    }

    const groups = this.groupByDate(posts);
    const dates = Object.keys(groups).sort();

    container.innerHTML = dates
      .map((date) => {
        const dayPosts = groups[date];
        const label = new Date(date + "T00:00:00").toLocaleDateString(undefined, {
          weekday: "short",
          month: "short",
          day: "numeric"
        });
        return `
          <div class="calendar-day">
            <div class="calendar-day-label">${label}</div>
            <div class="calendar-posts">
              ${dayPosts.map((p) => this._postCard(p)).join("")}
            </div>
          </div>`;
      })
      .join("");
  },

  _postCard(post) {
    const icon = this.PLATFORM_ICONS[post.platform] || "public";
    const statusClass = `status-${post.status}`;
    return `
      <div class="post-card" data-post-id="${post.id}" data-campaign-id="${post.campaignId}">
        <div class="post-card-head">
          <span class="material-icons post-platform-icon">${icon}</span>
          <span class="post-platform-name">${sanitizeInput(VivyCampaigns.PLATFORM_LABELS[post.platform] || post.platform)}</span>
          <span class="post-status ${statusClass}">${this.STATUS_LABELS[post.status] || post.status}</span>
        </div>
        <p class="post-caption">${sanitizeInput(post.caption).slice(0, 140)}${post.caption.length > 140 ? "…" : ""}</p>
        <div class="post-hashtags">${(post.hashtags || []).slice(0, 4).map((h) => `<span>${sanitizeInput(h)}</span>`).join(" ")}</div>
        <div class="post-actions">
          <button class="btn-icon" title="Edit" onclick="VivyCalendar.openEditor('${post.campaignId}','${post.id}')"><span class="material-icons">edit</span></button>
          <button class="btn-icon" title="Duplicate" onclick="VivyCalendar.duplicate('${post.campaignId}','${post.id}')"><span class="material-icons">content_copy</span></button>
          <button class="btn-icon" title="Reschedule" onclick="VivyCalendar.openReschedule('${post.campaignId}','${post.id}')"><span class="material-icons">event</span></button>
          <button class="btn-icon" title="Delete" onclick="VivyCalendar.remove('${post.campaignId}','${post.id}')"><span class="material-icons">delete</span></button>
        </div>
      </div>`;
  },

  /* -----------------------------  ACTIONS  ---------------------------------- */
  // These are set by marketing-agent.js at init time so this module doesn't
  // need to know about the current user or trigger a re-render itself.
  _uid: null,
  _onChange: null,
  init(uid, onChange) {
    this._uid = uid;
    this._onChange = onChange;
  },

  async remove(campaignId, postId) {
    if (!confirm("Delete this post? This can't be undone.")) return;
    await VivyMarketing.deletePost(this._uid, campaignId, postId);
    showNotification("success", "Post deleted.");
    if (this._onChange) this._onChange();
  },

  async duplicate(campaignId, postId) {
    const posts = await VivyMarketing.getPosts(this._uid, campaignId);
    const post = posts.find((p) => p.id === postId);
    if (!post) return;
    await VivyMarketing.duplicatePost(this._uid, campaignId, post);
    showNotification("success", "Post duplicated as a new draft.");
    if (this._onChange) this._onChange();
  },

  async openEditor(campaignId, postId) {
    const posts = await VivyMarketing.getPosts(this._uid, campaignId);
    const post = posts.find((p) => p.id === postId);
    if (!post) return;

    document.getElementById("editor-caption").value = post.caption;
    document.getElementById("editor-cta").value = post.cta;
    document.getElementById("editor-hashtags").value = (post.hashtags || []).join(" ");
    document.getElementById("editor-image-prompt").value = post.imagePrompt;
    document.getElementById("editor-status").value = post.status;
    document.getElementById("post-editor-modal").dataset.campaignId = campaignId;
    document.getElementById("post-editor-modal").dataset.postId = postId;
    document.getElementById("post-editor-modal").style.display = "flex";
  },

  async saveEditor() {
    const modal = document.getElementById("post-editor-modal");
    const { campaignId, postId } = modal.dataset;
    await VivyMarketing.updatePost(this._uid, campaignId, postId, {
      caption: cleanText(document.getElementById("editor-caption").value, 2000),
      cta: cleanText(document.getElementById("editor-cta").value, 200),
      hashtags: document.getElementById("editor-hashtags").value.match(/#[\w]+/g) || [],
      imagePrompt: cleanText(document.getElementById("editor-image-prompt").value, 500),
      status: document.getElementById("editor-status").value
    });
    modal.style.display = "none";
    showNotification("success", "Post updated.");
    if (this._onChange) this._onChange();
  },

  async openReschedule(campaignId, postId) {
    const posts = await VivyMarketing.getPosts(this._uid, campaignId);
    const post = posts.find((p) => p.id === postId);
    if (!post) return;
    document.getElementById("reschedule-date").value = post.date;
    document.getElementById("reschedule-modal").dataset.campaignId = campaignId;
    document.getElementById("reschedule-modal").dataset.postId = postId;
    document.getElementById("reschedule-modal").style.display = "flex";
  },

  async saveReschedule() {
    const modal = document.getElementById("reschedule-modal");
    const { campaignId, postId } = modal.dataset;
    const newDate = document.getElementById("reschedule-date").value;
    if (!newDate) return;
    await VivyMarketing.updatePost(this._uid, campaignId, postId, { date: newDate, status: "scheduled" });
    modal.style.display = "none";
    showNotification("success", "Post rescheduled.");
    if (this._onChange) this._onChange();
  }
};
