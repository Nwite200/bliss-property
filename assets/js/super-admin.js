(function () {
  const S = window.BlissStaff;
  let me = null;
  let roles = [];
  let allPermissions = [];
  const el = id => document.getElementById(id);

  function renderPermissions(role) {
    const selected = new Set(role ? role.permissions : []);
    el("permissionGrid").innerHTML = allPermissions.map(permission => `
      <label style="display:flex;align-items:center;gap:8px;border:1px solid var(--line);border-radius:8px;padding:10px;font-size:12px">
        <input type="checkbox" value="${S.escape(permission)}" ${selected.has(permission) ? "checked" : ""}>
        <span>${S.escape(permission)}</span>
      </label>
    `).join("");
  }

  async function load() {
    me = await S.initShell("super-admin");
    if (!me) return;
    if (!["Super Admin", "Managing Director"].includes(me.actual_role || me.role)) {
      document.querySelector("main").innerHTML = "<div class='card'><h2>Access restricted</h2><p>System Administration is available only to Super Admin and Managing Director accounts.</p></div>";
      return;
    }
    el("adminRoleBadge").textContent = me.actual_role || me.role;
    try {
      const [overview, roleData, audit] = await Promise.all([
        S.fetchJson("/api/admin/overview"),
        S.fetchJson("/api/admin/roles"),
        S.fetchJson("/api/admin/audit?limit=100")
      ]);
      roles = roleData.roles || [];
      allPermissions = roleData.permissions || [];
      el("roleCount").textContent = roles.length;
      el("staffCount").textContent = overview.staff_count;
      el("clientCount").textContent = overview.client_count;
      el("auditCount").textContent = overview.audit_count;
      el("roleSelect").innerHTML = roles.map(role => `<option value="${role.id}">${S.escape(role.name)}</option>`).join("");
      const firstEditable = roles.find(role => role.name !== "Super Admin");
      el("roleSelect").value = firstEditable ? firstEditable.id : (roles[0] && roles[0].id);
      renderPermissions(roles.find(role => String(role.id) === el("roleSelect").value));
      el("adminAuditBody").innerHTML = (audit.audit || []).map(row => `
        <tr>
          <td class="nowrap">${S.formatDateTime(row.created_at)}</td>
          <td>${S.escape(row.actor_name || "System")}</td>
          <td><strong>${S.escape(row.action)}</strong></td>
          <td>${S.escape(row.target_type || "-")} ${row.target_id ? "#" + S.escape(row.target_id) : ""}</td>
          <td>${S.escape(row.branch_name || "Company-wide")}</td>
        </tr>`).join("") || '<tr><td colspan="5">No audit records.</td></tr>';
    } catch (error) {
      S.toast(error.message || "Unable to load system administration", true);
    }

    el("roleSelect").addEventListener("change", () => {
      renderPermissions(roles.find(role => String(role.id) === el("roleSelect").value));
    });

    el("savePermissionsBtn").addEventListener("click", async () => {
      const msg = el("permissionMsg");
      const roleId = Number(el("roleSelect").value);
      const role = roles.find(r => r.id === roleId);
      if (!role) return;
      if (role.name === "Super Admin") {
        msg.textContent = "The Super Admin role is protected.";
        return;
      }
      const selected = [...el("permissionGrid").querySelectorAll("input[type=checkbox]:checked")].map(input => input.value);
      msg.textContent = "Saving…";
      try {
        await S.fetchJson(`/api/admin/roles/${roleId}/permissions`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ permission_names: selected })
        });
        role.permissions = selected;
        msg.textContent = "Permissions saved.";
        S.toast("Permissions saved");
      } catch (error) {
        msg.textContent = error.message || "Unable to save permissions.";
      }
    });
  }

  document.addEventListener("DOMContentLoaded", load);
})();
