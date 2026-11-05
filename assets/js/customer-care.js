(function () {
  const S = window.BlissStaff;
  let me = null;
  let page = 1;
  let total = 0;
  const limit = 20;
  let current = null;
  const el = id => document.getElementById(id);

  function params() {
    const p = new URLSearchParams();
    p.set("page", String(page));
    p.set("limit", String(limit));
    if (el("careSearch").value.trim()) p.set("q", el("careSearch").value.trim());
    if (el("careStatus").value) p.set("status", el("careStatus").value);
    if (el("careBranch").value) p.set("branch_id", el("careBranch").value);
    if (el("careFrom").value) p.set("from", el("careFrom").value);
    if (el("careTo").value) p.set("to", el("careTo").value);
    return p;
  }

  async function loadOverview() {
    const data = await S.fetchJson("/api/customer-care/overview");
    el("careMeta").innerHTML = [
      `<span class="scope-badge">${S.escape(me.role)}</span>`,
      `<span class="scope-badge">${data.scope === "national" ? "National" : (me.branch_name || "Branch")}</span>`
    ].join("");
    el("careKpis").innerHTML = [
      ["Pending clearance", data.pending_clearance],
      ["Cleared", data.cleared],
      ["Calls today", data.calls_today],
      ["Total clients", data.total_clients]
    ].map(([label, value]) => `<div class="kpi"><div class="kpi-label">${S.escape(label)}</div><div class="kpi-value">${value}</div></div>`).join("");
  }

  async function loadBranches() {
    if (String(me.care_scope || "").toLowerCase() !== "national") {
      el("careBranch").style.display = "none";
      return;
    }
    const data = await S.fetchJson("/api/branches");
    el("careBranch").innerHTML = '<option value="">All branches</option>' + (data.branches || []).map(b => `<option value="${b.id}">${S.escape(b.name)}</option>`).join("");
  }

  async function loadClients() {
    el("careBody").innerHTML = '<tr><td colspan="7">Loading care queue…</td></tr>';
    try {
      const data = await S.fetchJson("/api/customer-care/clients?" + params().toString());
      const clients = data.clients || [];
      total = data.pagination ? data.pagination.total : clients.length;
      el("careCount").textContent = `${total} client${total === 1 ? "" : "s"}`;
      const pages = Math.max(1, Math.ceil(total / limit));
      el("carePageLabel").textContent = `Page ${page} of ${pages}`;
      el("carePrev").disabled = page <= 1;
      el("careNext").disabled = page >= pages;
      el("careBody").innerHTML = clients.length ? clients.map(row => `
        <tr>
          <td><strong>${S.escape(row.full_name)}</strong><div class="small muted">${S.escape(row.client_reference)} · ${S.escape(row.phone_number)}</div></td>
          <td>${S.escape(row.branch_name || "-")}</td>
          <td>${row.care_status === "cleared" ? S.badge("Cleared", "green") : S.badge("Pending clearance", "amber")}</td>
          <td>${row.last_call_at ? S.formatDateTime(row.last_call_at) : "-"}</td>
          <td>${row.next_follow_up_date ? S.formatDate(row.next_follow_up_date) : "-"}</td>
          <td>${row.call_count || 0}</td>
          <td class="toolbar">
            <button class="btn btn-ghost btn-xs" type="button" data-care-open="${row.id}">Open</button>
            <a class="btn btn-ghost btn-xs" href="client-detail.html?id=${row.id}">Client</a>
          </td>
        </tr>`).join("") : '<tr><td colspan="7"><div class="empty-state">No clients in this care scope.</div></td></tr>';
      el("careBody").querySelectorAll("[data-care-open]").forEach(btn => {
        btn.addEventListener("click", () => openClient(Number(btn.getAttribute("data-care-open"))));
      });
    } catch (error) {
      S.toast(error.message || "Unable to load care queue", true);
      el("careBody").innerHTML = '<tr><td colspan="7"><div class="empty-state">Unable to load care queue.</div></td></tr>';
    }
  }

  async function openClient(clientId) {
    try {
      const data = await S.fetchJson(`/api/customer-care/clients/${clientId}`);
      current = data.client;
      renderClient(data);
      S.openModal("careDetailModal");
    } catch (error) { S.toast(error.message || "Unable to open client", true); }
  }

  function renderClient(data) {
    const client = data.client;
    const calls = data.calls || [];
    el("careDetailTitle").textContent = `${client.full_name} — ${client.client_reference}`;
    el("careDetailBody").innerHTML = `
      <div class="split-grid wide-left">
        <div>
          <div class="card" style="box-shadow:none">
            <div class="card-head"><h3>${S.escape(client.full_name)}</h3>${client.care_status === "cleared" ? S.badge("Cleared", "green") : S.badge("Pending clearance", "amber")}</div>
            <table class="table">
              <tr><td class="muted">Phone</td><td>${S.escape(client.phone_number)}</td></tr>
              <tr><td class="muted">Email</td><td>${S.escape(client.email_address || "-")}</td></tr>
              <tr><td class="muted">Branch</td><td>${S.escape(client.branch_name || "-")}</td></tr>
              <tr><td class="muted">Client status</td><td>${S.escape(client.status)}</td></tr>
              <tr><td class="muted">Contract value</td><td>${client.agreed_purchase_price ? S.money(Number(client.agreed_purchase_price) * 100) : "-"}</td></tr>
              <tr><td class="muted">Last call</td><td>${client.last_call_at ? S.formatDateTime(client.last_call_at) : "-"}</td></tr>
              <tr><td class="muted">Next follow-up</td><td>${client.next_follow_up_date ? S.formatDate(client.next_follow_up_date) : "-"}</td></tr>
            </table>
            <h3 class="mt-16">Clearance</h3>
            <form id="careClearanceForm" class="form-grid">
              <div class="field-group"><label class="field-label">Care status</label><select class="field-input" id="careClearanceStatus"><option value="cleared" ${client.care_status === "cleared" ? "selected" : ""}>Cleared</option><option value="pending_clearance" ${client.care_status !== "cleared" ? "selected" : ""}>Pending clearance</option></select></div>
              <div class="field-group full"><label class="field-label">Clearance note</label><textarea class="field-input" id="careClearanceNote" rows="2">${S.escape(client.clearance_note || "")}</textarea></div>
              <div class="field-group full"><button class="btn btn-green btn-sm" type="submit">Save clearance</button></div>
            </form>
          </div>
        </div>
        <div>
          <div class="card" style="box-shadow:none">
            <h3>Log a call</h3>
            <form id="careCallForm" class="form-grid">
              <div class="field-group"><label class="field-label">Type</label><select class="field-input" id="careCallType"><option value="call">Call</option><option value="whatsapp">WhatsApp</option><option value="visit">Visit</option><option value="sms">SMS</option><option value="other">Other</option></select></div>
              <div class="field-group"><label class="field-label">Next follow-up</label><input class="field-input" type="date" id="careCallDate"></div>
              <div class="field-group full"><label class="field-label">What was discussed</label><textarea class="field-input" id="careCallNote" rows="3" required></textarea></div>
              <div class="field-group full"><label class="field-label">Outcome</label><input class="field-input" id="careCallOutcome" placeholder="e.g. Client confirmed details"></div>
              <div class="field-group full"><button class="btn btn-green btn-sm" type="submit">Save call note</button></div>
            </form>
          </div>
        </div>
      </div>
      <div class="card section-gap" style="box-shadow:none">
        <div class="card-head"><h3>Call history</h3><span class="small muted">${calls.length} call(s), newest first</span></div>
        <div class="activity-feed" id="careCallList">${calls.length ? calls.map(call => `
          <div class="activity-item">
            <div class="activity-dot">☎</div>
            <div class="activity-main">
              <strong>${S.escape(call.care_user_name || "Customer care")} · ${S.escape(call.call_type)}</strong>
              <p>${S.escape(call.note)}</p>
              <div class="activity-meta"><span>${S.formatDateTime(call.created_at)}</span>${call.outcome ? `<span>${S.escape(call.outcome)}</span>` : ""}${call.next_follow_up_date ? `<span>Next: ${S.formatDate(call.next_follow_up_date)}</span>` : ""}</div>
            </div>
          </div>`).join("") : '<div class="empty-state">No calls logged.</div>'}</div>
      </div>`;
    el("careClearanceForm").addEventListener("submit", async event => {
      event.preventDefault();
      try {
        await S.fetchJson(`/api/customer-care/clients/${client.id}/clearance`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: el("careClearanceStatus").value, note: el("careClearanceNote").value.trim() })
        });
        S.toast("Clearance updated");
        await openClient(client.id);
        await Promise.all([loadOverview(), loadClients()]);
      } catch (error) { S.toast(error.message, true); }
    });
    el("careCallForm").addEventListener("submit", async event => {
      event.preventDefault();
      try {
        await S.fetchJson(`/api/customer-care/clients/${client.id}/calls`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            call_type: el("careCallType").value,
            note: el("careCallNote").value.trim(),
            outcome: el("careCallOutcome").value.trim(),
            next_follow_up_date: el("careCallDate").value || null
          })
        });
        S.toast("Call note saved");
        await openClient(client.id);
        await Promise.all([loadOverview(), loadClients()]);
      } catch (error) { S.toast(error.message, true); }
    });
  }

  function renderReferral() {
    const card = el("referralCard");
    const input = el("referralLinkInput");
    if (!card || !input) return;
    if (!me.referral_link) { card.style.display = "none"; return; }
    card.style.display = "";
    input.value = me.referral_link;
    el("referralCodeText").textContent = `Referral code: ${me.referral_code || "-"}`;
    el("copyReferralBtn").addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(me.referral_link); }
      catch { input.select(); document.execCommand("copy"); }
      S.toast("Referral link copied.");
    });
    el("copyReferralCodeBtn").addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(me.referral_code || ""); }
      catch { /* clipboard may be unavailable */ }
      S.toast("Referral code copied.");
    });
    el("shareReferralBtn").href = "https://wa.me/?text=" + encodeURIComponent(`Buy property with Bliss Legacy through my referral link: ${me.referral_link}`);
  }

  document.addEventListener("DOMContentLoaded", async () => {
    me = await S.initShell("care");
    if (!me) return;
    if (me.role !== "Customer Care") {
      S.toast("Customer care access is required.", true);
      window.location.href = "dashboard.html";
      return;
    }
    renderReferral();
    await loadBranches();
    el("applyCareFilters").addEventListener("click", () => { page = 1; loadClients(); });
    el("resetCareFilters").addEventListener("click", () => {
      el("careSearch").value = "";
      el("careStatus").value = "";
      el("careFrom").value = "";
      el("careTo").value = "";
      if (el("careBranch").style.display !== "none") el("careBranch").value = "";
      page = 1; loadClients();
    });
    el("carePrev").addEventListener("click", () => { if (page > 1) { page--; loadClients(); } });
    el("careNext").addEventListener("click", () => { page++; loadClients(); });
    await loadOverview();
    await loadClients();
  });
})();
