(function () {
  const S = window.BlissStaff;
  let me = null;
  let branches = [];
  let teams = [];
  let staff = [];

  const el = id => document.getElementById(id);
  const isMD = () => me && me.role === "Managing Director";

  function roleOptions() {
    return isMD()
      ? ["Branch Manager", "Project Manager", "Team Lead", "Marketer", "Finance Officer", "Head Accountant", "Customer Care"]
      : ["Team Lead", "Marketer", "Finance Officer"];
  }

  function fillSelect(select, items, valueKey, labelKey, includeEmpty) {
    select.innerHTML = includeEmpty ? `<option value="">${includeEmpty}</option>` : "";
    items.forEach(item => {
      const option = document.createElement("option");
      option.value = item[valueKey];
      option.textContent = item[labelKey];
      select.appendChild(option);
    });
  }

  function branchName(id) {
    const branch = branches.find(item => Number(item.id) === Number(id));
    return branch ? branch.name : "-";
  }

  async function loadBranches() {
    const data = await S.fetchJson("/api/branches");
    branches = data.branches || [];
    const staffBranch = el("staffBranch");
    const staffFilter = el("staffBranchFilter");
    const teamBranch = el("teamBranch");
    fillSelect(staffBranch, isMD() ? branches : branches.filter(b => Number(b.id) === Number(me.branch_id)), "id", "name");
    fillSelect(staffFilter, branches, "id", "name", "All branches");
    fillSelect(teamBranch, isMD() ? branches : branches.filter(b => Number(b.id) === Number(me.branch_id)), "id", "name");
    if (!isMD()) {
      staffBranch.value = me.branch_id;
      staffBranch.disabled = true;
      teamBranch.value = me.branch_id;
      teamBranch.disabled = true;
      staffFilter.style.display = "none";
    }
  }

  async function loadTeams() {
    const data = await S.fetchJson("/api/teams?include_inactive=1");
    teams = data.teams || [];
    el("teamCount").textContent = `${teams.filter(t => t.is_active).length} active team${teams.filter(t => t.is_active).length === 1 ? "" : "s"}`;
    renderTeams();
  }

  async function loadReactivation() {
    if (!["Managing Director", "Branch Manager", "Super Admin"].includes(me.role)) return;
    el("reactivationCard").style.display = "";
    try {
      const [pending, settings] = await Promise.all([
        S.fetchJson("/api/staff/reactivation-pending"),
        S.fetchJson("/api/staff/access-settings")
      ]);
      const rows = pending.pending || [];
      el("reactivationCount").textContent = `${rows.length} pending`;
      el("reactivationBody").innerHTML = rows.length ? rows.map(row => `
        <tr>
          <td><strong>${S.escape(row.full_name)}</strong><div class="small muted">${S.escape(row.email)}</div></td>
          <td>${S.escape(row.branch_name || "-")}</td>
          <td>${S.escape(row.access_valid_until || "-")}</td>
          <td>${row.access_lapsed_at ? S.formatDateTime(row.access_lapsed_at) : "-"}</td>
          <td>${S.staffBadge(row.is_active)}</td>
          <td><button class="btn btn-green btn-xs" type="button" data-reactivate="${row.id}">Reactivate</button></td>
        </tr>`).join("") : '<tr><td colspan="6"><div class="empty-state">No marketers waiting for reactivation.</div></td></tr>';
      el("reactivationBody").querySelectorAll("[data-reactivate]").forEach(button => {
        button.addEventListener("click", async () => {
          try {
            await S.fetchJson(`/api/staff/${button.getAttribute("data-reactivate")}/reactivate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
            S.toast("Marketer reactivated to the end of this month.");
            await loadReactivation();
            await loadStaff();
          } catch (error) { S.toast(error.message, true); }
        });
      });

      const canSettings = ["Managing Director", "Super Admin"].includes(me.actual_role || me.role);
      const roleSettings = (settings.settings || []).filter(row => row.role_name === "Marketer");
      el("accessSettingsWrap").innerHTML = roleSettings.length ? `
        <div class="card-head" style="padding:0"><h3 style="font-size:14px">Per-role access setting</h3><span class="small muted">${canSettings ? "Owners only" : "Read only"}</span></div>
        ${roleSettings.map(row => `
          <label class="tag" style="display:inline-flex;align-items:center;gap:8px;padding:8px 10px;margin-top:8px">
            <input type="checkbox" data-role-setting="${S.escape(row.role_name)}" ${Number(row.monthly_reactivation_enabled) ? "checked" : ""} ${canSettings ? "" : "disabled"}>
            Monthly reactivation for ${S.escape(row.role_name)}
          </label>`).join("")}` : "";
      el("accessSettingsWrap").querySelectorAll("[data-role-setting]").forEach(input => {
        input.addEventListener("change", async () => {
          try {
            await S.fetchJson("/api/staff/access-settings", {
              method: "PUT", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ role_name: input.getAttribute("data-role-setting"), enabled: input.checked })
            });
            S.toast("Access setting saved.");
          } catch (error) {
            input.checked = !input.checked;
            S.toast(error.message, true);
          }
        });
      });
    } catch (error) {
      el("reactivationCard").style.display = "none";
    }
  }

  async function loadStaff() {
    const params = new URLSearchParams();
    params.set("limit", "100");
    if (el("staffSearch").value.trim()) params.set("q", el("staffSearch").value.trim());
    if (el("staffRoleFilter").value) params.set("role", el("staffRoleFilter").value);
    if (el("staffBranchFilter").value) params.set("branch_id", el("staffBranchFilter").value);
    if (el("staffStatusFilter").value) params.set("status", el("staffStatusFilter").value);
    const data = await S.fetchJson("/api/staff?" + params.toString());
    staff = data.staff || [];
    el("staffCount").textContent = `${data.pagination ? data.pagination.total : staff.length} staff record${(data.pagination ? data.pagination.total : staff.length) === 1 ? "" : "s"}`;
    renderStaff();
  }

  function renderStaff() {
    el("staffBody").innerHTML = staff.length ? staff.map(row => {
      const teamNames = row.team_names || "-";
      return `<tr>
        <td><div class="staff-cell"><span class="staff-avatar">${S.initials(row.full_name)}</span><div><strong>${S.escape(row.full_name)}</strong><div class="small muted">${S.escape(row.email)}${row.phone_number ? " · " + S.escape(row.phone_number) : ""}</div></div></div></td>
        <td>${S.escape(row.role_name)}<div class="small muted">${S.escape(row.job_title || "")}</div></td>
        <td>${S.escape(row.branch_name || "-")}</td>
        <td>${S.escape(teamNames)}</td>
        <td>${S.staffBadge(row.is_active)}</td>
        <td>${row.last_login_at ? S.formatDateTime(row.last_login_at) : "-"}</td>
        <td class="toolbar">
          <button class="btn btn-ghost btn-xs" type="button" data-action="edit-staff" data-id="${row.id}">Edit</button>
          <button class="btn btn-ghost btn-xs" type="button" data-action="staff-activity" data-id="${row.id}">Activity</button>
          <button class="btn ${row.is_active ? "btn-danger" : "btn-green"} btn-xs" type="button" data-action="toggle-staff" data-id="${row.id}" data-active="${row.is_active ? "1" : "0"}">${row.is_active ? "Deactivate" : "Activate"}</button>
        </td>
      </tr>`;
    }).join("") : '<tr><td colspan="7"><div class="empty-state">No staff records.</div></td></tr>';
    el("staffBody").querySelectorAll("[data-action]").forEach(button => {
      button.addEventListener("click", () => staffAction(button.getAttribute("data-action"), Number(button.getAttribute("data-id")), button));
    });
  }

  function renderTeams() {
    el("teamBody").innerHTML = teams.length ? teams.map(team => `
      <tr>
        <td><strong>${S.escape(team.name)}</strong></td>
        <td>${S.escape(team.branch_name || branchName(team.branch_id))}</td>
        <td>${S.escape(team.team_lead_name || "-")}</td>
        <td>${team.member_count || 0}</td>
        <td>${team.is_active ? '<span class="badge badge-green">Active</span>' : '<span class="badge badge-gray">Inactive</span>'}</td>
        <td><button class="btn btn-ghost btn-xs" type="button" data-action="edit-team" data-id="${team.id}">Edit</button></td>
      </tr>`).join("") : '<tr><td colspan="6"><div class="empty-state">No teams yet.</div></td></tr>';
    el("teamBody").querySelectorAll("[data-action='edit-team']").forEach(button => {
      button.addEventListener("click", () => openTeamModal(Number(button.getAttribute("data-id"))));
    });
  }

  async function staffAction(action, id, button) {
    if (action === "edit-staff") return openStaffModal(id);
    if (action === "staff-activity") return openActivity(id);
    if (action === "toggle-staff") {
      const active = button.getAttribute("data-active") === "1";
      if (!confirm(active ? "Deactivate this staff account and invalidate its sessions?" : "Activate this staff account?")) return;
      try {
        await S.fetchJson(`/api/staff/${id}/status`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: !active }) });
        S.toast(active ? "Staff account deactivated." : "Staff account activated.");
        await loadStaff();
      } catch (error) { S.toast(error.message, true); }
    }
  }

  function fillStaffForm(row) {
    el("staffId").value = row ? row.id : "";
    el("staffModalTitle").textContent = row ? "Edit staff account" : "Create staff account";
    el("staffFullName").value = row ? row.full_name : "";
    el("staffEmail").value = row ? row.email : "";
    el("staffPhone").value = row ? (row.phone_number || "") : "";
    el("staffRole").value = row ? row.role_name : roleOptions()[0];
    if (row && row.role_name === "Managing Director") {
      if (![...el("staffBranch").options].some(option => option.value === "")) {
        const companyOption = document.createElement("option");
        companyOption.value = "";
        companyOption.textContent = "Company-wide";
        el("staffBranch").prepend(companyOption);
      }
      el("staffBranch").value = "";
      el("staffBranch").disabled = false;
    } else {
      el("staffBranch").value = row ? row.branch_id : (isMD() ? (branches[0] && branches[0].id) : me.branch_id);
    }
    el("staffJobTitle").value = row ? (row.job_title || "") : "";
    el("staffDateJoined").value = row && row.date_joined ? String(row.date_joined).slice(0, 10) : "";
    el("staffNotes").value = row ? (row.notes || "") : "";
    const canGrantCommission = ["Managing Director", "Super Admin"].includes(me.actual_role || me.role);
    el("staffCommissionAccessGroup").style.display = canGrantCommission ? "" : "none";
    el("staffCommissionAccess").checked = Boolean(row && row.commission_access);
    el("staffCommissionAccess").disabled = !canGrantCommission;
    const canGrantSpecial = ["Managing Director", "Super Admin", "Head Accountant"].includes(me.actual_role || me.role);
    el("staffPlanAccessGroup").style.display = canGrantSpecial ? "" : "none";
    el("staffSmsAccessGroup").style.display = canGrantSpecial ? "" : "none";
    el("staffPlanAccess").checked = Boolean(row && row.property_plans_access);
    el("staffSmsAccess").checked = Boolean(row && row.sms_access);
    el("staffPlanAccess").disabled = !canGrantSpecial;
    el("staffSmsAccess").disabled = !canGrantSpecial;
    const careRole = el("staffRole").value === "Customer Care";
    el("staffCareScopeGroup").style.display = careRole ? "" : "none";
    el("staffCareScope").value = row && row.care_scope ? row.care_scope : "branch";
    const nationalCare = careRole && el("staffCareScope").value === "national";
    el("staffBranch").required = !nationalCare;
    el("staffBranch").disabled = nationalCare;
    if (nationalCare) el("staffBranch").value = "";
    el("staffPasswordGroup").style.display = row ? "none" : "";
    el("staffPassword").required = !row;
    const selectedTeams = row && row.team_ids ? String(row.team_ids).split(",").map(Number) : [];
    const branchId = el("staffBranch").value;
    const branchTeams = teams.filter(t => Number(t.branch_id) === Number(branchId) && t.is_active);
    el("staffTeamsChecks").innerHTML = branchTeams.length ? branchTeams.map(team => `
      <label class="tag" style="cursor:pointer;display:inline-flex;align-items:center;gap:6px;padding:7px 9px">
        <input type="checkbox" value="${team.id}" ${selectedTeams.includes(team.id) ? "checked" : ""}> ${S.escape(team.name)}
      </label>`).join("") : '<span class="small muted">No active teams in this branch.</span>';
  }

  function openStaffModal(id) {
    const row = id ? staff.find(item => Number(item.id) === Number(id)) : null;
    const roleSelect = el("staffRole");
    const options = roleOptions().slice();
    if (row && !options.includes(row.role_name)) options.unshift(row.role_name);
    fillSelect(roleSelect, options.map(role => ({ role })), "role", "role");
    fillStaffForm(row);
    S.openModal("staffModal");
  }

  async function submitStaff(event) {
    event.preventDefault();
    const id = el("staffId").value;
    const body = {
      full_name: el("staffFullName").value.trim(),
      email: el("staffEmail").value.trim(),
      phone_number: el("staffPhone").value.trim(),
      role_name: el("staffRole").value,
      branch_id: el("staffRole").value === "Customer Care" && el("staffCareScope").value === "national"
        ? null : Number(el("staffBranch").value),
      care_scope: el("staffRole").value === "Customer Care" ? el("staffCareScope").value : null,
      job_title: el("staffJobTitle").value.trim(),
      date_joined: el("staffDateJoined").value || null,
      notes: el("staffNotes").value.trim()
    };
    if (!id) body.password = el("staffPassword").value;
    if (["Managing Director", "Super Admin"].includes(me.actual_role || me.role)) {
      body.commission_access = el("staffCommissionAccess").checked;
    }
    if (["Managing Director", "Super Admin", "Head Accountant"].includes(me.actual_role || me.role)) {
      body.property_plans_access = el("staffPlanAccess").checked;
      body.sms_access = el("staffSmsAccess").checked;
    }
    const teamIds = [...el("staffTeamsChecks").querySelectorAll("input[type=checkbox]:checked")].map(input => Number(input.value));
    try {
      let saved;
      if (id) {
        saved = await S.fetchJson(`/api/staff/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      } else {
        saved = await S.fetchJson("/api/staff", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      }
      const staffId = id || saved.id;
      if (staffId) {
        await S.fetchJson(`/api/staff/${staffId}/teams`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ team_ids: teamIds }) });
      }
      S.closeModal("staffModal");
      S.toast(id ? "Staff profile updated." : "Staff account created.");
      await loadStaff();
      await loadTeams();
    } catch (error) { S.toast(error.message, true); }
  }

  async function openActivity(id) {
    try {
      const data = await S.fetchJson(`/api/staff/${id}`);
      el("activityModalTitle").textContent = `Activity — ${data.staff.full_name}`;
      el("activityModalBody").innerHTML = data.activity && data.activity.length ? data.activity.map(row => `
        <div class="activity-item">
          <div class="activity-dot">•</div>
          <div class="activity-main">
            <strong>${S.escape(row.action.replace(/\./g, " · "))}</strong>
            <p>${S.escape(row.target_type || "")} ${row.target_id ? "#" + S.escape(row.target_id) : ""}</p>
            <div class="activity-meta"><span>${S.escape(row.actor_name || "System")}</span><span>${S.formatDateTime(row.created_at)}</span></div>
          </div>
        </div>`).join("") : '<div class="empty-state">No activity recorded.</div>';
      S.openModal("activityModal");
    } catch (error) { S.toast(error.message, true); }
  }

  function teamLeadOptions(branchId) {
    return staff.filter(row => Number(row.branch_id) === Number(branchId) && row.is_active && ["Team Lead", "Branch Manager"].includes(row.role_name));
  }

  function teamMemberOptions(branchId) {
    return staff.filter(row => Number(row.branch_id) === Number(branchId) && row.is_active && row.role_name !== "Managing Director");
  }

  async function openTeamModal(id) {
    let team = id ? teams.find(item => Number(item.id) === Number(id)) : null;
    let members = [];
    if (id) {
      try {
        const detail = await S.fetchJson(`/api/teams/${id}`);
        team = detail.team;
        members = detail.members || [];
      } catch (error) { S.toast(error.message, true); return; }
    }
    el("teamId").value = id || "";
    el("teamModalTitle").textContent = id ? "Edit team" : "Create team";
    el("teamName").value = team ? team.name : "";
    el("teamBranch").value = team ? team.branch_id : (isMD() ? (branches[0] && branches[0].id) : me.branch_id);
    const branchId = el("teamBranch").value;
    fillSelect(el("teamLead"), teamLeadOptions(branchId), "id", "full_name", "Unassigned");
    el("teamLead").value = team ? (team.team_lead_user_id || "") : "";
    el("teamActive").value = team ? String(team.is_active) : "1";
    const memberIds = new Set(members.map(m => Number(m.id)));
    el("teamMembersChecks").innerHTML = teamMemberOptions(branchId).map(row => `
      <label class="tag" style="cursor:pointer;display:inline-flex;align-items:center;gap:6px;padding:7px 9px">
        <input type="checkbox" value="${row.id}" ${memberIds.has(Number(row.id)) ? "checked" : ""}> ${S.escape(row.full_name)} <span class="muted">${S.escape(row.role_name)}</span>
      </label>`).join("");
    S.openModal("teamModal");
  }

  async function submitTeam(event) {
    event.preventDefault();
    const id = el("teamId").value;
    const body = {
      name: el("teamName").value.trim(),
      branch_id: Number(el("teamBranch").value),
      team_lead_user_id: el("teamLead").value ? Number(el("teamLead").value) : null,
      is_active: el("teamActive").value === "1",
      member_ids: [...el("teamMembersChecks").querySelectorAll("input[type=checkbox]:checked")].map(input => Number(input.value))
    };
    try {
      if (id) await S.fetchJson(`/api/teams/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      else await S.fetchJson("/api/teams", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      S.closeModal("teamModal");
      S.toast(id ? "Team updated." : "Team created.");
      await loadTeams();
      await loadStaff();
    } catch (error) { S.toast(error.message, true); }
  }

  function bindTabs() {
    document.querySelectorAll(".tab-btn").forEach(button => {
      button.addEventListener("click", () => {
        document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
        button.classList.add("active");
        const tab = button.getAttribute("data-tab");
        el("staffTab").style.display = tab === "staff" ? "" : "none";
        el("teamsTab").style.display = tab === "teams" ? "" : "none";
      });
    });
  }

  document.addEventListener("DOMContentLoaded", async () => {
    me = await S.initShell("staff");
    if (!me) return;
    if (!["Managing Director", "Branch Manager"].includes(me.role)) {
      window.location.href = "dashboard.html";
      return;
    }
    el("heroMeta").innerHTML = [
      `<span class="scope-badge">${S.escape(me.role)}</span>`,
      `<span class="scope-badge">${S.escape(me.branch_name || "Company-wide")}</span>`
    ].join("");
    await loadBranches();
    await loadTeams();
    await loadStaff();
    await loadReactivation();
    bindTabs();
    fillSelect(el("staffRole"), roleOptions().map(role => ({ role })), "role", "role");
    el("newStaffBtn").addEventListener("click", () => openStaffModal(null));
    el("newTeamBtn").addEventListener("click", () => openTeamModal(null));
    el("applyStaffFilters").addEventListener("click", loadStaff);
    el("staffSearch").addEventListener("keydown", event => { if (event.key === "Enter") loadStaff(); });
    el("staffForm").addEventListener("submit", submitStaff);
    el("teamForm").addEventListener("submit", submitTeam);
    el("teamBranch").addEventListener("change", () => {
      const branchId = el("teamBranch").value;
      fillSelect(el("teamLead"), teamLeadOptions(branchId), "id", "full_name", "Unassigned");
      el("teamMembersChecks").innerHTML = teamMemberOptions(branchId).map(row => `
        <label class="tag" style="cursor:pointer;display:inline-flex;align-items:center;gap:6px;padding:7px 9px">
          <input type="checkbox" value="${row.id}"> ${S.escape(row.full_name)} <span class="muted">${S.escape(row.role_name)}</span>
        </label>`).join("");
    });
    el("staffRole").addEventListener("change", () => {
      const careRole = el("staffRole").value === "Customer Care";
      el("staffCareScopeGroup").style.display = careRole ? "" : "none";
      const nationalCare = careRole && el("staffCareScope").value === "national";
      el("staffBranch").required = !nationalCare;
      el("staffBranch").disabled = nationalCare;
      if (nationalCare) el("staffBranch").value = "";
    });
    el("staffCareScope").addEventListener("change", () => {
      const nationalCare = el("staffCareScope").value === "national";
      el("staffBranch").required = !nationalCare;
      el("staffBranch").disabled = nationalCare;
      if (nationalCare) el("staffBranch").value = "";
      else if (!el("staffBranch").value) el("staffBranch").value = me.branch_id || (branches[0] && branches[0].id) || "";
    });
    el("staffBranch").addEventListener("change", () => {
      const branchId = el("staffBranch").value;
      const branchTeams = teams.filter(t => Number(t.branch_id) === Number(branchId) && t.is_active);
      el("staffTeamsChecks").innerHTML = branchTeams.length ? branchTeams.map(team => `
        <label class="tag" style="cursor:pointer;display:inline-flex;align-items:center;gap:6px;padding:7px 9px">
          <input type="checkbox" value="${team.id}"> ${S.escape(team.name)}
        </label>`).join("") : '<span class="small muted">No active teams in this branch.</span>';
    });
  });
})();
