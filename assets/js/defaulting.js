(function () {
  const S = window.BlissStaff;
  let me = null;
  let page = 1;
  let total = 0;
  const limit = 50;
  let rows = [];
  const el = id => document.getElementById(id);

  function planLabel(type) {
    return ({ outright: "Outright", part_payment: "Part payment", daily: "Daily (easy buy)", weekly: "Weekly (easy buy)", bi_monthly: "Bi-monthly (easy buy)", monthly: "Monthly (easy buy)" })[type] || type;
  }

  function queryParams() {
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("limit", String(limit));
    if (el("defaultingSearch").value.trim()) params.set("q", el("defaultingSearch").value.trim());
    if (el("defaultingStatus").value) params.set("status", el("defaultingStatus").value);
    if (el("defaultingPlan").value) params.set("plan_type", el("defaultingPlan").value);
    if (el("defaultingBranch").value) params.set("branch_id", el("defaultingBranch").value);
    if (el("defaultingTeamLead").value) params.set("team_lead_id", el("defaultingTeamLead").value);
    if (el("defaultingStaff").value) params.set("staff_id", el("defaultingStaff").value);
    return params;
  }

  async function loadOptions() {
    try {
      const branchData = await S.fetchJson("/api/branches");
      const branches = branchData.branches || [];
      el("defaultingBranch").innerHTML = '<option value="">All branches</option>' + branches.map(branch => `<option value="${branch.id}">${S.escape(branch.name)}</option>`).join("");
      const canSeeAllBranches = ["Managing Director", "Finance Officer", "Head Accountant", "Super Admin"].includes(me.actual_role || me.role);
      if (!canSeeAllBranches) {
        el("defaultingBranch").value = me.branch_id || "";
        el("defaultingBranch").disabled = true;
      }
    } catch { /* optional */ }
    try {
      let staff = [];
      if (["Managing Director", "Branch Manager"].includes(me.role)) {
        const data = await S.fetchJson("/api/staff?limit=100");
        staff = (data.staff || []).filter(row => row.is_active);
      } else if (me.role === "Team Lead") {
        const data = await S.fetchJson("/api/dashboard");
        staff = (data.team_members || []).filter(row => row.is_active);
      }
      el("defaultingStaff").innerHTML = '<option value="">All staff</option>' + staff.map(row => `<option value="${row.id}">${S.escape(row.full_name)}</option>`).join("");
      el("followUpOwner").innerHTML = staff.map(row => `<option value="${row.id}">${S.escape(row.full_name)} · ${S.escape(row.role_name || "")}</option>`).join("");
      const teamLeads = staff.filter(row => row.role_name === "Team Lead");
      el("defaultingTeamLead").innerHTML = '<option value="">All team leads</option>' + teamLeads.map(row => `<option value="${row.id}">${S.escape(row.full_name)}</option>`).join("");
      if (!staff.length && me.role !== "Marketer") {
        el("defaultingStaff").innerHTML = `<option value="${me.id}">${S.escape(me.full_name)}</option>`;
        el("followUpOwner").innerHTML = `<option value="${me.id}">${S.escape(me.full_name)}</option>`;
      }
    } catch { /* optional */ }
    if (!el("followUpOwner").options.length) {
      el("followUpOwner").innerHTML = `<option value="${me.id}">${S.escape(me.full_name)}</option>`;
    }
  }

  async function load() {
    el("defaultingBody").innerHTML = '<tr><td colspan="10">Loading…</td></tr>';
    try {
      const data = await S.fetchJson("/api/defaulting-clients?" + queryParams().toString());
      rows = data.clients || [];
      total = data.pagination ? data.pagination.total : rows.length;
      const summary = data.summary || {};
      el("defaultingMeta").innerHTML = `<span class="scope-badge">${S.escape(me.actual_role || me.role)}</span><span class="scope-badge">${S.escape(me.branch_name || "Scope")}</span>`;
      el("defaultingCount").textContent = `${total} plan${total === 1 ? "" : "s"} in scope`;
      el("defaultingKpis").innerHTML = [
        ["Clients on plan", summary.total || 0],
        ["Defaulting", summary.defaulting || 0],
        ["Performing", summary.performing || 0],
        ["Amount behind", S.money(summary.amount_behind_kobo || 0)],
        ["Defaulting easy-buy", ["daily", "weekly", "bi_monthly", "monthly"].reduce((sum, type) => sum + Number(summary.by_plan_type?.[type]?.defaulting || 0), 0)]
      ].map(([label, value]) => `<div class="kpi"><div class="kpi-label">${S.escape(label)}</div><div class="kpi-value">${typeof value === "number" ? value : S.escape(value)}</div></div>`).join("");
      const pages = Math.max(1, Math.ceil(total / limit));
      el("defaultingPageLabel").textContent = `Page ${page} of ${pages}`;
      el("defaultingPrev").disabled = page <= 1;
      el("defaultingNext").disabled = page >= pages;
      el("defaultingBody").innerHTML = rows.length ? rows.map(row => `
        <tr>
          <td><strong>${S.escape(row.client_name)}</strong><div class="small muted">${S.escape(row.client_reference)} · ${S.escape(row.phone_number || "")}</div></td>
          <td>${S.escape(row.branch_name || "-")}</td>
          <td>${S.badge(planLabel(row.plan_type), row.is_easy_buy ? "blue" : "gray")}</td>
          <td>${S.money(row.expected_to_date_kobo)}</td>
          <td>${S.money(row.paid_to_date_kobo)}</td>
          <td><strong style="color:${row.amount_behind_kobo > 0 ? "var(--red,#DC2626)" : "var(--green-dark)"}">${S.money(row.amount_behind_kobo)}</strong></td>
          <td>${row.days_overdue || 0}</td>
          <td>${row.status === "defaulting" ? S.badge("Defaulting", "red") : S.badge("Performing", "green")}</td>
          <td>${row.follow_up_status ? `${S.escape(row.follow_up_status)}<div class="small muted">${row.next_follow_up_date ? S.formatDate(row.next_follow_up_date) : ""}</div>` : '<span class="small muted">None</span>'}</td>
          <td class="toolbar">
            <button class="btn btn-ghost btn-xs" type="button" data-follow-up="${row.schedule_id}" data-client="${S.escape(row.client_name)}">Follow up</button>
            <a class="btn btn-ghost btn-xs" href="client-detail.html?id=${row.client_id}">Client</a>
          </td>
        </tr>`).join("") : '<tr><td colspan="10"><div class="empty-state">No clients match the selected filters.</div></td></tr>';
      el("defaultingBody").querySelectorAll("[data-follow-up]").forEach(button => {
        button.addEventListener("click", () => openFollowUp(Number(button.getAttribute("data-follow-up")), button.getAttribute("data-client")));
      });
    } catch (error) {
      S.toast(error.message || "Unable to load defaulting clients", true);
      el("defaultingBody").innerHTML = '<tr><td colspan="10"><div class="empty-state">Unable to load defaulting clients.</div></td></tr>';
    }
  }

  function openFollowUp(scheduleId, clientName) {
    el("followUpScheduleId").value = String(scheduleId);
    el("followUpTitle").textContent = `Follow-up: ${clientName}`;
    el("followUpNote").value = "";
    el("followUpDate").value = "";
    el("followUpStatus").value = "contacted";
    S.openModal("followUpModal");
  }

  document.addEventListener("DOMContentLoaded", async () => {
    me = await S.initShell("defaulting");
    if (!me) return;
    await loadOptions();
    el("applyDefaulting").addEventListener("click", () => { page = 1; load(); });
    el("resetDefaulting").addEventListener("click", () => {
      el("defaultingSearch").value = "";
      el("defaultingStatus").value = "";
      el("defaultingPlan").value = "";
      if (!el("defaultingBranch").disabled) el("defaultingBranch").value = "";
      el("defaultingTeamLead").value = "";
      el("defaultingStaff").value = "";
      page = 1;
      load();
    });
    el("defaultingPrev").addEventListener("click", () => { if (page > 1) { page--; load(); } });
    el("defaultingNext").addEventListener("click", () => { page++; load(); });
    el("followUpForm").addEventListener("submit", async event => {
      event.preventDefault();
      const scheduleId = el("followUpScheduleId").value;
      const payload = {
        owner_user_id: el("followUpOwner").value ? Number(el("followUpOwner").value) : null,
        note: el("followUpNote").value.trim(),
        next_follow_up_date: el("followUpDate").value || null,
        status: el("followUpStatus").value
      };
      try {
        await S.fetchJson(`/api/defaulting-clients/${scheduleId}/follow-ups`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
        });
        S.closeModal("followUpModal");
        S.toast("Follow-up saved");
        await load();
      } catch (error) { S.toast(error.message || "Unable to save follow-up", true); }
    });
    await load();
  });
})();
