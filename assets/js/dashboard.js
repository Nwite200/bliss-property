(function () {
  const S = window.BlissStaff;
  let me = null;
  let dashboard = null;

  function el(id) { return document.getElementById(id); }
  function money(kobo) { return S.money(kobo); }
  function naira(value) { return S.moneyNaira(value); }
  function kpi(label, value, meta, className) {
    return `<div class="kpi ${className || ""}"><div class="label">${S.escape(label)}</div><div class="value">${value}</div><div class="delta">${S.escape(meta || "")}</div></div>`;
  }

  function roleCopy(role) {
    if (role === "Managing Director") return ["Company-wide command centre", "Company-wide property, client, sales, collection and team performance."];
    if (role === "Branch Manager") return ["Branch command centre", "Authorised branch inventory, clients, marketers, teams and collections."];
    if (role === "Team Lead") return ["Team performance centre", "Your team's clients, property assignments, leads and conversion performance."];
    if (role === "Marketer") return ["Personal sales centre", "Your clients, leads, follow-ups, conversions and verified payment performance."];
    return ["Finance overview", "Company-wide contract value, verified collections and outstanding balances."];
  }

  async function loadBranches() {
    try {
      const data = await S.fetchJson("/api/branches");
      const select = el("branchFilter");
      (data.branches || []).forEach(branch => {
        const option = document.createElement("option");
        option.value = branch.id;
        option.textContent = branch.name;
        select.appendChild(option);
      });
    } catch { /* optional */ }
  }

  function setDefaults() {
    el("fromDate").value = S.daysAgo(29);
    el("toDate").value = S.today();
    el("granularity").value = "day";
  }

  function queryString() {
    const params = new URLSearchParams();
    params.set("from", el("fromDate").value || S.daysAgo(29));
    params.set("to", el("toDate").value || S.today());
    params.set("granularity", el("granularity").value || "day");
    const branch = el("branchFilter").value;
    if (branch) params.set("branch_id", branch);
    return params.toString();
  }

  async function loadRevenueToday() {
    try {
      const params = new URLSearchParams();
      params.set("from", S.today());
      params.set("to", S.today());
      if (el("branchFilter") && el("branchFilter").value) params.set("branch_id", el("branchFilter").value);
      const data = await S.fetchJson("/api/revenue/overview?" + params.toString());
      el("revenueTodayTotal").textContent = S.money(data.total_kobo || 0);
      el("revenueTodayMeta").textContent = `${data.payment_count || 0} verified payment(s) · ${data.reconciles === false ? "check roll-up" : "reconciled"}`;
    } catch (error) {
      el("revenueTodayTotal").textContent = "₦0";
      el("revenueTodayMeta").textContent = "No verified payments today";
    }
  }

  async function loadDefaulting() {
    try {
      const params = new URLSearchParams();
      params.set("status", "defaulting");
      params.set("limit", "1");
      if (el("branchFilter") && el("branchFilter").value) params.set("branch_id", el("branchFilter").value);
      const data = await S.fetchJson("/api/defaulting-clients?" + params.toString());
      const summary = data.summary || {};
      el("defaultingTotal").textContent = String(summary.defaulting || 0);
      el("defaultingMeta").textContent = `${S.money(summary.amount_behind_kobo || 0)} behind across ${summary.total || 0} client plan(s)`;
    } catch (error) {
      el("defaultingTotal").textContent = "0";
      el("defaultingMeta").textContent = "No defaulting clients in your scope";
    }
  }

  async function loadSmsBalance() {
    const card = el("smsBalanceCard");
    if (!card || !me.sms_access) return;
    card.style.display = "flex";
    try {
      const data = await S.fetchJson("/api/sms/overview");
      el("smsBalanceTotal").textContent = data.balance === null
        ? "Not available"
        : `${data.balance_currency} ${Number(data.balance).toLocaleString()}`;
      el("smsBalanceMeta").textContent = data.low_credit
        ? `Low credit — threshold ${data.balance_currency} ${Number(data.low_credit_threshold).toLocaleString()}`
        : `${data.provider} · ${data.enabled ? "SMS enabled" : "SMS disabled globally"}`;
    } catch {
      card.style.display = "none";
    }
  }

  async function load() {
    try {
      dashboard = await S.fetchJson("/api/dashboard?" + queryString());
      render();
      await Promise.all([loadRevenueToday(), loadDefaulting(), loadSmsBalance()]);
    } catch (error) {
      S.toast(error.message || "Unable to load dashboard", true);
    }
  }

  function renderHeader() {
    const [title, subtitle] = roleCopy(me.role);
    el("roleTitle").textContent = title;
    el("roleSubtitle").textContent = subtitle;
    const meta = [];
    meta.push(`<span class="scope-badge">${S.escape(me.role)}</span>`);
    if (["Managing Director", "Finance Officer"].includes(me.role)) {
      meta.push(`<span class="scope-badge">🏢 Company-wide</span>`);
    } else if (me.branch_name) {
      meta.push(`<span class="scope-badge">🏢 ${S.escape(me.branch_name)}</span>`);
    }
    if (me.team_names) meta.push(`<span class="scope-badge">👥 ${S.escape(me.team_names)}</span>`);
    meta.push(`<span class="scope-badge">📅 ${S.formatDate(dashboard.range.from)} – ${S.formatDate(dashboard.range.to)}</span>`);
    el("heroMeta").innerHTML = meta.join("");
    const actions = [
      `<a class="btn btn-outline-white" href="performance.html">Performance analytics</a>`
    ];
    if (["Managing Director", "Branch Manager", "Team Lead", "Marketer"].includes(me.role)) {
      actions.push(`<a class="btn btn-green" href="leads.html">Open lead pipeline</a>`);
    }
    if (["Managing Director", "Branch Manager"].includes(me.role)) {
      actions.push(`<a class="btn btn-outline-white" href="staff-management.html">Staff & teams</a>`);
    }
    if (["Managing Director", "Finance Officer", "Branch Manager"].includes(me.role)) {
      actions.push(`<a class="btn btn-outline-white" href="finance-dashboard.html">Finance ledger</a>`);
    }
    el("heroActions").innerHTML = actions.join("");
    el("branchFilterGroup").style.display = ["Managing Director", "Finance Officer"].includes(me.role) ? "" : "none";
  }

  function renderSummary() {
    const s = dashboard.summary;
    const f = s.financials;
    const cards = [];
    if (["Managing Director", "Branch Manager"].includes(me.role)) {
      cards.push(kpi("Total properties", s.properties.total, `${s.properties.published} published`));
      cards.push(kpi("Reserved", s.properties.reserved, `${s.properties.sold} sold · ${s.properties.unavailable} unavailable`));
      cards.push(kpi("Total clients", s.clients.total, `${s.clients.active} active buyers`));
      cards.push(kpi("Active staff", s.staff.total, `${s.staff.marketers} marketers · ${s.staff.team_leads} team leads`));
      cards.push(kpi("Contract sales value", money(f.contract_sales_value_kobo), "Agreed contract value", "kpi-money"));
      cards.push(kpi("Verified payments", money(f.verified_payments_kobo), "Only verified NGN payments", "kpi-money"));
      cards.push(kpi("Outstanding balances", money(f.outstanding_balances_kobo), "Contract value less verified cash", "kpi-money"));
      cards.push(kpi("Leads", s.leads.total, `${s.leads.open} open · ${s.leads.converted} converted`));
      cards.push(kpi("Lead conversion", `${s.leads.conversion_rate}%`, `${s.leads.follow_ups_due} follow-ups due`));
      cards.push(kpi("Published listings", s.properties.published, `${s.properties.available} available`));
    } else if (me.role === "Finance Officer") {
      cards.push(kpi("Contract sales value", money(f.contract_sales_value_kobo), "Agreed contract value", "kpi-money"));
      cards.push(kpi("Verified collections", money(f.verified_payments_kobo), "Verified successful NGN payments only", "kpi-money"));
      cards.push(kpi("Outstanding balances", money(f.outstanding_balances_kobo), "Contract value less verified cash", "kpi-money"));
      cards.push(kpi("Clients with contracts", s.clients.total, `${s.clients.active} active buyers`));
      cards.push(kpi("Properties in ledger", s.properties.total, `${s.properties.published} published`));
    } else if (me.role === "Team Lead") {
      cards.push(kpi("Team clients", s.clients.total, `${s.clients.active} active buyers`));
      cards.push(kpi("Assigned properties", s.properties.total, `${s.properties.reserved} reserved`));
      cards.push(kpi("Contract value", money(f.contract_sales_value_kobo), "Team client contracts", "kpi-money"));
      cards.push(kpi("Verified collections", money(f.verified_payments_kobo), "Only verified NGN payments", "kpi-money"));
      cards.push(kpi("Outstanding", money(f.outstanding_balances_kobo), "Contract less verified", "kpi-money"));
      cards.push(kpi("Team leads", s.leads.total, `${s.leads.open} open leads`));
      cards.push(kpi("Lead conversion", `${s.leads.conversion_rate}%`, `${s.leads.converted} converted`));
      cards.push(kpi("Follow-ups due", s.leads.follow_ups_due, "Needs attention"));
    } else if (me.role === "Marketer") {
      cards.push(kpi("My clients", s.clients.total, `${s.clients.active} active buyers`));
      cards.push(kpi("Assigned properties", s.properties.total, `${s.properties.published} published`));
      cards.push(kpi("Contract value", money(f.contract_sales_value_kobo), "My client contracts", "kpi-money"));
      cards.push(kpi("Verified collections", money(f.verified_payments_kobo), "Verified NGN payments only", "kpi-money"));
      cards.push(kpi("Outstanding", money(f.outstanding_balances_kobo), "Contract less verified", "kpi-money"));
      cards.push(kpi("My leads", s.leads.total, `${s.leads.open} open leads`));
      cards.push(kpi("Conversions", s.leads.converted, `${s.leads.conversion_rate}% conversion`));
      cards.push(kpi("Follow-ups due", s.leads.follow_ups_due, "Scheduled or overdue"));
    } else {
      cards.push(kpi("Total properties", s.properties.total, `${s.properties.published} published`));
      cards.push(kpi("Total clients", s.clients.total, `${s.clients.active} active buyers`));
      cards.push(kpi("Contract sales value", money(f.contract_sales_value_kobo), "Agreed contract value", "kpi-money"));
      cards.push(kpi("Verified payments", money(f.verified_payments_kobo), "Only verified NGN payments", "kpi-money"));
      cards.push(kpi("Outstanding balances", money(f.outstanding_balances_kobo), "Contract less verified", "kpi-money"));
      cards.push(kpi("Active staff", s.staff.total, `${s.staff.marketers} marketers`));
    }
    el("summaryKpis").innerHTML = cards.join("");
  }

  function renderPeriod() {
    const p = dashboard.period;
    const cards = [
      kpi("New clients", p.new_clients, "In selected period"),
      kpi("New contract value", money(p.contract_value_kobo), "Clients created in period", "kpi-money"),
      kpi("Verified in period", money(p.verified_kobo), `${p.verified_count} payments`, "kpi-money")
    ];
    if (me.role !== "Finance Officer") {
      cards.push(kpi("Leads generated", p.leads_generated, `Conversion ${p.conversion_rate}%`));
      cards.push(kpi("Conversions", p.conversions, "Lead conversions in period"));
    }
    el("periodKpis").innerHTML = cards.join("");
  }

  function shortPeriod(period) {
    const value = String(period || "");
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value.slice(5);
    if (/^\d{4}-\d{2}$/.test(value)) return value;
    return value;
  }

  function renderCommission() {
    const summary = dashboard.commission_summary || {};
    const rows = dashboard.recent_commissions || [];
    const title = me.role === 'Marketer' ? 'My commission' : me.role === 'Team Lead' ? 'Team commission' : me.role === 'Branch Manager' ? 'Branch commission' : 'Commission overview';
    el('commissionCardTitle').textContent = title;
    el('commissionKpis').innerHTML = [
      ['Earned', summary.earned_kobo],
      ['Awaiting approval', summary.pending_approval_kobo],
      ['Approved', summary.approved_kobo],
      ['Paid', summary.paid_kobo],
      ['Outstanding', summary.outstanding_kobo]
    ].map(([label, value]) => `<div class="kpi"><div class="label">${label}</div><div class="value">${money(value || 0)}</div></div>`).join('');
    el('commissionTableBody').innerHTML = rows.length ? rows.map(row => `
      <tr>
        <td><strong>${S.escape(row.commission_ref)}</strong><div class="small muted">${S.escape(row.recipient_role || '')}</div></td>
        <td>${S.escape(row.client_name || '-')}<div class="small muted">${S.escape(row.client_reference || '')}</div></td>
        <td>${S.escape(row.plan_name || '-')}</td>
        <td class="nowrap">${money(row.commission_kobo)}</td>
        <td class="nowrap">${money(row.paid_kobo)}</td>
        <td class="nowrap">${money(row.outstanding_kobo)}</td>
        <td>${S.badge(row.status, S.statusTone(row.status))}</td>
      </tr>`).join('') : '<tr><td colspan="7"><div class="empty-state">No commission entries in this scope.</div></td></tr>';
  }

  function renderTrend() {
    const trends = dashboard.trends || [];
    el("trendRangeLabel").textContent = `${S.formatDate(dashboard.range.from)} – ${S.formatDate(dashboard.range.to)} · ${dashboard.range.granularity}`;
    if (!trends.length) {
      el("trendChart").innerHTML = '<div class="empty-state">No trend data for this period.</div>';
      return;
    }
    const moneyMax = Math.max(1, ...trends.map(t => Math.max(Number(t.contract_value || 0), Number(t.verified_kobo || 0))));
    const countMax = Math.max(1, ...trends.map(t => Math.max(Number(t.leads || 0), Number(t.conversions || 0))));
    el("trendChart").innerHTML = trends.map(t => {
      const contractH = Math.max(2, (Number(t.contract_value || 0) / moneyMax) * 100);
      const verifiedH = Math.max(2, (Number(t.verified_kobo || 0) / moneyMax) * 100);
      const leadsH = Math.max(2, (Number(t.leads || 0) / countMax) * 100);
      const conversionsH = Math.max(2, (Number(t.conversions || 0) / countMax) * 100);
      return `<div class="bar-column" title="${S.escape(t.period)} — contract ${money(t.contract_value)}, verified ${money(t.verified_kobo)}, leads ${t.leads}, conversions ${t.conversions}">
        <div class="bar-stack">
          <div class="bar contract" style="height:${contractH}%"></div>
          <div class="bar verified" style="height:${verifiedH}%"></div>
          ${me.role === "Finance Officer" ? "" : `<div class="bar" style="height:${leadsH}%;background:#F0C34B"></div><div class="bar" style="height:${conversionsH}%;background:#414141"></div>`}
        </div>
        <div class="bar-label">${S.escape(shortPeriod(t.period))}</div>
      </div>`;
    }).join("");
  }

  function renderPipeline() {
    if (me.role === "Finance Officer") {
      el("pipelineCard").style.display = "none";
      return;
    }
    const stages = ["New Lead", "Contacted", "Interested", "Inspection Scheduled", "Negotiation", "Converted", "Lost"];
    el("leadPipeline").innerHTML = stages.map(stage => {
      const count = dashboard.lead_pipeline ? Number(dashboard.lead_pipeline[stage] || 0) : 0;
      const cls = stage === "Converted" ? "converted" : stage === "Lost" ? "lost" : "";
      return `<div class="pipeline-stage ${cls}"><div class="stage-name">${S.escape(stage)}</div><div class="stage-count">${count}</div></div>`;
    }).join("");
  }

  function renderBranchTable() {
    const card = el("branchComparisonCard");
    const rows = dashboard.branch_comparison || [];
    if (!rows.length) { card.style.display = "none"; return; }
    card.style.display = "";
    el("branchTableBody").innerHTML = rows.map(row => `
      <tr>
        <td><strong>${S.escape(row.branch_name)}</strong></td>
        <td>${row.properties}<div class="small muted">${row.published_properties} published</div></td>
        <td>${row.clients}<div class="small muted">${row.active_clients} active</div></td>
        <td class="nowrap">${money(row.contract_value_kobo)}</td>
        <td class="nowrap">${money(row.verified_kobo)}</td>
        <td class="nowrap">${money(row.outstanding_kobo)}</td>
      </tr>`).join("");
  }

  function renderMarketerRankings() {
    const rows = dashboard.marketer_rankings || [];
    el("marketerRankings").innerHTML = rows.length ? rows.map((row, index) => `
      <div class="rank-row">
        <div class="rank-badge">${index + 1}</div>
        <div class="rank-main">
          <strong>${S.escape(row.full_name)}</strong>
          <span>${S.escape(row.branch_name || "-")} · ${row.clients_count} clients · ${row.converted_count}/${row.leads_count} converted</span>
        </div>
        <div class="rank-amount">${money(row.verified_kobo)}<div class="small muted">${money(row.contract_value_kobo)} contract</div></div>
      </div>`).join("") : '<div class="empty-state">No marketer performance in this scope.</div>';
  }

  function renderTeamTable() {
    const rows = dashboard.team_rankings || [];
    el("teamRankingCard").style.display = rows.length ? "" : "none";
    el("teamTableBody").innerHTML = rows.map(row => `
      <tr>
        <td><strong>${S.escape(row.team_name)}</strong><div class="small muted">${S.escape(row.branch_name || "-")}</div></td>
        <td>${S.escape(row.team_lead_name || "-")}</td>
        <td>${row.member_count}</td>
        <td>${row.clients_count}</td>
        <td class="nowrap">${money(row.contract_value_kobo)}</td>
        <td class="nowrap">${money(row.verified_kobo)}</td>
        <td>${row.conversion_rate}%</td>
      </tr>`).join("");
  }

  function renderFollowUps() {
    if (me.role === "Finance Officer") {
      el("followUpsCard").style.display = "none";
      return;
    }
    const rows = dashboard.due_follow_ups || [];
    el("dueFollowUps").innerHTML = rows.length ? rows.map(row => `
      <div class="mini-item">
        <div class="mini-icon">⏰</div>
        <div class="mini-main">
          <strong>${S.escape(row.full_name)}</strong>
          <span>${S.escape(row.lead_reference)} · ${S.escape(row.status)} · due ${S.formatDate(row.next_follow_up_date)}</span>
        </div>
        <a class="btn btn-ghost btn-xs" href="leads.html?lead=${row.id}">Open</a>
      </div>`).join("") : '<div class="empty-state">No follow-ups due.</div>';
  }

  function renderClients() {
    const rows = dashboard.assigned_clients || [];
    const title = me.role === "Marketer" ? "My assigned clients" : me.role === "Team Lead" ? "Team client portfolio" : "Recent clients";
    el("clientsCardTitle").textContent = title;
    el("clientsTableBody").innerHTML = rows.length ? rows.map(row => `
      <tr>
        <td><a href="client-detail.html?id=${row.id}"><strong>${S.escape(row.full_name)}</strong></a><div class="small muted">${S.escape(row.client_reference)}</div></td>
        <td>${S.badge(row.status, S.statusTone(row.status))}</td>
        <td class="nowrap">${row.agreed_purchase_price ? naira(row.agreed_purchase_price) : "-"}</td>
        <td>${S.escape(row.branch_name || "-")}</td>
      </tr>`).join("") : '<tr><td colspan="4"><div class="empty-state">No clients in this scope.</div></td></tr>';
  }

  function renderProperties() {
    const rows = dashboard.assigned_properties || [];
    const title = me.role === "Marketer" ? "My property assignments" : me.role === "Team Lead" ? "Team property assignments" : "Recent properties";
    el("propertiesCardTitle").textContent = title;
    el("propertiesList").innerHTML = rows.length ? rows.map(row => `
      <div class="mini-item">
        <div class="mini-icon">🏡</div>
        <div class="mini-main">
          <strong>${S.escape(row.title)}</strong>
          <span>${S.escape(row.reference)} · ${S.escape(row.branch_name || "-")} · ${S.escape(row.status)}</span>
        </div>
        <a class="btn btn-ghost btn-xs" href="property-details.html?id=${row.id}">View</a>
      </div>`).join("") : '<div class="empty-state">No property assignments.</div>';
  }

  function renderTeamMembers() {
    const card = el("teamMembersCard");
    const rows = dashboard.team_members || [];
    if (me.role !== "Team Lead" || !rows.length) { card.style.display = "none"; return; }
    card.style.display = "";
    el("teamMembersBody").innerHTML = rows.map(row => `
      <tr>
        <td><div class="staff-cell"><span class="staff-avatar">${S.initials(row.full_name)}</span><div><strong>${S.escape(row.full_name)}</strong><div class="small muted">${S.escape(row.email)}</div></div></div></td>
        <td>${S.escape(row.role_name)}</td>
        <td>${S.escape(row.branch_name || "-")}</td>
        <td>${S.staffBadge(row.is_active)}</td>
      </tr>`).join("");
  }

  function renderReferral() {
    const card = el("referralCard");
    const input = el("referralLinkInput");
    if (!card || !input) return;
    if (!me.referral_link) { card.style.display = "none"; return; }
    card.style.display = "";
    input.value = me.referral_link;
    el("referralCodeText").textContent = `Referral code: ${me.referral_code || "-"}`;
    const copyBtn = el("copyReferralBtn");
    copyBtn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(me.referral_link);
      } catch {
        input.select();
        document.execCommand("copy");
      }
      S.toast("Referral link copied.");
    };
    const copyCodeBtn = el("copyReferralCodeBtn");
    if (copyCodeBtn) {
      copyCodeBtn.onclick = async () => {
        try { await navigator.clipboard.writeText(me.referral_code || ""); }
        catch { /* clipboard may be unavailable */ }
        S.toast("Referral code copied.");
      };
    }
    const share = el("shareReferralBtn");
    share.href = "https://wa.me/?text=" + encodeURIComponent(`Buy property with Bliss Legacy through my referral link: ${me.referral_link}`);
  }

  function renderProfile() {
    const rows = [
      ["Staff", me.full_name],
      ["Email", me.email],
      ["Role", me.role],
      ["Actual role", me.actual_role || me.role],
      ["Branch", me.branch_name || "-"],
      ["Team", me.team_names || "-"],
      ["Referral code", me.referral_code || "-"],
      ["Referral link", me.referral_link || "-"],
      ["Phone", me.phone_number || "-"],
      ["Job title", me.job_title || "-"],
      ["Last login", me.last_login_at ? S.formatDateTime(me.last_login_at) : "-"]
    ];
    el("profileBody").innerHTML = `
      <div class="role-profile-card mb-16">
        <span class="staff-avatar">${S.initials(me.full_name)}</span>
        <div><strong>${S.escape(me.full_name)}</strong><div class="small muted">${S.escape(me.role)}${me.branch_name ? " · " + S.escape(me.branch_name) : ""}</div></div>
      </div>
      <table class="table">${rows.slice(1).map(([label, value]) => `<tr><td class="muted">${label}</td><td>${S.escape(value || "-")}</td></tr>`).join("")}</table>`;
  }

  function renderActivity() {
    const rows = dashboard.recent_activities || [];
    el("recentActivity").innerHTML = rows.length ? rows.map(row => `
      <div class="activity-item">
        <div class="activity-dot">•</div>
        <div class="activity-main">
          <strong>${S.escape(row.action.replace(/\./g, " · "))}</strong>
          <p>${S.escape(row.target_type || "")} ${row.target_id ? "#" + S.escape(row.target_id) : ""}${row.metadata && row.metadata.reason ? " · " + S.escape(row.metadata.reason) : ""}</p>
          <div class="activity-meta"><span>${S.escape(row.actor_name || "System")}</span><span>${S.escape(row.branch_name || "Company-wide")}</span><span>${S.formatDateTime(row.created_at)}</span></div>
        </div>
      </div>`).join("") : '<div class="empty-state">No recent activity.</div>';
  }

  function render() {
    renderHeader();
    renderSummary();
    renderPeriod();
    renderCommission();
    renderTrend();
    renderPipeline();
    renderBranchTable();
    renderMarketerRankings();
    renderTeamTable();
    renderFollowUps();
    renderClients();
    renderProperties();
    renderTeamMembers();
    renderReferral();
    renderProfile();
    renderActivity();
  }

  document.addEventListener("DOMContentLoaded", async () => {
    me = await S.initShell("dashboard");
    if (!me) return;
    if (me.role === "Customer Care") {
      window.location.href = "customer-care.html";
      return;
    }
    setDefaults();
    if (["Managing Director", "Finance Officer"].includes(me.role)) await loadBranches();
    el("applyFilters").addEventListener("click", load);
    el("resetFilters").addEventListener("click", () => { setDefaults(); el("branchFilter").value = ""; load(); });
    await load();
  });
})();
