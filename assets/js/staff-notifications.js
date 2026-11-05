(function () {
  const S = window.BlissStaff;
  let notifications = [];
  const el = id => document.getElementById(id);

  function render() {
    const unread = notifications.filter(n => !n.is_read).length;
    el("unreadLabel").textContent = `${unread} unread`;
    el("staffNotificationList").innerHTML = notifications.length ? notifications.map(item => `
      <div class="notif-item ${item.is_read ? "" : "unread"}" style="padding:14px 12px;border-bottom:1px solid var(--line)">
        <div style="display:flex;justify-content:space-between;gap:12px">
          <div style="min-width:0">
            <strong style="display:block;font-size:13px;color:var(--ink)">${S.escape(item.title)}</strong>
            <p style="margin:4px 0 0;font-size:12px;line-height:1.55;color:var(--muted)">${S.escape(item.message)}</p>
            <span style="font-size:11px;color:var(--muted)">${S.formatDateTime(item.created_at)}</span>
          </div>
          ${item.is_read ? "" : `<button class="btn btn-outline btn-sm" type="button" data-read="${item.id}">Mark read</button>`}
        </div>
      </div>
    `).join("") : '<div class="empty-state">No staff notifications yet.</div>';
    el("staffNotificationList").querySelectorAll("[data-read]").forEach(button => {
      button.addEventListener("click", async () => {
        try {
          await S.fetchJson(`/api/staff/notifications/${button.getAttribute("data-read")}/read`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
          await load();
        } catch (error) { S.toast(error.message, true); }
      });
    });
  }

  async function load() {
    const data = await S.fetchJson("/api/staff/notifications?limit=100");
    notifications = data.notifications || [];
    render();
  }

  document.addEventListener("DOMContentLoaded", async () => {
    const me = await S.initShell("notifications");
    if (!me) return;
    try { await load(); } catch (error) { S.toast(error.message || "Unable to load notifications", true); }
    el("markAllReadBtn").addEventListener("click", async () => {
      try {
        await S.fetchJson("/api/staff/notifications/read-all", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
        await load();
      } catch (error) { S.toast(error.message, true); }
    });
  });
})();
