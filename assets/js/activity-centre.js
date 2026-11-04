(function () {
  const S = window.BlissStaff;
  let me = null;
  let page = 1;
  let total = 0;

  const el = id => document.getElementById(id);

  function actionIcon(action) {
    if (String(action).startsWith("client")) return "👥";
    if (String(action).startsWith("property")) return "🏡";
    if (String(action).startsWith("lead")) return "🎯";
    if (String(action).startsWith("staff")) return "👔";
    if (String(action).startsWith("team")) return "🧩";
    if (String(action).startsWith("payment")) return "💳";
    if (String(action).startsWith("installment")) return "📅";
    return "•";
  }

  function params() {
    const query = new URLSearchParams();
    query.set("page", String(page));
    query.set("limit", "20");
    if (el("activityType").value) query.set("type", el("activityType").value);
    if (el("activityFrom").value) query.set("from", el("activityFrom").value);
    if (el("activityTo").value) query.set("to", el("activityTo").value);
    return query;
  }

  async function load() {
    try {
      const data = await S.fetchJson("/api/activity?" + params().toString());
      const rows = data.activities || [];
      total = data.pagination ? data.pagination.total : rows.length;
      el("activityCount").textContent = `${total} event${total === 1 ? "" : "s"}`;
      const pages = Math.max(1, Math.ceil(total / 20));
      el("activityPageLabel").textContent = `Page ${page} of ${pages}`;
      el("activityPrev").disabled = page <= 1;
      el("activityNext").disabled = page >= pages;
      el("activityFeed").innerHTML = rows.length ? rows.map(row => {
        const meta = row.metadata || {};
        const details = Object.entries(meta)
          .filter(([, value]) => value !== null && value !== undefined && typeof value !== "object")
          .slice(0, 4)
          .map(([key, value]) => `<span>${S.escape(key.replace(/_/g, " "))}: ${S.escape(value)}</span>`)
          .join("");
        return `<div class="activity-item">
          <div class="activity-dot">${actionIcon(row.action)}</div>
          <div class="activity-main">
            <strong>${S.escape(row.action.replace(/\./g, " · "))}</strong>
            <p>${S.escape(row.target_type || "record")}${row.target_id ? " #" + S.escape(row.target_id) : ""}</p>
            <div class="activity-meta">
              <span>${S.escape(row.actor_name || "System")}</span>
              <span>${S.escape(row.actor_role || "")}</span>
              <span>${S.escape(row.branch_name || "Company-wide")}</span>
              <span>${S.formatDateTime(row.created_at)}</span>
              ${details}
            </div>
          </div>
        </div>`;
      }).join("") : '<div class="empty-state">No activity matches the current filter.</div>';
    } catch (error) { S.toast(error.message, true); }
  }

  document.addEventListener("DOMContentLoaded", async () => {
    me = await S.initShell("activity");
    if (!me) return;
    const scopeLabel = ["Managing Director", "Finance Officer"].includes(me.role)
      ? "Company-wide"
      : (me.branch_name || "Branch");
    el("heroMeta").innerHTML = [
      `<span class="scope-badge">${S.escape(me.role)}</span>`,
      `<span class="scope-badge">${S.escape(scopeLabel)}</span>`,
      `<span class="scope-badge">In-app only</span>`
    ].join("");
    if (me.role === "Finance Officer") {
      [...el("activityType").options].forEach(option => {
        if (["client", "property", "lead", "staff", "team"].includes(option.value)) option.remove();
      });
    }
    el("activityFrom").value = S.daysAgo(30);
    el("activityTo").value = S.today();
    el("applyActivityFilters").addEventListener("click", () => { page = 1; load(); });
    el("resetActivityFilters").addEventListener("click", () => {
      el("activityType").value = "";
      el("activityFrom").value = S.daysAgo(30);
      el("activityTo").value = S.today();
      page = 1;
      load();
    });
    el("activityPrev").addEventListener("click", () => { if (page > 1) { page--; load(); } });
    el("activityNext").addEventListener("click", () => { if (page * 20 < total) { page++; load(); } });
    await load();
  });
})();
