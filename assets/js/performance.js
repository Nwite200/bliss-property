(function () {
  const S = window.BlissStaff;
  let me = null;
  let analytics = null;

  const el = id => document.getElementById(id);
  const money = kobo => S.money(kobo);
  const kpi = (label, value, meta) => `<div class="kpi"><div class="label">${S.escape(label)}</div><div class="value">${value}</div><div class="delta">${S.escape(meta || "")}</div></div>`;

  function roleScopeLabel() {
    if (me.role === "Managing Director" || me.role === "Finance Officer") return el("branchFilter").value ? el("branchFilter").selectedOptions[0].textContent : "Company-wide";
    if (me.role === "Branch Manager") return me.branch_name || "Branch";
    if (me.role === "Team Lead") return me.team_names || "Team";
    return "Personal portfolio";
  }

  async function loadBranches() {
    try {
      const data = await S.fetchJson("/api/branches");
      (data.branches || []).forEach(branch => {
        const option = document.createElement("option");
        option.value = branch.id;
        option.textContent = branch.name;
        el("branchFilter").appendChild(option);
      });
    } catch { /* optional */ }
  }

  function setDefaults() {
    el("fromDate").value = S.daysAgo(29);
    el("toDate").value = S.today();
    el("granularity").value = "day";
  }

  async function loadCategories() {
    try {
      const data = await S.fetchJson('/api/property-categories');
      el('categoryFilter').innerHTML = '<option value="">All categories</option>' + (data.categories || []).map(c => `<option value="${c.id}">${S.escape(c.name)}</option>`).join('');
    } catch { /* optional */ }
  }

  function query() {
    const params = new URLSearchParams();
    params.set("from", el("fromDate").value || S.daysAgo(29));
    params.set("to", el("toDate").value || S.today());
    params.set("granularity", el("granularity").value || "day");
    if (el("branchFilter").value) params.set("branch_id", el("branchFilter").value);
    if (el("categoryFilter").value) params.set("property_category_id", el("categoryFilter").value);
    return params.toString();
  }

  async function load() {
    try {
      analytics = await S.fetchJson("/api/analytics/performance?" + query());
      render();
    } catch (error) {
      S.toast(error.message || "Unable to load analytics", true);
    }
  }

  function renderHeader() {
    el("heroMeta").innerHTML = [
      `<span class="scope-badge">${S.escape(me.role)}</span>`,
      `<span class="scope-badge">${S.escape(roleScopeLabel())}</span>`,
      `<span class="scope-badge">${S.formatDate(analytics.range.from)} – ${S.formatDate(analytics.range.to)}</span>`
    ].join("");
    el("branchFilterGroup").style.display = ["Managing Director", "Finance Officer"].includes(me.role) ? "" : "none";
  }

  function renderSummary() {
    const s = analytics.summary;
    const cards = [
      kpi("Contract sales value", money(s.financials.contract_sales_value_kobo), "Agreed contracts, live clients only"),
      kpi("Verified collections", money(s.financials.verified_payments_kobo), "Verified successful NGN payments only"),
      kpi("Outstanding balances", money(s.financials.outstanding_balances_kobo), "Contract value less verified cash")
    ];
    if (me.role !== "Finance Officer") {
      cards.push(kpi("Live leads", s.leads.total, `${s.leads.open} open · ${s.leads.converted} converted`));
      cards.push(kpi("Lead conversion", `${s.leads.conversion_rate}%`, "Converted / total live leads"));
      cards.push(kpi("Follow-ups due", s.leads.follow_ups_due, "Scheduled or overdue"));
    }
    el("summaryKpis").innerHTML = cards.join("");
    const p = analytics.period;
    const periodCards = [
      kpi("New clients", p.new_clients, "In selected period"),
      kpi("New contract value", money(p.contract_value_kobo), "Clients created in period"),
      kpi("Verified in period", money(p.verified_kobo), `${p.verified_count} verified payments`)
    ];
    if (me.role !== "Finance Officer") {
      periodCards.push(kpi("Leads generated", p.leads_generated, "In selected period"));
      periodCards.push(kpi("Conversions", p.conversions, `${p.conversion_rate}% conversion`));
    }
    el("periodKpis").innerHTML = periodCards.join("");

    const commissions = s.commissions || {};
    el("commissionKpis").innerHTML = [
      kpi("Commission earned", money(commissions.earned_kobo), "Scoped commission entries"),
      kpi("Awaiting approval", money(commissions.pending_approval_kobo), "Pending approval"),
      kpi("Commission approved", money(commissions.approved_kobo), "Approved entries"),
      kpi("Commission paid", money(commissions.paid_kobo), "Commission payments made"),
      kpi("Commission outstanding", money(commissions.outstanding_kobo), "Approved/paid liability")
    ].join("");
  }

  function renderCategoryRefunds() {
    const categories = analytics.property_category_sales || [];
    el("categoryBody").innerHTML = categories.length ? categories.map(row => `
      <tr><td>${S.escape(row.category_name)}</td><td>${row.clients}</td><td class="nowrap">${money(row.contract_value_kobo)}</td><td class="nowrap">${money(row.verified_kobo)}</td></tr>
    `).join("") : '<tr><td colspan="4"><div class="empty-state">No category sales in this period.</div></td></tr>';
    const refunds = analytics.refund_summary || [];
    el("refundBody").innerHTML = refunds.length ? refunds.map(row => `
      <tr><td>${S.escape(row.adjustment_type)}</td><td>${row.count}</td><td class="nowrap">${money(row.amount_kobo)}</td></tr>
    `).join("") : '<tr><td colspan="3"><div class="empty-state">No refunds or reversals in this period.</div></td></tr>';
  }

  function shortPeriod(period) {
    const value = String(period || "");
    return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.slice(5) : value;
  }

  function renderTrend() {
    const trends = analytics.trends || [];
    el("trendRangeLabel").textContent = `${S.formatDate(analytics.range.from)} – ${S.formatDate(analytics.range.to)} · ${analytics.range.granularity}`;
    if (!trends.length) {
      el("trendChart").innerHTML = '<div class="empty-state">No trend data for this period.</div>';
      return;
    }
    const moneyMax = Math.max(1, ...trends.map(t => Math.max(Number(t.contract_value || 0), Number(t.verified_kobo || 0))));
    const countMax = Math.max(1, ...trends.map(t => Math.max(Number(t.leads || 0), Number(t.conversions || 0))));
    el("trendChart").innerHTML = trends.map(t => {
      const contractH = Math.max(2, Number(t.contract_value || 0) / moneyMax * 100);
      const verifiedH = Math.max(2, Number(t.verified_kobo || 0) / moneyMax * 100);
      const leadsH = Math.max(2, Number(t.leads || 0) / countMax * 100);
      const conversionsH = Math.max(2, Number(t.conversions || 0) / countMax * 100);
      return `<div class="bar-column" title="${S.escape(t.period)} — contract ${money(t.contract_value)}, verified ${money(t.verified_kobo)}, leads ${t.leads}, conversions ${t.conversions}">
        <div class="bar-stack">
          <div class="bar contract" style="height:${contractH}%"></div>
          <div class="bar verified" style="height:${verifiedH}%"></div>
          <div class="bar" style="height:${leadsH}%;background:#F0C34B"></div>
          <div class="bar" style="height:${conversionsH}%;background:#414141"></div>
        </div>
        <div class="bar-label">${S.escape(shortPeriod(t.period))}</div>
      </div>`;
    }).join("");
  }

  function renderFunnel() {
    if (me.role === "Finance Officer") {
      el("funnelCard").style.display = "none";
      return;
    }
    const stages = ["New Lead", "Contacted", "Interested", "Inspection Scheduled", "Negotiation", "Converted", "Lost"];
    el("leadFunnel").innerHTML = stages.map(stage => {
      const count = Number((analytics.lead_pipeline || {})[stage] || 0);
      const cls = stage === "Converted" ? "converted" : stage === "Lost" ? "lost" : "";
      return `<div class="pipeline-stage ${cls}"><div class="stage-name">${stage}</div><div class="stage-count">${count}</div></div>`;
    }).join("");
  }

  function renderBranches() {
    const rows = analytics.branch_comparison || [];
    el("branchCard").style.display = rows.length ? "" : "none";
    el("branchBody").innerHTML = rows.length ? rows.map(row => `
      <tr>
        <td><strong>${S.escape(row.branch_name)}</strong></td>
        <td>${row.properties}<div class="small muted">${row.published_properties} published</div></td>
        <td>${row.clients}</td>
        <td>${row.leads}</td>
        <td>${row.conversions}</td>
        <td class="nowrap">${money(row.contract_value_kobo)}</td>
        <td class="nowrap">${money(row.verified_kobo)}</td>
        <td class="nowrap">${money(row.outstanding_kobo)}</td>
        <td>${row.conversion_rate}%</td>
      </tr>`).join("") : "";
  }

  function renderMarketers() {
    const rows = analytics.marketer_rankings || [];
    el("marketerBody").innerHTML = rows.length ? rows.map((row, index) => `
      <tr>
        <td><strong>${index + 1}</strong></td>
        <td>${S.escape(row.full_name)}</td>
        <td>${S.escape(row.branch_name || "-")}</td>
        <td>${row.clients_count}</td>
        <td>${row.leads_count}</td>
        <td>${row.converted_count}</td>
        <td class="nowrap">${money(row.contract_value_kobo)}</td>
        <td class="nowrap">${money(row.verified_kobo)}</td>
        <td>${row.conversion_rate}%</td>
      </tr>`).join("") : '<tr><td colspan="9"><div class="empty-state">No marketer data in this scope.</div></td></tr>';
  }

  function renderTeams() {
    const rows = analytics.team_rankings || [];
    el("teamCard").style.display = rows.length ? "" : "none";
    el("teamBody").innerHTML = rows.length ? rows.map((row, index) => `
      <tr>
        <td><strong>${index + 1}</strong></td>
        <td>${S.escape(row.team_name)}<div class="small muted">${S.escape(row.branch_name || "-")}</div></td>
        <td>${S.escape(row.team_lead_name || "-")}</td>
        <td>${row.member_count}</td>
        <td>${row.clients_count}</td>
        <td>${row.leads_count}</td>
        <td>${row.converted_count}</td>
        <td class="nowrap">${money(row.contract_value_kobo)}</td>
        <td class="nowrap">${money(row.verified_kobo)}</td>
        <td>${row.conversion_rate}%</td>
      </tr>`).join("") : "";
  }

  function render() {
    renderHeader();
    renderSummary();
    renderTrend();
    renderFunnel();
    renderBranches();
    renderMarketers();
    renderTeams();
    renderCategoryRefunds();
  }

  function exportCsv() {
    if (!analytics) return;
    const rows = [];
    rows.push(["Metric", "Value"]);
    rows.push(["Scope", roleScopeLabel()]);
    rows.push(["From", analytics.range.from]);
    rows.push(["To", analytics.range.to]);
    rows.push(["Contract sales value (kobo)", analytics.summary.financials.contract_sales_value_kobo]);
    rows.push(["Verified collections (kobo)", analytics.summary.financials.verified_payments_kobo]);
    rows.push(["Outstanding balances (kobo)", analytics.summary.financials.outstanding_balances_kobo]);
    rows.push(["Live leads", analytics.summary.leads.total]);
    rows.push(["Lead conversion %", analytics.summary.leads.conversion_rate]);
    rows.push([]);
    rows.push(["Branch", "Properties", "Clients", "Leads", "Conversions", "Contract kobo", "Verified kobo", "Outstanding kobo"]);
    (analytics.branch_comparison || []).forEach(row => rows.push([row.branch_name, row.properties, row.clients, row.leads, row.conversions, row.contract_value_kobo, row.verified_kobo, row.outstanding_kobo]));
    rows.push([]);
    rows.push(["Marketer", "Branch", "Clients", "Leads", "Converted", "Contract kobo", "Verified kobo"]);
    (analytics.marketer_rankings || []).forEach(row => rows.push([row.full_name, row.branch_name, row.clients_count, row.leads_count, row.converted_count, row.contract_value_kobo, row.verified_kobo]));
    const csv = rows.map(row => row.map(cell => `"${String(cell === undefined || cell === null ? "" : cell).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `bliss-performance-${analytics.range.from}-to-${analytics.range.to}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  document.addEventListener("DOMContentLoaded", async () => {
    me = await S.initShell("performance");
    if (!me) return;
    setDefaults();
    await loadCategories();
    if (["Managing Director", "Finance Officer"].includes(me.role)) await loadBranches();
    el("applyFilters").addEventListener("click", load);
    el("resetFilters").addEventListener("click", () => { setDefaults(); el("branchFilter").value = ""; el("categoryFilter").value = ""; load(); });
    el("exportCsv").addEventListener("click", exportCsv);
    await load();
  });
})();
