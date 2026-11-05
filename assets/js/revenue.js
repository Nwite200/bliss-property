(function () {
  const S = window.BlissStaff;
  let me = null;
  let filters = {};
  const el = id => document.getElementById(id);

  function dateValue(date) { return date.toISOString().slice(0, 10); }
  function today() { return dateValue(new Date()); }
  function weekStart() {
    const now = new Date();
    const day = now.getDay();
    const diff = (day + 6) % 7;
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - diff);
    return dateValue(start);
  }
  function monthStart() {
    const now = new Date();
    return dateValue(new Date(now.getFullYear(), now.getMonth(), 1));
  }

  function readFilters() {
    const params = S.query();
    filters = {
      from: params.get("from") || today(),
      to: params.get("to") || today(),
      branch_id: params.get("branch_id") || "",
      team_lead_id: params.get("team_lead_id") || "",
      staff_id: params.get("staff_id") || ""
    };
    el("revFrom").value = filters.from;
    el("revTo").value = filters.to;
  }

  function writeFilters() {
    const params = new URLSearchParams();
    params.set("from", filters.from);
    params.set("to", filters.to);
    for (const key of ["branch_id", "team_lead_id", "staff_id"]) {
      if (filters[key]) params.set(key, filters[key]);
    }
    history.replaceState(null, "", "revenue.html?" + params.toString());
  }

  function queryString() {
    const params = new URLSearchParams();
    params.set("from", filters.from);
    params.set("to", filters.to);
    for (const key of ["branch_id", "team_lead_id", "staff_id"]) {
      if (filters[key]) params.set(key, filters[key]);
    }
    return params.toString();
  }

  function breadcrumbHtml(items) {
    return (items || []).map((item, index) => {
      const label = S.escape(item.label);
      const separator = index ? "<span>›</span>" : "";
      return `${separator}<button type="button" data-crumb="${index}">${label}</button>`;
    }).join("");
  }

  function typeLabel(type) {
    return ({ branch: "Branch", team_lead: "Team Lead", staff: "Staff", unassigned: "Unassigned" })[type] || "Group";
  }

  async function load() {
    writeFilters();
    const query = queryString();
    el("revChildren").innerHTML = '<div class="empty-state">Loading breakdown…</div>';
    el("revPayments").innerHTML = '<tr><td colspan="7">Loading…</td></tr>';
    try {
      const [overview, payments] = await Promise.all([
        S.fetchJson("/api/revenue/overview?" + query),
        S.fetchJson("/api/revenue/payments?" + query)
      ]);
      el("revTotal").textContent = S.money(overview.total_kobo);
      el("revScopeLabel").textContent = levelLabel(overview.level);
      el("revMeta").textContent = `${overview.payment_count} verified payment(s) · ${S.formatDate(overview.from)} – ${S.formatDate(overview.to)}`;
      el("revBreadcrumbs").innerHTML = breadcrumbHtml(overview.breadcrumb);
      el("revBreadcrumbs").querySelectorAll("[data-crumb]").forEach(button => {
        button.addEventListener("click", () => {
          const item = overview.breadcrumb[Number(button.getAttribute("data-crumb"))];
          filters.branch_id = item.params.branch_id || "";
          filters.team_lead_id = item.params.team_lead_id || "";
          filters.staff_id = item.params.staff_id || "";
          load();
        });
      });
      el("revChildrenTitle").textContent = overview.level === "staff" ? "Payments" : "Breakdown";
      el("revChildrenMeta").textContent = overview.children.length
        ? `${overview.children.length} child group(s) · ${S.money(overview.children_total_kobo)}${overview.reconciles ? "" : " · reconciliation warning"}`
        : "No child groups at this level.";
      el("revChildren").innerHTML = overview.children.length ? overview.children.map((child, index) => `
        <button type="button" class="revenue-child" data-child="${index}" ${child.type === "unassigned" ? "disabled" : ""}>
          <div class="type">${S.escape(typeLabel(child.type))}</div>
          <div class="name">${S.escape(child.name)}</div>
          <div class="amount">${S.money(child.total_kobo)}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:4px">${child.payment_count} payment(s)</div>
        </button>`).join("") : '<div class="empty-state">No payments in this period.</div>';
      el("revChildren").querySelectorAll("[data-child]").forEach(button => {
        button.addEventListener("click", () => {
          const child = overview.children[Number(button.getAttribute("data-child"))];
          if (!child || child.type === "unassigned") return;
          filters.branch_id = child.params.branch_id || "";
          filters.team_lead_id = child.params.team_lead_id || "";
          filters.staff_id = child.params.staff_id || "";
          load();
        });
      });
      el("revPaymentCount").textContent = `${payments.pagination.total} payment(s)`;
      el("revPayments").innerHTML = payments.payments.length ? payments.payments.map(row => `
        <tr>
          <td><strong>${S.escape(row.client_name)}</strong><div class="small muted">${S.escape(row.client_reference)}</div></td>
          <td class="nowrap"><strong>${S.money(row.amount_kobo)}</strong></td>
          <td>${S.escape(row.staff_name || "Unassigned")}</td>
          <td>${S.escape(row.team_lead_name || "Direct")}</td>
          <td>${S.escape(row.branch_name || "-")}</td>
          <td class="nowrap">${S.escape(row.transaction_ref)}</td>
          <td class="nowrap">${S.formatDateTime(row.verified_at)}</td>
        </tr>`).join("") : '<tr><td colspan="7"><div class="empty-state">No payments in this period.</div></td></tr>';
    } catch (error) {
      S.toast(error.message || "Unable to load revenue", true);
      el("revChildren").innerHTML = '<div class="empty-state">Unable to load breakdown.</div>';
      el("revPayments").innerHTML = '<tr><td colspan="7">Unable to load payments.</td></tr>';
    }
  }

  function levelLabel(level) {
    return ({ company: "Total paid — National", branch: "Total paid — Branch", team_lead: "Total paid — Team", staff: "Total paid — Staff" })[level] || "Total paid";
  }

  document.addEventListener("DOMContentLoaded", async () => {
    me = await S.initShell("revenue");
    if (!me) return;
    readFilters();
    el("revApply").addEventListener("click", () => {
      filters.from = el("revFrom").value || today();
      filters.to = el("revTo").value || today();
      filters.branch_id = filters.team_lead_id = filters.staff_id = "";
      load();
    });
    document.querySelectorAll("[data-period]").forEach(button => {
      button.addEventListener("click", () => {
        const period = button.getAttribute("data-period");
        filters.to = today();
        filters.from = period === "today" ? today() : period === "week" ? weekStart() : monthStart();
        filters.branch_id = filters.team_lead_id = filters.staff_id = "";
        load();
      });
    });
    await load();
  });
})();
