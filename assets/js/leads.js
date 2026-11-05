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
    if (el("leadTemperatureFilter").value) params.set("temperature", el("leadTemperatureFilter").value);
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
      const temps = data.temperature_counts || {};
      el("temperatureCounts").innerHTML = ["Hot", "Warm", "Cold", "Unset"].map(temp => {
        const tone = temp === "Hot" ? "badge-red" : temp === "Warm" ? "badge-amber" : "badge-gray";
        return `<span class="badge ${tone}">${temp}: ${Number(temps[temp] || 0)}</span>`;
      }).join("");
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
        <td>${lead.lead_temperature ? `<span class="badge ${lead.lead_temperature === "Hot" ? "badge-red" : lead.lead_temperature === "Warm" ? "badge-amber" : "badge-gray"}">${S.escape(lead.lead_temperature)}</span>` : "-"}</td>
        <td>${S.escape(lead.marketer_name || "-")}</td>
        <td>${S.escape(lead.branch_name || "-")}</td>
        <td>${S.escape(lead.property_title || "-")}</td>
        <td>${lead.inspection_date ? `${S.formatDate(lead.inspection_date)}<div class="small muted">${S.escape(lead.inspection_time || "")}</div>` : "-"}</td>
        <td>${lead.contact_count || 0}<div class="small muted">${lead.last_contact_at ? S.formatDate(lead.last_contact_at) : ""}</div></td>
        <td>${lead.next_follow_up_date ? S.formatDate(lead.next_follow_up_date) : "-"}</td>
        <td class="nowrap">${lead.estimated_value_kobo ? money(lead.estimated_value_kobo) : "-"}</td>
        <td class="toolbar">
          ${["New Lead", "Contacted", "Interested", "Negotiation", "Inspection Scheduled"].includes(lead.status) && !lead.converted_client_id ? `<button class="btn btn-ghost btn-xs" type="button" data-inspect-lead-id="${lead.id}">Inspect</button>` : ""}
          <button class="btn btn-ghost btn-xs" type="button" data-edit-lead-id="${lead.id}">Edit</button><button class="btn btn-ghost btn-xs" type="button" data-lead-id="${lead.id}">Open</button>
        </td>
      </tr>`).join("") : '<tr><td colspan="11"><div class="empty-state">No leads match the current filter.</div></td></tr>';
    el("leadBody").querySelectorAll("[data-inspect-lead-id]").forEach(button => {
      button.addEventListener("click", () => {
        const lead = leads.find(item => Number(item.id) === Number(button.getAttribute("data-inspect-lead-id")));
        if (lead) openInspectionModal(lead);
      });
    });
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

  async function loadInspectionSummary() {
    try {
      const data = await S.fetchJson("/api/inspections/summary");
      el("inspectionCount").textContent = `${data.today || 0} today · ${data.this_week || 0} in the next 7 days`;
      el("inspectionKpis").innerHTML = [
        ["Inspections today", data.today || 0],
        ["Next 7 days", data.this_week || 0],
        ["Branches with inspections", (data.by_branch || []).length],
        ["Marketers with inspections", (data.by_marketer || []).length],
        ["Upcoming listed", (data.upcoming || []).length]
      ].map(([label, value]) => `<div class="kpi"><div class="kpi-label">${S.escape(label)}</div><div class="kpi-value">${value}</div></div>`).join("");
      el("inspectionBody").innerHTML = (data.upcoming || []).length ? data.upcoming.map(row => `
        <tr>
          <td><strong>${S.escape(row.full_name)}</strong><div class="small muted">${S.escape(row.lead_reference)} · ${S.escape(row.phone_number || "")}</div></td>
          <td>${S.formatDate(row.inspection_date)}</td>
          <td>${S.escape(row.inspection_time || "-")}</td>
          <td>${S.escape(row.property_title || "-")}</td>
          <td>${S.escape(row.marketer_name || "-")}</td>
          <td>${S.escape(row.branch_name || "-")}</td>
        </tr>`).join("") : '<tr><td colspan="6"><div class="empty-state">No inspections scheduled in the next 7 days.</div></td></tr>';
    } catch (error) {
      el("inspectionBody").innerHTML = '<tr><td colspan="6"><div class="empty-state">Unable to load inspections.</div></td></tr>';
    }
  }

  function openInspectionModal(lead) {
    el("inspectionLeadId").value = lead.id;
    el("inspectionTitle").textContent = `Schedule inspection: ${lead.full_name}`;
    el("inspectionDate").value = lead.inspection_date ? String(lead.inspection_date).slice(0, 10) : S.today();
    el("inspectionTime").value = lead.inspection_time || "10:00";
    el("inspectionNotes").value = lead.inspection_notes || "";
    el("inspectionProperty").innerHTML = '<option value="">Use lead property / no property</option>' + properties.map(property => `<option value="${property.id}">${S.escape(property.reference)} — ${S.escape(property.title)}</option>`).join("");
    el("inspectionProperty").value = lead.inspection_property_id || lead.property_id || "";
    S.openModal("inspectionModal");
  }

  async function submitInspection(event) {
    event.preventDefault();
    const leadId = el("inspectionLeadId").value;
    try {
      await S.fetchJson(`/api/leads/${leadId}/inspection`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inspection_date: el("inspectionDate").value,
          inspection_time: el("inspectionTime").value,
          property_id: el("inspectionProperty").value ? Number(el("inspectionProperty").value) : null,
          notes: el("inspectionNotes").value.trim()
        })
      });
      S.closeModal("inspectionModal");
      S.toast("Inspection scheduled.");
      await Promise.all([loadLeads(), loadPipeline(), loadInspectionSummary()]);
    } catch (error) { S.toast(error.message, true); }
  }

  async function submitBulkImport() {
    const text = el("bulkLeadText").value.trim();
    if (!text && !el("bulkLeadFile").files.length) { S.toast("Paste CSV or choose a file first.", true); return; }
    let csv = text;
    if (!csv && el("bulkLeadFile").files.length) csv = await el("bulkLeadFile").files[0].text();
    const button = el("bulkLeadSubmit");
    button.disabled = true;
    try {
      const result = await S.fetchJson("/api/leads/bulk", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv, source: el("bulkLeadSource").value.trim() || null })
      });
      el("bulkLeadResult").textContent = `${result.created_count} lead(s) imported, ${result.skipped_count} skipped.`;
      S.toast(`${result.created_count} lead(s) imported.`);
      await Promise.all([loadLeads(), loadPipeline()]);
    } catch (error) { S.toast(error.message, true); }
    finally { button.disabled = false; }
  }

  function openNewLead() {
    el("leadId").value = "";
    el("leadModalTitle").textContent = "Add lead";
    el("leadForm").reset();
    el("leadStatus").value = "New Lead";
    el("leadTemperature").value = "";
    el("leadReferrer").value = "";
    el("leadBranch").value = me.branch_id || "";
    el("leadMarketer").value = "";
    el("leadProperty").value = "";
    el("leadInspectionDate").value = "";
    el("leadInspectionTime").value = "";
    S.openModal("leadModal");
  }

  function openEditLead(lead) {
    el("leadId").value = lead.id;
    el("leadModalTitle").textContent = "Edit lead";
    el("leadFullName").value = lead.full_name || "";
    el("leadPhone").value = lead.phone_number || "";
    el("leadEmail").value = lead.email_address || "";
    el("leadSource").value = lead.source || "";
    el("leadReferrer").value = lead.referrer || "";
    el("leadTemperature").value = lead.lead_temperature || "";
    el("leadStatus").value = lead.status || "New Lead";
    el("leadBranch").value = lead.branch_id || "";
    el("leadMarketer").value = lead.assigned_marketer_id || "";
    el("leadProperty").value = lead.property_id || "";
    el("leadEstimated").value = lead.estimated_value_kobo ? Number(lead.estimated_value_kobo) / 100 : "";
    el("leadFollowUp").value = lead.next_follow_up_date ? String(lead.next_follow_up_date).slice(0, 10) : "";
    el("leadInspectionDate").value = lead.inspection_date ? String(lead.inspection_date).slice(0, 10) : "";
    el("leadInspectionTime").value = lead.inspection_time || "";
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
      referrer: el("leadReferrer").value.trim(),
      lead_temperature: el("leadTemperature").value || null,
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
      let leadId = id;
      if (id) {
        await S.fetchJson(`/api/leads/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      } else {
        const created = await S.fetchJson("/api/leads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        leadId = created.id;
      }
      if (el("leadInspectionDate").value && el("leadInspectionTime").value) {
        await S.fetchJson(`/api/leads/${leadId}/inspection`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            inspection_date: el("leadInspectionDate").value,
            inspection_time: el("leadInspectionTime").value,
            property_id: body.property_id || null
          })
        });
      }
      S.closeModal("leadModal");
      S.toast(id ? "Lead updated." : "Lead added to the pipeline.");
      await loadLeads();
      await loadPipeline();
      await loadInspectionSummary();
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
              <tr><td class="muted">Referrer</td><td>${S.escape(lead.referrer || "-")}</td></tr>
              <tr><td class="muted">Temperature</td><td>${lead.lead_temperature ? `<span class="badge ${lead.lead_temperature === "Hot" ? "badge-red" : lead.lead_temperature === "Warm" ? "badge-amber" : "badge-gray"}">${S.escape(lead.lead_temperature)}</span>` : "-"}</td></tr>
              <tr><td class="muted">Contacts</td><td>${data.follow_ups ? data.follow_ups.length : 0} · last ${lead.last_contact_at ? S.formatDateTime(lead.last_contact_at) : "-"}</td></tr>
              ${lead.lost_reason ? `<tr><td class="muted">Lost reason</td><td>${S.escape(lead.lost_reason)}</td></tr>` : ""}
              <tr><td class="muted">Marketer</td><td>${S.escape(lead.marketer_name || "-")}</td></tr>
              <tr><td class="muted">Team lead</td><td>${S.escape(lead.team_lead_name || "-")}</td></tr>
              <tr><td class="muted">Branch</td><td>${S.escape(lead.branch_name || "-")}</td></tr>
              <tr><td class="muted">Property</td><td>${S.escape(lead.property_title || "-")}</td></tr>
              <tr><td class="muted">Inspection</td><td>${lead.inspection_date ? `${S.formatDate(lead.inspection_date)} ${S.escape(lead.inspection_time || "")}` : "-"}</td></tr>
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
              ${!lead.converted_client_id ? '<button class="btn btn-ghost btn-sm" type="button" id="detailInspectBtn">Schedule inspection</button>' : ""}
            </div>
            ${!lead.converted_client_id ? `
              <div class="mt-16">
                <h3>Lead temperature</h3>
                <div class="toolbar">
                  <select class="field-input" id="detailTemperature">
                    <option value="">Not set</option>
                    ${["Hot", "Warm", "Cold"].map(t => `<option value="${t}" ${lead.lead_temperature === t ? "selected" : ""}>${t}</option>`).join("")}
                  </select>
                  <button class="btn btn-ghost btn-sm" type="button" id="updateTemperatureBtn">Update temperature</button>
                </div>
                <div class="small muted mt-16">${(data.temperature_history || []).slice(0, 3).map(row => `${S.escape(row.old_temperature || "Unset")} → ${S.escape(row.new_temperature)} · ${S.formatDateTime(row.created_at)}`).join("<br>") || "No temperature changes yet."}</div>
              </div>` : ""}
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
          <div class="field-group"><label class="field-label" for="followUpContactType">Contact type</label><select class="field-input" id="followUpContactType"><option value="call">Call</option><option value="whatsapp">WhatsApp</option><option value="visit">Visit</option><option value="sms">SMS</option><option value="other">Other</option></select></div>
          <div class="field-group"><label class="field-label" for="followUpContactedAt">Contact date</label><input class="field-input" type="date" id="followUpContactedAt"></div>
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
    const inspectBtn = el("detailInspectBtn");
    if (inspectBtn) inspectBtn.addEventListener("click", () => openInspectionModal(lead));
    const tempBtn = el("updateTemperatureBtn");
    if (tempBtn) tempBtn.addEventListener("click", updateTemperature);
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
    if (el("followUpContactedAt")) el("followUpContactedAt").value = "";
    el("followUpSubmit").textContent = "Save follow-up";
    el("cancelFollowUpEdit").style.display = "none";
  }

  async function updateTemperature() {
    const temperature = el("detailTemperature").value;
    if (!temperature) { S.toast("Choose Hot, Warm or Cold.", true); return; }
    try {
      await S.fetchJson(`/api/leads/${currentDetail.id}/temperature`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ temperature })
      });
      S.toast("Lead temperature updated.");
      await refreshDetail();
      await loadLeads();
    } catch (error) { S.toast(error.message, true); }
  }

  async function refreshDetail() {
    if (!currentDetail) return;
    const data = await S.fetchJson(`/api/leads/${currentDetail.id}`);
    currentDetail = data.lead;
    renderLeadDetail(data);
  }

  async function updateDetailStatus() {
    const status = el("detailStatus").value;
    const body = { status };
    if (status === "Lost") {
      const reason = prompt("Lost reason (required):");
      if (!reason || !reason.trim()) { S.toast("A lost reason is required.", true); return; }
      body.lost_reason = reason.trim();
    }
    try {
      await S.fetchJson(`/api/leads/${currentDetail.id}/status`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
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
      contact_type: el("followUpContactType").value,
      contacted_at: el("followUpContactedAt").value ? el("followUpContactedAt").value + "T12:00:00.000Z" : null,
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
    await loadInspectionSummary();
    el("newLeadBtn").addEventListener("click", openNewLead);
    el("bulkImportBtn").addEventListener("click", () => { el("bulkLeadResult").textContent = ""; S.openModal("bulkLeadModal"); });
    el("bulkLeadSubmit").addEventListener("click", submitBulkImport);
    el("inspectionForm").addEventListener("submit", submitInspection);
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
    const linkedLead = Number(S.query().get("lead") || 0);
    if (linkedLead) await openLeadDetail(linkedLead);
  });
})();
