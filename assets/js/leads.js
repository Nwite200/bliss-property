(function () {
  const S = window.BlissStaff;
  let me = null;
  let branches = [];
  let assignees = [];
  let properties = [];
  let leads = [];
  let page = 1;
  let total = 0;
  let currentDetail = null;
  let editingFollowUpId = null;

  const el = id => document.getElementById(id);
  const statuses = ["New Lead", "Contacted", "Interested", "Inspection Scheduled", "Negotiation", "Converted", "Lost"];
  const money = kobo => S.money(kobo);

  async function loadBranches() {
    const data = await S.fetchJson("/api/branches");
    branches = data.branches || [];
    fillBranchSelects();
  }

  function fillBranchSelects() {
    const filter = el("leadBranchFilter");
    const form = el("leadBranch");
    filter.innerHTML = '<option value="">All branches</option>';
    form.innerHTML = '<option value="">Select branch</option>';
    branches.forEach(branch => {
      const option = document.createElement("option");
      option.value = branch.id;
      option.textContent = branch.name;
      filter.appendChild(option);
      form.appendChild(option.cloneNode(true));
    });
    if (!["Managing Director"].includes(me.role)) {
      filter.style.display = "none";
      el("leadBranchGroup").style.display = "none";
      form.value = me.branch_id;
    }
  }

  async function loadAssignees() {
    assignees = [];
    if (["Managing Director", "Branch Manager"].includes(me.role)) {
      const data = await S.fetchJson("/api/staff?role=Marketer&limit=100");
      assignees = (data.staff || []).filter(row => row.is_active);
    } else if (me.role === "Team Lead") {
      const data = await S.fetchJson("/api/dashboard");
      assignees = (data.team_members || []).filter(row => row.is_active && ["Marketer", "Team Lead"].includes(row.role_name));
    }
    const select = el("leadMarketer");
    const filter = el("leadMarketerFilter");
    select.innerHTML = '<option value="">Unassigned</option>';
    filter.innerHTML = '<option value="">All marketers</option>';
    assignees.forEach(row => {
      const option = document.createElement("option");
      option.value = row.id;
      option.textContent = row.full_name;
      select.appendChild(option);
      filter.appendChild(option.cloneNode(true));
    });
    const visible = me.role !== "Marketer" && assignees.length > 0;
    el("leadMarketerGroup").style.display = visible ? "" : "none";
    filter.style.display = visible ? "" : "none";
  }

  async function loadProperties() {
    try {
      const data = await S.fetchJson("/api/properties?limit=50");
      properties = data.properties || [];
      const select = el("leadProperty");
      select.innerHTML = '<option value="">No property selected</option>';
      properties.forEach(property => {
        const option = document.createElement("option");
        option.value = property.id;
        option.textContent = `${property.reference} — ${property.title}`;
        select.appendChild(option);
      });
    } catch { properties = []; }
  }

  function fillStatuses() {
    [el("leadStatus"), el("leadStatusFilter")].forEach(select => {
      if (select.id === "leadStatusFilter") select.innerHTML = '<option value="">All statuses</option>';
      else select.innerHTML = "";
      statuses.forEach(status => {
        const option = document.createElement("option");
        option.value = status;
        option.textContent = status;
        select.appendChild(option);
      });
    });
  }

  function queryParams() {
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("limit", "20");
    if (el("leadSearch").value.trim()) params.set("q", el("leadSearch").value.trim());
    if (el("leadStatusFilter").value) params.set("status", el("leadStatusFilter").value);
    if (el("leadMarketerFilter").value) params.set("marketer_id", el("leadMarketerFilter").value);
    if (["Managing Director"].includes(me.role) && el("leadBranchFilter").value) params.set("branch_id", el("leadBranchFilter").value);
    if (el("followUpDueFilter").checked) params.set("follow_up_due", "1");
    return params;
  }

  async function loadLeads() {
    try {
      const data = await S.fetchJson("/api/leads?" + queryParams().toString());
      leads = data.leads || [];
      total = data.pagination ? data.pagination.total : leads.length;
      el("leadCount").textContent = `${total} lead${total === 1 ? "" : "s"}`;
      const pages = Math.max(1, Math.ceil(total / 20));
      el("leadPageLabel").textContent = `Page ${page} of ${pages}`;
      el("leadPrev").disabled = page <= 1;
      el("leadNext").disabled = page >= pages;
      renderTable();
    } catch (error) { S.toast(error.message, true); }
  }

  async function loadPipeline() {
    try {
      const data = await S.fetchJson("/api/dashboard");
      const pipeline = data.lead_pipeline || {};
      el("pipelineBoard").innerHTML = statuses.map(status => {
        const cls = status === "Converted" ? "converted" : status === "Lost" ? "lost" : "";
        return `<div class="pipeline-stage ${cls}"><div class="stage-name">${S.escape(status)}</div><div class="stage-count">${Number(pipeline[status] || 0)}</div></div>`;
      }).join("");
    } catch { /* optional */ }
  }

  function renderTable() {
    el("leadBody").innerHTML = leads.length ? leads.map(lead => `
      <tr>
        <td><strong>${S.escape(lead.full_name)}</strong><div class="small muted">${S.escape(lead.lead_reference)} · ${S.escape(lead.phone_number)}</div></td>
        <td>${S.leadBadge(lead.status)}</td>
        <td>${S.escape(lead.marketer_name || "-")}</td>
        <td>${S.escape(lead.branch_name || "-")}</td>
        <td>${S.escape(lead.property_title || "-")}</td>
        <td>${lead.next_follow_up_date ? S.formatDate(lead.next_follow_up_date) : "-"}</td>
        <td class="nowrap">${lead.estimated_value_kobo ? money(lead.estimated_value_kobo) : "-"}</td>
        <td class="toolbar"><button class="btn btn-ghost btn-xs" type="button" data-edit-lead-id="${lead.id}">Edit</button><button class="btn btn-ghost btn-xs" type="button" data-lead-id="${lead.id}">Open</button></td>
      </tr>`).join("") : '<tr><td colspan="8"><div class="empty-state">No leads match the current filter.</div></td></tr>';
    el("leadBody").querySelectorAll("[data-lead-id]").forEach(button => {
      button.addEventListener("click", () => openLeadDetail(Number(button.getAttribute("data-lead-id"))));
    });
    el("leadBody").querySelectorAll("[data-edit-lead-id]").forEach(button => {
      button.addEventListener("click", () => {
        const lead = leads.find(item => Number(item.id) === Number(button.getAttribute("data-edit-lead-id")));
        if (lead) openEditLead(lead);
      });
    });
  }

  function openNewLead() {
    el("leadId").value = "";
    el("leadModalTitle").textContent = "Add lead";
    el("leadForm").reset();
    el("leadStatus").value = "New Lead";
    el("leadBranch").value = me.branch_id || "";
    el("leadMarketer").value = "";
    el("leadProperty").value = "";
    S.openModal("leadModal");
  }

  function openEditLead(lead) {
    el("leadId").value = lead.id;
    el("leadModalTitle").textContent = "Edit lead";
    el("leadFullName").value = lead.full_name || "";
    el("leadPhone").value = lead.phone_number || "";
    el("leadEmail").value = lead.email_address || "";
    el("leadSource").value = lead.source || "";
    el("leadStatus").value = lead.status || "New Lead";
    el("leadBranch").value = lead.branch_id || "";
    el("leadMarketer").value = lead.assigned_marketer_id || "";
    el("leadProperty").value = lead.property_id || "";
    el("leadEstimated").value = lead.estimated_value_kobo ? Number(lead.estimated_value_kobo) / 100 : "";
    el("leadFollowUp").value = lead.next_follow_up_date ? String(lead.next_follow_up_date).slice(0, 10) : "";
    el("leadNotes").value = lead.notes || "";
    S.openModal("leadModal");
  }

  async function submitLead(event) {
    event.preventDefault();
    const id = el("leadId").value;
    const body = {
      full_name: el("leadFullName").value.trim(),
      phone_number: el("leadPhone").value.trim(),
      email_address: el("leadEmail").value.trim(),
      source: el("leadSource").value.trim(),
      status: el("leadStatus").value,
      property_id: el("leadProperty").value ? Number(el("leadProperty").value) : null,
      assigned_marketer_id: el("leadMarketer").value ? Number(el("leadMarketer").value) : null,
      branch_id: el("leadBranch").value ? Number(el("leadBranch").value) : null,
      estimated_value: el("leadEstimated").value ? Number(el("leadEstimated").value) : 0,
      notes: el("leadNotes").value.trim(),
      next_follow_up_date: el("leadFollowUp").value || null
    };
    if (me.role === "Marketer") {
      delete body.assigned_marketer_id;
      delete body.branch_id;
    }
    if (body.status === "Converted") delete body.status;
    try {
      if (id) await S.fetchJson(`/api/leads/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      else await S.fetchJson("/api/leads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      S.closeModal("leadModal");
      S.toast(id ? "Lead updated." : "Lead added to the pipeline.");
      await loadLeads();
      await loadPipeline();
    } catch (error) { S.toast(error.message, true); }
  }

  async function openLeadDetail(id) {
    try {
      const data = await S.fetchJson(`/api/leads/${id}`);
      currentDetail = data.lead;
      editingFollowUpId = null;
      renderLeadDetail(data);
      S.openModal("leadDetailModal");
    } catch (error) { S.toast(error.message, true); }
  }

  function renderLeadDetail(data) {
    const lead = data.lead;
    const followUps = data.follow_ups || [];
    const canSetPrice = ["Managing Director", "Branch Manager"].includes(me.role);
    el("leadDetailTitle").textContent = `${lead.full_name} — ${lead.lead_reference}`;
    const statusOptions = statuses.filter(status => status !== "Converted" || lead.status === "Converted")
      .map(status => `<option value="${status}" ${status === lead.status ? "selected" : ""}>${status}</option>`).join("");
    el("leadDetailBody").innerHTML = `
      <div class="split-grid wide-left">
        <div>
          <div class="card" style="box-shadow:none">
            <div class="card-head"><h3>${S.escape(lead.full_name)}</h3>${S.leadBadge(lead.status)}</div>
            <table class="table">
              <tr><td class="muted">Phone</td><td>${S.escape(lead.phone_number)}</td></tr>
              <tr><td class="muted">Email</td><td>${S.escape(lead.email_address || "-")}</td></tr>
              <tr><td class="muted">Source</td><td>${S.escape(lead.source || "-")}</td></tr>
              <tr><td class="muted">Marketer</td><td>${S.escape(lead.marketer_name || "-")}</td></tr>
              <tr><td class="muted">Team lead</td><td>${S.escape(lead.team_lead_name || "-")}</td></tr>
              <tr><td class="muted">Branch</td><td>${S.escape(lead.branch_name || "-")}</td></tr>
              <tr><td class="muted">Property</td><td>${S.escape(lead.property_title || "-")}</td></tr>
              <tr><td class="muted">Estimated value</td><td>${lead.estimated_value_kobo ? money(lead.estimated_value_kobo) : "-"}</td></tr>
              <tr><td class="muted">Next follow-up</td><td>${lead.next_follow_up_date ? S.formatDate(lead.next_follow_up_date) : "-"}</td></tr>
              <tr><td class="muted">Created</td><td>${S.formatDateTime(lead.created_at)}</td></tr>
            </table>
            ${lead.notes ? `<p class="small muted mt-16">${S.escape(lead.notes)}</p>` : ""}
            ${lead.converted_client_id ? `<div class="route-note mt-16">Converted to client <a href="client-detail.html?id=${lead.converted_client_id}"><strong>#${lead.converted_client_id}</strong></a></div>` : ""}
          </div>
        </div>
        <div>
          <div class="card" style="box-shadow:none">
            <h3>Update status</h3>
            <div class="toolbar">
              <select class="field-input" id="detailStatus" ${lead.converted_client_id ? "disabled" : ""}>${statusOptions}</select>
              <button class="btn btn-green btn-sm" type="button" id="updateStatusBtn" ${lead.converted_client_id ? "disabled" : ""}>Update</button>
            </div>
            ${!lead.converted_client_id ? `
              <div class="mt-16">
                <h3>Convert lead</h3>
                ${canSetPrice ? '<div class="field-group"><label class="field-label" for="convertPrice">Agreed contract price (₦)</label><input class="field-input" type="number" min="0" step="0.01" id="convertPrice" placeholder="Optional"></div>' : '<div class="route-note">Conversion creates a client under your branch. Contract price can only be set by a Branch Manager or Managing Director.</div>'}
                <button class="btn btn-green btn-sm mt-16" type="button" id="convertLeadBtn">Convert to client</button>
              </div>` : ""}
          </div>
        </div>
      </div>
      <div class="card section-gap" style="box-shadow:none">
        <div class="card-head"><h3>Follow-ups</h3><span class="small muted">Notes and scheduled dates</span></div>
        <form id="followUpForm" class="form-grid">
          <input type="hidden" id="followUpId">
          <div class="field-group full"><label class="field-label" for="followUpNote">Follow-up note</label><textarea class="field-input" id="followUpNote" rows="2" required></textarea></div>
          <div class="field-group"><label class="field-label" for="followUpChannel">Channel</label><select class="field-input" id="followUpChannel"><option>Phone</option><option>WhatsApp</option><option>Email</option><option>In person</option><option>Other</option></select></div>
          <div class="field-group"><label class="field-label" for="followUpOutcome">Outcome</label><input class="field-input" id="followUpOutcome" placeholder="e.g. Interested, call back"></div>
          <div class="field-group"><label class="field-label" for="followUpDate">Next follow-up date</label><input class="field-input" type="date" id="followUpDate"></div>
          <div class="field-group" style="display:flex;align-items:flex-end;gap:8px"><button class="btn btn-green btn-sm" type="submit" id="followUpSubmit">Save follow-up</button><button class="btn btn-ghost btn-sm" type="button" id="cancelFollowUpEdit" style="display:none">Cancel edit</button></div>
        </form>
        <div class="activity-feed mt-16" id="followUpList">${followUps.length ? followUps.map(item => `
          <div class="activity-item">
            <div class="activity-dot">✎</div>
            <div class="activity-main">
              <strong>${S.escape(item.staff_name || "Staff")} · ${S.escape(item.channel || "Note")}</strong>
              <p>${S.escape(item.note)}</p>
              <div class="activity-meta"><span>${S.formatDateTime(item.created_at)}</span>${item.follow_up_date ? `<span>Next: ${S.formatDate(item.follow_up_date)}</span>` : ""}${item.outcome ? `<span>${S.escape(item.outcome)}</span>` : ""}</div>
            </div>
            <button class="btn btn-ghost btn-xs" type="button" data-edit-followup="${item.id}" data-note="${S.escape(item.note)}" data-channel="${S.escape(item.channel || "Phone")}" data-outcome="${S.escape(item.outcome || "")}" data-date="${item.follow_up_date || ""}">Edit</button>
          </div>`).join("") : '<div class="empty-state">No follow-ups recorded.</div>'}</div>
      </div>`;
    el("updateStatusBtn").addEventListener("click", updateDetailStatus);
    const convertBtn = el("convertLeadBtn");
    if (convertBtn) convertBtn.addEventListener("click", convertLead);
    el("followUpForm").addEventListener("submit", submitFollowUp);
    el("cancelFollowUpEdit").addEventListener("click", () => resetFollowUpForm());
    el("followUpList").querySelectorAll("[data-edit-followup]").forEach(button => {
      button.addEventListener("click", () => {
        editingFollowUpId = Number(button.getAttribute("data-edit-followup"));
        el("followUpNote").value = button.getAttribute("data-note") || "";
        el("followUpChannel").value = button.getAttribute("data-channel") || "Phone";
        el("followUpOutcome").value = button.getAttribute("data-outcome") || "";
        el("followUpDate").value = button.getAttribute("data-date") || "";
        el("followUpSubmit").textContent = "Update follow-up";
        el("cancelFollowUpEdit").style.display = "";
      });
    });
  }

  function resetFollowUpForm() {
    editingFollowUpId = null;
    el("followUpNote").value = "";
    el("followUpOutcome").value = "";
    el("followUpDate").value = "";
    el("followUpSubmit").textContent = "Save follow-up";
    el("cancelFollowUpEdit").style.display = "none";
  }

  async function refreshDetail() {
    if (!currentDetail) return;
    const data = await S.fetchJson(`/api/leads/${currentDetail.id}`);
    currentDetail = data.lead;
    renderLeadDetail(data);
  }

  async function updateDetailStatus() {
    try {
      await S.fetchJson(`/api/leads/${currentDetail.id}/status`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: el("detailStatus").value })
      });
      S.toast("Lead status updated.");
      await refreshDetail();
      await loadLeads();
      await loadPipeline();
    } catch (error) { S.toast(error.message, true); }
  }

  async function submitFollowUp(event) {
    event.preventDefault();
    const body = {
      note: el("followUpNote").value.trim(),
      channel: el("followUpChannel").value,
      outcome: el("followUpOutcome").value.trim(),
      follow_up_date: el("followUpDate").value || null
    };
    try {
      if (editingFollowUpId) {
        await S.fetchJson(`/api/leads/${currentDetail.id}/follow-ups/${editingFollowUpId}`, {
          method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
        });
        S.toast("Follow-up updated.");
      } else {
        await S.fetchJson(`/api/leads/${currentDetail.id}/follow-ups`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
        });
        S.toast("Follow-up recorded.");
      }
      resetFollowUpForm();
      await refreshDetail();
      await loadLeads();
      await loadPipeline();
    } catch (error) { S.toast(error.message, true); }
  }

  async function convertLead() {
    if (!confirm("Convert this lead into a client record?")) return;
    const priceInput = el("convertPrice");
    const body = {};
    if (priceInput && priceInput.value) body.agreed_purchase_price = Number(priceInput.value);
    try {
      const result = await S.fetchJson(`/api/leads/${currentDetail.id}/convert`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
      });
      S.toast(`Lead converted to client ${result.client_reference}.`);
      S.closeModal("leadDetailModal");
      await loadLeads();
      await loadPipeline();
    } catch (error) { S.toast(error.message, true); }
  }

  document.addEventListener("DOMContentLoaded", async () => {
    me = await S.initShell("leads");
    if (!me) return;
    if (!["Managing Director", "Branch Manager", "Team Lead", "Marketer"].includes(me.role)) {
      window.location.href = "dashboard.html";
      return;
    }
    el("heroMeta").innerHTML = [
      `<span class="scope-badge">${S.escape(me.role)}</span>`,
      `<span class="scope-badge">${S.escape(me.branch_name || "Branch")}</span>`
    ].join("");
    fillStatuses();
    await loadBranches();
    await loadAssignees();
    await loadProperties();
    await loadLeads();
    await loadPipeline();
    el("newLeadBtn").addEventListener("click", openNewLead);
    el("leadForm").addEventListener("submit", submitLead);
    el("applyLeadFilters").addEventListener("click", () => { page = 1; loadLeads(); });
    el("resetLeadFilters").addEventListener("click", () => {
      el("leadSearch").value = "";
      el("leadStatusFilter").value = "";
      el("leadMarketerFilter").value = "";
      if (el("leadBranchFilter")) el("leadBranchFilter").value = "";
      el("followUpDueFilter").checked = false;
      page = 1;
      loadLeads();
    });
    el("leadSearch").addEventListener("keydown", event => { if (event.key === "Enter") { page = 1; loadLeads(); } });
    el("leadPrev").addEventListener("click", () => { if (page > 1) { page--; loadLeads(); } });
    el("leadNext").addEventListener("click", () => { if (page * 20 < total) { page++; loadLeads(); } });
    if (S.query().get("follow_up_due") === "1") {
      el("followUpDueFilter").checked = true;
      page = 1;
      await loadLeads();
    }
  });
})();
