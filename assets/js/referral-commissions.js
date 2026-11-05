(function () {
  const S = window.BlissStaff;
  let me = null;
  let page = 1;
  let total = 0;
  let entries = [];
  let currentAccountId = null;

  const el = id => document.getElementById(id);
  const money = kobo => S.money(kobo);
  const canManage = () => me && ["Managing Director", "Super Admin", "Head Accountant", "Finance Officer"].includes(me.actual_role || me.role);
  const canFilterPeople = () => me && ["Managing Director", "Super Admin", "Head Accountant", "Finance Officer", "Branch Manager", "Project Manager"].includes(me.actual_role || me.role);

  function statusTone(status) {
    if (status === "Paid") return "green";
    if (status === "Partially Paid") return "amber";
    if (status === "Earned") return "blue";
    if (status === "Reversed") return "red";
    if (status === "Configuration Required") return "amber";
    return "gray";
  }

  function structureLabel(row) {
    if (row.structure_label) return row.structure_label;
    if (row.structure === "two_stage") return "Long-term (two stage)";
    if (row.structure === "flat") return row.plan_type === "outright" ? "Outright (10%)" : (row.plan_type ? "Short-term (10%)" : "Short-term / outright (10%)");
    if (row.structure === "configuration_required") return "Configuration required";
    return row.structure || "-";
  }

  function planLabel(row) {
    const type = String(row.plan_type || "").replace(/_/g, " ");
    const months = row.plan_duration_months;
    if (!type) return "Not configured";
    if (type === "outright") return "Outright";
    return `${type.charAt(0).toUpperCase() + type.slice(1)}${months !== null && months !== undefined ? ` · ${months} month(s)` : ""}`;
  }

  function renderKpis(summary) {
    const items = [
      ["Client accounts", String(summary.total_clients || 0), "Across your authorised scope"],
      ["Commission earned", money(summary.earned_kobo || 0), "Accrued from verified payments"],
      ["Commission paid", money(summary.paid_kobo || 0), "Disbursed and recorded"],
      ["Commission outstanding", money(summary.outstanding_kobo || 0), "Earned but not yet paid"],
      ["Needs configuration", String(summary.configuration_required || 0), "8-month or missing plan details"]
    ];
    el("referralKpis").innerHTML = items.map(([label, value, meta]) => `
      <div class="kpi"><div class="label">${S.escape(label)}</div><div class="value">${value}</div><div class="delta">${S.escape(meta)}</div></div>
    `).join("");
    const byStructure = summary.by_structure || [];
    el("refStructureBody").innerHTML = byStructure.length ? byStructure.map(row => `
      <tr>
        <td><strong>${S.escape(structureLabel(row))}</strong></td>
        <td>${Number(row.client_count || 0)}</td>
        <td>${money(row.earned_kobo || 0)}</td>
        <td>${money(row.outstanding_kobo || 0)}</td>
      </tr>`).join("") : '<tr><td colspan="4"><div class="empty-state">No referral commission accounts yet.</div></td></tr>';
  }

  function renderRows() {
    el("refCount").textContent = `${total} client account${total === 1 ? "" : "s"}`;
    const pages = Math.max(1, Math.ceil(total / 50));
    el("refPageLabel").textContent = `Page ${page} of ${pages}`;
    el("refPrev").disabled = page <= 1;
    el("refNext").disabled = page >= pages;
    el("refBody").innerHTML = entries.length ? entries.map(row => `
      <tr>
        <td>
          <strong>${S.escape(row.client_name || "-")}</strong>
          <div class="small muted">${S.escape(row.client_reference || "")}${row.branch_name ? " · " + S.escape(row.branch_name) : ""}</div>
        </td>
        <td>${S.escape(row.marketer_name || "Unassigned")}</td>
        <td>${S.escape(planLabel(row))}<div class="small muted">${S.escape(structureLabel(row))}</div></td>
        <td>${money(row.total_paid_kobo || 0)}</td>
        <td><strong>${money(row.net_commission_kobo || 0)}</strong></td>
        <td>${money(row.paid_kobo || 0)}</td>
        <td>${money(row.outstanding_kobo || 0)}</td>
        <td>${S.badge(row.status || "Pending", statusTone(row.status))}${row.flag_reason ? `<div class="small muted">${S.escape(row.flag_reason)}</div>` : ""}</td>
        <td><button class="btn btn-ghost btn-xs" type="button" data-open-ref="${row.id}">Open</button></td>
      </tr>`).join("") : '<tr><td colspan="9"><div class="empty-state">No referral commission accounts match the filters.</div></td></tr>';
    el("refBody").querySelectorAll("[data-open-ref]").forEach(button => {
      button.addEventListener("click", () => openDetail(Number(button.getAttribute("data-open-ref"))));
    });
  }

  function queryParams() {
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("limit", "50");
    if (el("refSearch").value.trim()) params.set("q", el("refSearch").value.trim());
    if (el("refStatus").value) params.set("status", el("refStatus").value);
    if (!el("refMarketerGroup").hidden && el("refMarketer").value) params.set("marketer_id", el("refMarketer").value);
    if (!el("refBranchGroup").hidden && el("refBranch").value) params.set("branch_id", el("refBranch").value);
    return params;
  }

  async function load() {
    try {
      const data = await S.fetchJson("/api/referral-commissions?" + queryParams().toString());
      entries = data.entries || [];
      total = data.pagination ? data.pagination.total : entries.length;
      renderKpis(data.summary || {});
      renderRows();
    } catch (error) {
      el("refBody").innerHTML = `<tr><td colspan="9"><div class="empty-state">${S.escape(error.message)}</div></td></tr>`;
    }
  }

  async function loadOptions() {
    if (!canFilterPeople()) {
      el("refMarketerGroup").hidden = true;
      el("refBranchGroup").hidden = true;
      return;
    }
    try {
      const branches = await S.fetchJson("/api/branches");
      el("refBranch").innerHTML = '<option value="">All branches</option>' + (branches.branches || []).map(b => `<option value="${b.id}">${S.escape(b.name)}</option>`).join("");
    } catch { /* optional */ }
    try {
      const staff = await S.fetchJson("/api/users?role=Marketer");
      el("refMarketer").innerHTML = '<option value="">All marketers</option>' + (staff.users || []).map(u => `<option value="${u.id}">${S.escape(u.full_name)}</option>`).join("");
    } catch { /* optional */ }
    if ((me.actual_role || me.role) === "Branch Manager") el("refBranchGroup").hidden = true;
  }

  async function openDetail(id) {
    currentAccountId = id;
    el("refDetailBody").innerHTML = '<div class="empty-state">Loading…</div>';
    S.openModal("refDetailModal");
    try {
      const data = await S.fetchJson("/api/referral-commissions/" + id);
      renderDetail(data);
    } catch (error) {
      el("refDetailBody").innerHTML = `<div class="empty-state">${S.escape(error.message)}</div>`;
    }
  }

  function renderDetail(data) {
    const a = data.account || {};
    el("refDetailTitle").textContent = `${a.client_name || "Client"} · ${a.client_reference || ""}`;
    const events = data.events || [];
    const payments = data.payments || [];
    const adjustments = data.adjustments || [];
    const manage = data.can_manage;
    const earned = Number(a.net_commission_kobo || 0);
    const paid = Number(a.paid_kobo || 0);
    const outstanding = Number(a.outstanding_kobo || 0);

    el("refDetailBody").innerHTML = `
      <div class="kpi-grid kpi-grid-5">
        <div class="kpi"><div class="label">Total client paid</div><div class="value">${money(a.total_paid_kobo || 0)}</div><div class="delta">Verified payments</div></div>
        <div class="kpi"><div class="label">Commission earned</div><div class="value">${money(earned)}</div><div class="delta">${S.escape(structureLabel(a))}</div></div>
        <div class="kpi"><div class="label">Commission paid</div><div class="value">${money(paid)}</div><div class="delta">Recorded disbursements</div></div>
        <div class="kpi"><div class="label">Outstanding</div><div class="value">${money(outstanding)}</div><div class="delta">Earned but unpaid</div></div>
        <div class="kpi"><div class="label">Status</div><div class="value" style="font-size:20px">${S.badge(a.status || "Pending", statusTone(a.status))}</div><div class="delta">${S.escape(planLabel(a))}</div></div>
      </div>

      ${a.flag_reason ? `<div class="route-note" style="margin:14px 0;border-left-color:#D97706"><strong>Action required:</strong> ${S.escape(a.flag_reason)}</div>` : ""}

      <div class="card" style="margin-top:16px">
        <div class="card-head"><h3>Calculation breakdown</h3><span class="small muted">Payment-stage, not calendar-month</span></div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;font-size:13px">
          <div><span class="muted">Marketer</span><br><strong>${S.escape(a.marketer_name || "Unassigned")}</strong></div>
          <div><span class="muted">Branch</span><br><strong>${S.escape(a.branch_name || "-")}</strong></div>
          <div><span class="muted">Plan</span><br><strong>${S.escape(planLabel(a))}</strong></div>
          <div><span class="muted">Structure</span><br><strong>${S.escape(structureLabel(a))}</strong></div>
          <div><span class="muted">Qualifying payments</span><br><strong>${money(a.qualifying_paid_kobo || 0)}</strong></div>
          <div><span class="muted">Stage 1 paid</span><br><strong>${money(a.stage1_paid_kobo || 0)} → ${money(a.stage1_commission_kobo || 0)}</strong></div>
          <div><span class="muted">Stage 2 paid</span><br><strong>${money(a.stage2_paid_kobo || 0)} → ${money(a.stage2_commission_kobo || 0)}</strong></div>
          <div><span class="muted">Manual adjustments</span><br><strong>${money(a.adjusted_kobo || 0)}</strong></div>
          <div><span class="muted">Last recalculated</span><br><strong>${a.last_calculated_at ? S.formatDateTime(a.last_calculated_at) : "-"}</strong></div>
        </div>
      </div>

      ${manage ? `
      <div class="card" style="margin-top:16px">
        <div class="card-head"><h3>Manage disbursement</h3><span class="small muted">Management only</span></div>
        <div class="form-grid">
          <div class="field-group">
            <label class="field-label" for="refPayAmount">Payment amount (₦)</label>
            <input class="field-input" id="refPayAmount" type="number" min="0.01" step="0.01" placeholder="Amount to pay">
          </div>
          <div class="field-group">
            <label class="field-label" for="refPayMethod">Method</label>
            <select class="field-input" id="refPayMethod"><option>Bank Transfer</option><option>Cash</option><option>Cheque</option><option>Other</option></select>
          </div>
          <div class="field-group">
            <label class="field-label" for="refPayReference">External reference</label>
            <input class="field-input" id="refPayReference" type="text" placeholder="Optional bank reference">
          </div>
          <div class="field-group">
            <label class="field-label" for="refPayNotes">Notes</label>
            <input class="field-input" id="refPayNotes" type="text" placeholder="Optional notes">
          </div>
        </div>
        <div class="toolbar" style="margin-top:10px">
          <button class="btn btn-green" type="button" id="refPayBtn">Record payment</button>
          <button class="btn btn-outline" type="button" id="refRecalcBtn">Recalculate account</button>
        </div>

        <div class="card-head" style="margin-top:22px"><h3>Manual adjustment</h3><span class="small muted">Use a negative amount to reduce commission</span></div>
        <div class="form-grid">
          <div class="field-group">
            <label class="field-label" for="refAdjAmount">Adjustment amount (₦)</label>
            <input class="field-input" id="refAdjAmount" type="number" step="0.01" placeholder="e.g. -5000">
          </div>
          <div class="field-group">
            <label class="field-label" for="refAdjType">Adjustment type</label>
            <select class="field-input" id="refAdjType"><option value="correction">Correction</option><option value="reversal">Reversal</option><option value="refund">Refund</option><option value="manual">Manual</option></select>
          </div>
          <div class="field-group" style="grid-column:1/-1">
            <label class="field-label" for="refAdjReason">Reason</label>
            <input class="field-input" id="refAdjReason" type="text" placeholder="Required reason for the adjustment">
          </div>
        </div>
        <div class="toolbar" style="margin-top:10px"><button class="btn btn-outline" type="button" id="refAdjBtn">Apply adjustment</button></div>
        <div id="refActionMsg" class="small" style="margin-top:10px"></div>
      </div>` : ""}

      <div class="card" style="margin-top:16px">
        <div class="card-head"><h3>Ledger events</h3><span class="small muted">Every calculation and change</span></div>
        <div class="table-responsive">
          <table class="table">
            <thead><tr><th>Time</th><th>Event</th><th>Amount</th><th>Total paid</th><th>Net commission</th><th>Reason / actor</th></tr></thead>
            <tbody>${events.length ? events.map(e => `
              <tr>
                <td class="nowrap">${S.formatDateTime(e.created_at)}</td>
                <td>${S.badge(String(e.event_type || "").replace(/_/g, " "), e.event_type === "flagged" ? "amber" : e.event_type === "disbursement" ? "green" : e.event_type === "reversal" ? "red" : "blue")}</td>
                <td>${money(e.amount_kobo || 0)}</td>
                <td>${money(e.total_paid_kobo || 0)}</td>
                <td>${money(e.net_commission_kobo || 0)}</td>
                <td>${S.escape(e.reason || "-")}<div class="small muted">${S.escape(e.actor_name || "System")}</div></td>
              </tr>`).join("") : '<tr><td colspan="6"><div class="empty-state">No ledger events yet.</div></td></tr>'}</tbody>
          </table>
        </div>
      </div>

      <div class="split-grid" style="margin-top:16px">
        <div class="card">
          <div class="card-head"><h3>Disbursements</h3><span class="small muted">${payments.length} record(s)</span></div>
          <div class="table-responsive"><table class="table">
            <thead><tr><th>Reference</th><th>Amount</th><th>Method</th><th>Paid at</th></tr></thead>
            <tbody>${payments.length ? payments.map(p => `
              <tr><td>${S.escape(p.payment_ref)}</td><td>${money(p.amount_kobo)}</td><td>${S.escape(p.method)}</td><td>${S.formatDateTime(p.paid_at)}</td></tr>`).join("") : '<tr><td colspan="4"><div class="empty-state">No payments recorded.</div></td></tr>'}</tbody>
          </table></div>
        </div>
        <div class="card">
          <div class="card-head"><h3>Manual adjustments</h3><span class="small muted">${adjustments.length} record(s)</span></div>
          <div class="table-responsive"><table class="table">
            <thead><tr><th>Type</th><th>Amount</th><th>Reason</th><th>When</th></tr></thead>
            <tbody>${adjustments.length ? adjustments.map(p => `
              <tr><td>${S.escape(p.adjustment_type)}</td><td>${money(p.amount_kobo)}</td><td>${S.escape(p.reason)}</td><td>${S.formatDateTime(p.created_at)}</td></tr>`).join("") : '<tr><td colspan="4"><div class="empty-state">No adjustments recorded.</div></td></tr>'}</tbody>
          </table></div>
        </div>
      </div>
    `;

    if (manage) {
      el("refPayBtn").addEventListener("click", async () => {
        const msg = el("refActionMsg");
        msg.textContent = "";
        const amount = Number(el("refPayAmount").value);
        if (!Number.isFinite(amount) || amount <= 0) { msg.textContent = "Enter a valid payment amount."; return; }
        try {
          await S.fetchJson(`/api/referral-commissions/${id}/payments`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              amount, method: el("refPayMethod").value,
              external_reference: el("refPayReference").value.trim(),
              notes: el("refPayNotes").value.trim()
            })
          });
          S.toast("Referral commission payment recorded.");
          await openDetail(id);
          await load();
        } catch (error) { msg.textContent = error.message; }
      });
      el("refAdjBtn").addEventListener("click", async () => {
        const msg = el("refActionMsg");
        msg.textContent = "";
        const amount = Number(el("refAdjAmount").value);
        const reason = el("refAdjReason").value.trim();
        if (!Number.isFinite(amount) || amount === 0) { msg.textContent = "Enter a non-zero adjustment amount."; return; }
        if (!reason) { msg.textContent = "Enter a reason for the adjustment."; return; }
        try {
          await S.fetchJson(`/api/referral-commissions/${id}/adjustments`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ amount, adjustment_type: el("refAdjType").value, reason })
          });
          S.toast("Referral commission adjustment recorded.");
          await openDetail(id);
          await load();
        } catch (error) { msg.textContent = error.message; }
      });
      el("refRecalcBtn").addEventListener("click", async () => {
        const msg = el("refActionMsg");
        msg.textContent = "";
        try {
          const result = await S.fetchJson(`/api/referral-commissions/${id}/recalculate`, {
            method: "POST", headers: { "Content-Type": "application/json" }, body: "{}"
          });
          S.toast(`Recalculated. Commission is ${money(result.net_commission_kobo || 0)}.`);
          await openDetail(id);
          await load();
        } catch (error) { msg.textContent = error.message; }
      });
    }
  }

  document.addEventListener("DOMContentLoaded", async () => {
    me = await S.initShell("referral-commissions");
    if (!me) return;
    await loadOptions();
    if (!canManage()) el("backfillBtn").style.display = "none";

    el("refApply").addEventListener("click", () => { page = 1; load(); });
    el("refReset").addEventListener("click", () => {
      el("refSearch").value = "";
      el("refStatus").value = "";
      if (el("refMarketer")) el("refMarketer").value = "";
      if (el("refBranch")) el("refBranch").value = "";
      page = 1;
      load();
    });
    el("refPrev").addEventListener("click", () => { if (page > 1) { page--; load(); } });
    el("refNext").addEventListener("click", () => { page++; load(); });
    el("backfillBtn").addEventListener("click", async () => {
      const button = el("backfillBtn");
      button.disabled = true;
      button.textContent = "Recalculating…";
      try {
        const result = await S.fetchJson("/api/referral-commissions/backfill", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: "{}"
        });
        S.toast(`Recalculated ${result.processed || 0} client account(s).`);
        await load();
      } catch (error) {
        S.toast(error.message, true);
      } finally {
        button.disabled = false;
        button.textContent = "Recalculate all eligible clients";
      }
    });
    await load();
  });
})();
