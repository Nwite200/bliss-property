(function () {
  const S = window.BlissStaff;
  let me = null;
  let roles = [];
  let allPermissions = [];
  let clientPage = 1;
  let adminClientTotal = 0;
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

  async function loadCommissionFailures() {
    try {
      const data = await S.fetchJson("/api/admin/commission-failures");
      el("commissionFailureCount").textContent = `${data.total || 0} unresolved`;
      el("commissionFailureBody").innerHTML = (data.failures || []).length ? data.failures.map(row => `
        <tr>
          <td><strong>${S.escape(row.transaction_ref || row.payment_id)}</strong><div class="small muted">${S.money(row.amount_kobo || 0)}</div></td>
          <td>${S.escape(row.client_name || "-")}<div class="small muted">${S.escape(row.client_reference || "")}</div></td>
          <td>${S.escape(row.branch_name || "-")}</td>
          <td>${row.attempts || 0}</td>
          <td class="small">${S.escape(row.last_error || "-")}</td>
          <td>${row.next_retry_at ? S.formatDateTime(row.next_retry_at) : "-"}</td>
        </tr>`).join("") : '<tr><td colspan="6"><div class="empty-state">No unresolved commission failures.</div></td></tr>';
    } catch (error) {
      el("commissionFailureCount").textContent = "Unavailable";
      el("commissionFailureBody").innerHTML = '<tr><td colspan="6">Unable to load commission failures.</td></tr>';
    }
  }

  async function loadCommissionBackfill() {
    try {
      const data = await S.fetchJson("/api/admin/commission-backfill");
      el("commissionBackfillMeta").textContent = `${data.missing_count || 0} verified payment(s) without commission — dry run only, no writes.`;
      el("commissionBackfillWrap").style.display = "";
      el("commissionBackfillBody").innerHTML = (data.payments || []).length ? data.payments.map(row => `
        <tr><td>${S.escape(row.transaction_ref)}</td><td>${S.escape(row.client_name)} (${S.escape(row.client_reference)})</td><td>${S.money(row.amount_kobo)}</td><td>${S.formatDateTime(row.verified_at)}</td></tr>`).join("") : '<tr><td colspan="4"><div class="empty-state">No missing commissions.</div></td></tr>';
    } catch (error) { S.toast(error.message || "Unable to load backfill preview", true); }
  }

  async function loadAdminClientBranches() {
    try {
      const data = await S.fetchJson("/api/branches");
      el("adminClientBranch").innerHTML = '<option value="">All branches</option>' + (data.branches || []).map(branch => `<option value="${branch.id}">${S.escape(branch.name)}</option>`).join("");
    } catch { /* optional */ }
  }

  async function loadAdminClients() {
    const params = new URLSearchParams();
    params.set("page", String(clientPage));
    params.set("limit", "25");
    if (el("adminClientSearch").value.trim()) params.set("q", el("adminClientSearch").value.trim());
    if (el("adminClientKyc").value) params.set("kyc_status", el("adminClientKyc").value);
    if (el("adminClientBranch").value) params.set("branch_id", el("adminClientBranch").value);
    try {
      const data = await S.fetchJson("/api/admin/clients?" + params.toString());
      const clients = data.clients || [];
      adminClientTotal = data.pagination ? data.pagination.total : clients.length;
      el("adminClientCount").textContent = `${adminClientTotal} client record${adminClientTotal === 1 ? "" : "s"}`;
      const pages = Math.max(1, Math.ceil(adminClientTotal / 25));
      el("adminClientPageLabel").textContent = `Page ${clientPage} of ${pages}`;
      el("adminClientPrev").disabled = clientPage <= 1;
      el("adminClientNext").disabled = clientPage >= pages;
      el("adminClientBody").innerHTML = clients.length ? clients.map(row => {
        const address = [row.residential_address, row.city, row.state].filter(Boolean).join(", ") || "-";
        const nextOfKin = [row.next_of_kin_name, row.next_of_kin_relationship, row.next_of_kin_phone].filter(Boolean).join(" · ");
        const plan = row.payment_plan_type
          ? `${String(row.payment_plan_type).replace(/_/g, " ")}${row.payment_plan_duration_months !== null && row.payment_plan_duration_months !== undefined ? ` · ${row.payment_plan_duration_months} month(s)` : ""}`
          : "Not set";
        const planTotal = row.payment_plan_total_kobo ? S.money(row.payment_plan_total_kobo) : "";
        const kycTone = row.kyc_status === "verified" ? "green" : row.kyc_status === "rejected" ? "red" : "amber";
        const referral = row.referred_by_name
          ? `${row.referred_by_name} (${row.referred_by_code || row.referral_code_used || "no code"})`
          : (row.referral_code_used || "Direct");
        const terms = row.terms_version_no
          ? `v${row.terms_version_no}${row.terms_accepted_at ? `<div class="small muted">${S.formatDateTime(row.terms_accepted_at)}</div>` : ""}`
          : '<span class="badge badge-red">Not recorded</span>';
        return `<tr>
          <td>
            <strong>${S.escape(row.full_name || "-")}</strong>
            <div class="small muted">${S.escape(row.client_reference || "")}</div>
            <div class="small">${S.escape(row.phone_number || "-")}${row.alternate_phone ? " · " + S.escape(row.alternate_phone) : ""}</div>
            <div class="small muted">${S.escape(row.email_address || "-")}</div>
          </td>
          <td class="small">${S.escape(address)}${nextOfKin ? `<div class="small muted">NOK: ${S.escape(nextOfKin)}</div>` : ""}</td>
          <td>${S.escape(row.branch_name || "-")}</td>
          <td class="small">
            ${row.identity_type ? `<strong>${S.escape(row.identity_type)}</strong><div>${S.escape(row.identity_number_masked || "-")}</div>` : '<span class="small muted">Not supplied</span>'}
            ${row.bvn_last4 ? `<div class="small muted">BVN •••••••${S.escape(row.bvn_last4)}</div>` : ""}
            <div style="margin-top:4px">${S.badge(row.kyc_status || "pending", kycTone)}</div>
            <div class="small muted">Verification: ${S.escape(row.verification_status || "unverified")}</div>
          </td>
          <td class="small">${S.escape(referral)}</td>
          <td class="small"><strong>${S.escape(plan)}</strong>${planTotal ? `<div class="small muted">${S.escape(row.property_title || "")} · ${planTotal}</div>` : ""}</td>
          <td class="small">${terms}</td>
          <td>${S.badge(row.status || "Prospect", row.status === "Cancelled" || row.status === "Inactive" ? "red" : "green")}</td>
          <td><a class="btn btn-ghost btn-xs" href="client-detail.html?id=${row.id}">Open</a></td>
        </tr>`;
      }).join("") : '<tr><td colspan="9"><div class="empty-state">No client records match the filters.</div></td></tr>';
    } catch (error) {
      el("adminClientCount").textContent = "Unavailable";
      el("adminClientBody").innerHTML = `<tr><td colspan="9"><div class="empty-state">${S.escape(error.message)}</div></td></tr>`;
    }
  }

  async function loadTerms() {
    const data = await S.fetchJson("/api/admin/terms");
    const active = data.active;
    const versions = data.versions || [];
    if (active) {
      el("termsTitle").value = active.title || "";
      el("termsBody").value = active.body_text || "";
      el("termsActiveMeta").textContent = `Active version ${active.version_no}${active.created_at ? " · " + S.formatDateTime(active.created_at) : ""}`;
    } else {
      el("termsActiveMeta").textContent = "No active terms version";
    }
    el("termsHistoryBody").innerHTML = versions.length ? versions.map(version => `
      <tr>
        <td><strong>v${version.version_no}</strong></td>
        <td>${S.escape(version.title || "-")}</td>
        <td>${version.document_filename ? `<a class="small" href="/api/terms/document/${version.id}" target="_blank" rel="noopener">${S.escape(version.document_filename)}</a>` : '<span class="small muted">Text only</span>'}</td>
        <td>${Number(version.acceptance_count || 0)}</td>
        <td class="nowrap">${S.formatDateTime(version.created_at)}</td>
        <td>${version.is_active ? S.badge("Active", "green") : S.badge("Superseded", "gray")}</td>
        <td>${version.is_active ? "" : `<button class="btn btn-ghost btn-xs" type="button" data-activate-terms="${version.id}">Activate</button>`}</td>
      </tr>`).join("") : '<tr><td colspan="7"><div class="empty-state">No terms versions yet.</div></td></tr>';
    el("termsHistoryBody").querySelectorAll("[data-activate-terms]").forEach(button => {
      button.addEventListener("click", async () => {
        if (!confirm("Make this terms version active on the signup page?")) return;
        try {
          await S.fetchJson(`/api/admin/terms/${button.getAttribute("data-activate-terms")}/activate`, {
            method: "POST", headers: { "Content-Type": "application/json" }, body: "{}"
          });
          S.toast("Terms version activated.");
          await loadTerms();
        } catch (error) { S.toast(error.message, true); }
      });
    });
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
      await loadCommissionFailures();
      await loadAdminClientBranches();
      await loadAdminClients();
      await loadTerms();
    } catch (error) {
      S.toast(error.message || "Unable to load system administration", true);
    }

    el("loadCommissionBackfill").addEventListener("click", loadCommissionBackfill);

    el("adminClientApply").addEventListener("click", () => { clientPage = 1; loadAdminClients(); });
    el("adminClientReset").addEventListener("click", () => {
      el("adminClientSearch").value = "";
      el("adminClientKyc").value = "";
      el("adminClientBranch").value = "";
      clientPage = 1;
      loadAdminClients();
    });
    el("adminClientPrev").addEventListener("click", () => { if (clientPage > 1) { clientPage--; loadAdminClients(); } });
    el("adminClientNext").addEventListener("click", () => { clientPage++; loadAdminClients(); });

    el("saveTermsBtn").addEventListener("click", async () => {
      const msg = el("termsMsg");
      const title = el("termsTitle").value.trim();
      const bodyText = el("termsBody").value.trim();
      const file = el("termsFile").files[0];
      msg.textContent = "";
      if (!title) { msg.textContent = "Enter a title for the terms."; return; }
      if (!bodyText && !file) { msg.textContent = "Enter the terms text or upload a PDF."; return; }
      el("saveTermsBtn").disabled = true;
      msg.textContent = "Publishing…";
      try {
        let result;
        if (file) {
          const form = new FormData();
          form.append("title", title);
          form.append("body_text", bodyText);
          form.append("file", file);
          const res = await fetch("/api/admin/terms", { method: "POST", credentials: "include", body: form });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || "Unable to publish the terms version");
          result = data;
        } else {
          result = await S.fetchJson("/api/admin/terms", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title, body_text: bodyText })
          });
        }
        msg.textContent = `Version ${result.version_no} published.`;
        S.toast(`Terms version ${result.version_no} published.`);
        el("termsFile").value = "";
        await loadTerms();
      } catch (error) {
        msg.textContent = error.message || "Unable to publish the terms version.";
      } finally {
        el("saveTermsBtn").disabled = false;
      }
    });

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
