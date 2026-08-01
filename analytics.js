/* ==========================================================================
   VIVY AI — js/analytics.js
   Analytics dashboard for the Marketing Agent. Counts (campaigns, posts,
   scheduled, published) are computed from real Firestore data; reach and
   growth are demo/sample data for Phase 1, clearly labeled as such, since
   there's no real posting/analytics API integration yet (that's Phase 2).
   ========================================================================== */

const VivyAnalytics = {
  _chart: null,

  computeCounts(campaigns, posts) {
    return {
      totalCampaigns: campaigns.length,
      generatedPosts: posts.length,
      scheduledPosts: posts.filter((p) => p.status === "scheduled").length,
      publishedPosts: posts.filter((p) => p.status === "published").length
    };
  },

  /** Phase 1 demo estimate — replace with real platform analytics in Phase 2. */
  estimateReach(posts) {
    const perPostReach = { facebook: 850, instagram: 1200, linkedin: 400, x: 600, threads: 350, pinterest: 700 };
    return posts.reduce((sum, p) => sum + (perPostReach[p.platform] || 500), 0);
  },

  renderCounts(counts, reach) {
    document.getElementById("stat-total-campaigns").textContent = counts.totalCampaigns;
    document.getElementById("stat-generated-posts").textContent = counts.generatedPosts;
    document.getElementById("stat-scheduled-posts").textContent = counts.scheduledPosts;
    document.getElementById("stat-published-posts").textContent = counts.publishedPosts;
    document.getElementById("stat-estimated-reach").textContent = reach.toLocaleString();
  },

  /** Bar chart: posts generated per platform (real data). */
  renderPlatformChart(posts) {
    const canvas = document.getElementById("platform-chart");
    if (!canvas || typeof Chart === "undefined") return;

    const counts = {};
    posts.forEach((p) => { counts[p.platform] = (counts[p.platform] || 0) + 1; });
    const labels = Object.keys(counts).map((k) => VivyCampaigns.PLATFORM_LABELS[k] || k);
    const data = Object.values(counts);

    if (this._chart) this._chart.destroy();
    this._chart = new Chart(canvas, {
      type: "bar",
      data: {
        labels,
        datasets: [{
          label: "Posts",
          data,
          backgroundColor: "#8b5cf6",
          borderRadius: 8
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, ticks: { color: "#b6aed1" }, grid: { color: "rgba(255,255,255,0.06)" } },
          x: { ticks: { color: "#b6aed1" }, grid: { display: false } }
        }
      }
    });
  },

  /** Line chart: sample growth trend — demo data, Phase 2 will use real platform metrics. */
  renderGrowthChart() {
    const canvas = document.getElementById("growth-chart");
    if (!canvas || typeof Chart === "undefined") return;

    const labels = ["Week 1", "Week 2", "Week 3", "Week 4"];
    const sample = [120, 340, 610, 980]; // demo data

    new Chart(canvas, {
      type: "line",
      data: {
        labels,
        datasets: [{
          label: "Estimated Reach (demo)",
          data: sample,
          borderColor: "#a855f7",
          backgroundColor: "rgba(168,85,247,0.15)",
          fill: true,
          tension: 0.35
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          y: { ticks: { color: "#b6aed1" }, grid: { color: "rgba(255,255,255,0.06)" } },
          x: { ticks: { color: "#b6aed1" }, grid: { display: false } }
        }
      }
    });
  },

  async render(campaigns, posts) {
    const counts = this.computeCounts(campaigns, posts);
    const reach = this.estimateReach(posts);
    this.renderCounts(counts, reach);
    this.renderPlatformChart(posts);
    this.renderGrowthChart();
  }
};
