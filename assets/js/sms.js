(function () {
  const S = window.BlissStaff;
  let me = null;
  let page = 1;
  let total = 0;
  const limit = 20;
  let templates = [];
  const el = id => document.getElementById(id);

  function statusTone(status) {
    return ({ sent: "green", delivered: "green", failed: "red", opted_out: "amber", skipped: "gray", queued: "blue" })[status] || "gray";
  }

  function queryParams() {
    const p = new URLSearchParams();
    p.set("page", String(page));
    p.set("limit", String(limit));
    if (el("smsStatusFilter").value) p.set("status", el("smsStatusFilter").value);
    if (el("smsTemplateFilter").value) p.set("template_key", el("smsTemplateFilter").value);
    if (el("smsFrom").value) p.set("from", el("smsFrom").value);
    if (el("smsTo").value) p.set("to", el("smsTo").value);
    return p;
  }

  async function loadOverview() {
    const data = await S.fetchJson("/api/sms/overview");
    el("smsMeta").innerHTML = [
      `<span class="scope-badge">${S.escape(me.role)}</span>`,
      `<span class="scope-badge">${data.enabled ? "SMS on" : "SMS off"}</span>`,
      `<span class="scope-badge">${S.escape(data.provider)}${data.provider_ready ? "" : " · credentials missing"}</span>`
    ].join("");
    el("smsKpis").innerHTML = [
      ["Queued", data.counts.queued || 0],
      ["Sent / delivered", (data.counts.sent || 0) + (data.counts.delivered || 0)],
      ["Failed", data.counts.failed || 0],
      ["Opted out", data.counts.opted_out || 0],
      ["Provider credit", data.balance === null ? "Not available" : `${data.balance_currency} ${Number(data.balance).toLocaleString()}`]
    ].map(([label, value]) => `<div class="kpi"><div class="kpi-label">${S.escape(label)}</div><div class="kpi-value">${typeof value === "number" ? value : S.escape(value)}</div></div>`).join("");
    el("smsProviderState").textContent = `${data.provider} · ${data.provider_ready ? "credentials detected" : "credentials not detected"}`;
    el("smsEnabled").value = data.enabled ? "1" : "0";
    el("smsProvider").value = data.provider;
    el("smsSenderId").value = data.sender_id || "";
    el("smsThreshold").value = data.low_credit_threshold || 0;
    el("smsReminders").value = data.reminders_enabled ? "1" : "0";
    el("smsReminderDays").value = data.reminder_days || 0;
    el("smsDefaulting").value = data.defaulting_reminders_enabled ? "1" : "0";
    el("smsDefaultingDays").value = data.defaulting_frequency_days || 1;
    el("smsStatementDay").value = data.statement_day || 1;
  }

  async function loadLog() {
    const data = await S.fetchJson("/api/sms/messages?" + queryParams().toString());
    const rows = data.messages || [];
    total = data.pagination ? data.pagination.total : rows.length;
    el("smsLogCount").textContent = `${total} message${total === 1 ? "" : "s"}`;
    const pages = Math.max(1, Math.ceil(total / limit));
    el("smsPageLabel").textContent = `Page ${page} of ${pages}`;
    el("smsPrev").disabled = page <= 1;
    el("smsNext").disabled = page >= pages;
    el("smsLogBody").innerHTML = rows.length ? rows.map(row => `
      <tr>
        <td>${row.client_name ? `<strong>${S.escape(row.client_name)}</strong><div class="small muted">${S.escape(row.client_reference || "")}</div>` : '<span class="small muted">Test / no client</span>'}</td>
        <td>${S.escape(row.phone_e164)}</td>
        <td>${S.escape(row.template_key || "-")}</td>
        <td style="max-width:320px;font-size:12px">${S.escape(row.body)}${row.error ? `<div style="color:#B91C1C">${S.escape(row.error)}</div>` : ""}</td>
        <td>${S.badge(row.status, statusTone(row.status))}</td>
        <td>${S.escape(row.provider || "-")}<div class="small muted">${S.escape(row.provider_message_id || "")}</div></td>
        <td>${row.provider_cost_kobo ? S.money(row.provider_cost_kobo) : "-"}</td>
        <td>${row.sent_at ? S.formatDateTime(row.sent_at) : S.formatDateTime(row.queued_at)}</td>
      </tr>`).join("") : '<tr><td colspan="8"><div class="empty-state">No SMS messages in this scope.</div></td></tr>';
  }

  async function loadTemplates() {
    const data = await S.fetchJson("/api/sms/templates");
    templates = data.templates || [];
    el("smsTemplateFilter").innerHTML = '<option value="">All templates</option>' + templates.map(t => `<option value="${t.template_key}">${S.escape(t.name)}</option>`).join("");
    el("smsTemplateList").innerHTML = templates.map(t => `
      <div class="card" style="box-shadow:none;margin-bottom:12px">
        <div class="card-head"><h3>${S.escape(t.name)}</h3><div class="toolbar">${S.badge(t.language.toUpperCase(), "blue")}${t.is_active ? S.badge("Active", "green") : S.badge("Inactive", "gray")}<button class="btn btn-ghost btn-xs" type="button" data-edit-template="${t.template_key}">Edit</button></div></div>
        <p style="font-size:13px;margin:8px 0 0">${S.escape(t.body)}</p>
        <div class="small muted" style="margin-top:4px">${S.escape(t.template_key)}</div>
      </div>`).join("");
    el("smsTemplateList").querySelectorAll("[data-edit-template]").forEach(btn => {
      btn.addEventListener("click", () => openTemplate(btn.getAttribute("data-edit-template")));
    });
  }

  function openTemplate(key) {
    const t = templates.find(item => item.template_key === key);
    if (!t) return;
    el("smsTemplateKey").value = t.template_key;
    el("smsTemplateTitle").textContent = `Edit: ${t.name}`;
    el("smsTemplateName").value = t.name;
    el("smsTemplateLanguage").value = t.language || "en";
    el("smsTemplateActive").value = String(t.is_active);
    el("smsTemplateBody").value = t.body;
    S.openModal("smsTemplateModal");
  }

  function bindTabs() {
    document.querySelectorAll(".tab-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        const tab = btn.getAttribute("data-tab");
        el("logTab").style.display = tab === "log" ? "" : "none";
        el("templatesTab").style.display = tab === "templates" ? "" : "none";
        el("settingsTab").style.display = tab === "settings" ? "" : "none";
      });
    });
  }

  document.addEventListener("DOMContentLoaded", async () => {
    me = await S.initShell("sms");
    if (!me) return;
    if (!me.sms_access) {
      S.toast("SMS centre access is required.", true);
      window.location.href = "dashboard.html";
      return;
    }
    bindTabs();
    await loadOverview();
    await loadTemplates();
    await loadLog();
    el("smsApplyFilters").addEventListener("click", () => { page = 1; loadLog(); });
    el("smsResetFilters").addEventListener("click", () => {
      el("smsStatusFilter").value = ""; el("smsTemplateFilter").value = ""; el("smsFrom").value = ""; el("smsTo").value = "";
      page = 1; loadLog();
    });
    el("smsPrev").addEventListener("click", () => { if (page > 1) { page--; loadLog(); } });
    el("smsNext").addEventListener("click", () => { page++; loadLog(); });
    el("smsRefreshBalance").addEventListener("click", async () => {
      try {
        const result = await S.fetchJson("/api/sms/refresh-balance", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
        S.toast(`Provider balance: ${result.currency} ${Number(result.balance).toLocaleString()}`);
        await loadOverview();
      } catch (error) { S.toast(error.message, true); }
    });
    el("smsSendTestBtn").addEventListener("click", () => S.openModal("smsTestModal"));
    el("smsTestForm").addEventListener("submit", async event => {
      event.preventDefault();
      try {
        const result = await S.fetchJson("/api/sms/test", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone_number: el("smsTestPhone").value.trim(), body: el("smsTestBody").value.trim() })
        });
        S.toast(result.skipped ? `Not sent: ${result.reason}` : "Test SMS queued");
        S.closeModal("smsTestModal");
        await loadLog();
      } catch (error) { S.toast(error.message, true); }
    });
    el("smsSettingsForm").addEventListener("submit", async event => {
      event.preventDefault();
      try {
        await S.fetchJson("/api/sms/settings", {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sms_enabled: el("smsEnabled").value === "1",
            sms_provider: el("smsProvider").value,
            sms_sender_id: el("smsSenderId").value.trim(),
            sms_low_credit_threshold: Number(el("smsThreshold").value || 0),
            sms_reminders_enabled: el("smsReminders").value === "1",
            sms_reminder_days: Number(el("smsReminderDays").value || 0),
            sms_defaulting_reminders_enabled: el("smsDefaulting").value === "1",
            sms_defaulting_frequency_days: Number(el("smsDefaultingDays").value || 1),
            sms_statement_day: Number(el("smsStatementDay").value || 1)
          })
        });
        S.toast("SMS controls saved");
        await loadOverview();
      } catch (error) { S.toast(error.message, true); }
    });
    el("smsTemplateForm").addEventListener("submit", async event => {
      event.preventDefault();
      const key = el("smsTemplateKey").value;
      try {
        await S.fetchJson(`/api/sms/templates/${key}`, {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: el("smsTemplateName").value.trim(),
            body: el("smsTemplateBody").value.trim(),
            language: el("smsTemplateLanguage").value,
            is_active: el("smsTemplateActive").value === "1"
          })
        });
        S.closeModal("smsTemplateModal");
        S.toast("Template saved");
        await loadTemplates();
      } catch (error) { S.toast(error.message, true); }
    });
  });
})();
