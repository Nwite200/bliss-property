(function () {
  const S = window.BlissStaff;
  let me = null;
  let rows = [];
  const el = id => document.getElementById(id);

  function reasonLabel(reason) {
    return ({ missing_phone: "Missing", invalid_number: "Invalid", normalise_to_+234: "Not +234" })[reason] || reason;
  }

  async function load() {
    const data = await S.fetchJson("/api/phone-cleanup");
    rows = data.clients || [];
    el("phoneMeta").innerHTML = `<span class="scope-badge">${S.escape(me.role)}</span><span class="scope-badge">${S.escape(me.branch_name || "Assigned scope")}</span>`;
    const counts = {};
    rows.forEach(row => { counts[row.reason] = (counts[row.reason] || 0) + 1; });
    el("phoneKpis").innerHTML = [
      ["Clients needing cleanup", rows.length],
      ["Missing", counts.missing_phone || 0],
      ["Invalid", counts.invalid_number || 0],
      ["Not +234", counts["normalise_to_+234"] || 0],
      ["Branches affected", new Set(rows.map(r => r.branch_name)).size]
    ].map(([label, value]) => `<div class="kpi"><div class="kpi-label">${S.escape(label)}</div><div class="kpi-value">${value}</div></div>`).join("");
    el("phoneCount").textContent = `${rows.length} client(s)`;
    el("phoneBody").innerHTML = rows.length ? rows.map((row, index) => `
      <tr>
        <td><strong>${S.escape(row.client_name)}</strong><div class="small muted">${S.escape(row.client_reference)}</div></td>
        <td>${S.escape(row.branch_name)}</td>
        <td>${S.escape(row.marketer_name)}</td>
        <td class="nowrap">${S.escape(row.stored_value || "—")}</td>
        <td class="nowrap">${S.escape(row.proposed_value || "—")}</td>
        <td>${S.badge(reasonLabel(row.reason), row.reason === "invalid_number" || row.reason === "missing_phone" ? "red" : "amber")}</td>
        <td><div class="toolbar"><input class="field-input" style="min-width:160px" id="phoneFix${index}" value="${S.escape(row.proposed_value || "")}" placeholder="+234..."><button class="btn btn-green btn-xs" type="button" data-fix="${index}">Save</button></div></td>
      </tr>`).join("") : '<tr><td colspan="7"><div class="empty-state">No phone numbers need cleanup.</div></td></tr>';
    el("phoneBody").querySelectorAll("[data-fix]").forEach(button => {
      button.addEventListener("click", async () => {
        const index = Number(button.getAttribute("data-fix"));
        const row = rows[index];
        const value = el("phoneFix" + index).value.trim();
        try {
          await S.fetchJson(`/api/clients/${row.client_id}`, {
            method: "PUT", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ phone_number: value })
          });
          S.toast("Phone number updated");
          await load();
        } catch (error) { S.toast(error.message || "Unable to update phone number", true); }
      });
    });
  }

  document.addEventListener("DOMContentLoaded", async () => {
    me = await S.initShell("phone-cleanup");
    if (!me) return;
    if (!["Managing Director", "Branch Manager", "Team Lead", "Marketer"].includes(me.role)) {
      window.location.href = "dashboard.html";
      return;
    }
    try { await load(); } catch (error) { S.toast(error.message || "Unable to load report", true); }
  });
})();
