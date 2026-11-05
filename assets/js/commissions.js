(function () {
  const S = window.BlissStaff;
  let me = null;
  let options = { categories: [], branches: [], teams: [], roles: [], sale_types: [], bases: [], statuses: [] };
  let plans = [];
  let entries = [];
  let page = 1;
  let total = 0;
  let currentEntry = null;
  const canManage = () => me && ["Managing Director", "Super Admin", "Head Accountant"].includes(me.actual_role || me.role);
  const hasCommissionAccess = () => me && me.can_access_commissions === true;
  const canViewCommission = () => hasCommissionAccess() || ["Marketer", "Team Lead", "Project Manager", "Branch Manager"].includes(me && (me.actual_role || me.role));

  function commissionableLabel(plan) {
    if (plan.commissionable_mode === 'first_months') return `First ${Number(plan.commissionable_first_months || 2)} month(s) only`;
    if (plan.commissionable_mode === 'percentage') return `${(Number(plan.commissionable_percent_bps || 0) / 100).toFixed(2)}% of each payment`;
    if (plan.commissionable_mode === 'capped_amount') return `Up to ${S.money(plan.commissionable_cap_kobo || 0)} per sale`;
    return '100% of each payment';
  }

  const el = id => document.getElementById(id);
  const money = kobo => S.money(kobo);

  function optionHtml(items, valueKey, labelKey, selected, blank) {
    return (blank ? `<option value="">${blank}</option>` : "") + items.map(item => {
      const value = item[valueKey];
      const label = item[labelKey];
      return `<option value="${value}" ${String(value) === String(selected) ? "selected" : ""}>${S.escape(label)}</option>`;
    }).join("");
  }

  async function loadOptions() {
    if (!canManage()) {
      const statuses = ['Draft', 'Calculated', 'Pending Approval', 'Approved', 'Partially Paid', 'Paid', 'Rejected', 'Reversed', 'Cancelled'];
      el('entryStatusFilter').innerHTML = '<option value="">All statuses</option>' + statuses.map(s => `<option>${s}</option>`).join('');
      el('entryBranchFilter').style.display = 'none';
      el('entryMarketerFilter').style.display = 'none';
      el('entryPlanFilter').style.display = 'none';
      return;
    }
    options = await S.fetchJson('/api/commission-options');
    el('entryStatusFilter').innerHTML = '<option value="">All statuses</option>' + options.statuses.map(s => `<option>${s}</option>`).join('');
    el('entryBranchFilter').innerHTML = optionHtml(options.branches, 'id', 'name', '', 'All branches');
    el('planBasis').innerHTML = options.bases.map(b => `<option value="${b}">${b === 'contract_value' ? 'Contract value' : b === 'verified_collections' ? 'Verified collections' : 'Fixed amount'}</option>`).join('');
    el('entryMarketerFilter').innerHTML = '<option value="">All marketers</option>';
    if (canManage() || me.role === 'Branch Manager') {
      try {
        const staff = await S.fetchJson('/api/users?role=Marketer');
        el('entryMarketerFilter').innerHTML = '<option value="">All marketers</option>' + (staff.users || []).map(u => `<option value="${u.id}">${S.escape(u.full_name)}</option>`).join('');
      } catch { /* optional */ }
    }
    if (!canManage()) {
      el('entryBranchFilter').style.display = 'none';
      el('entryMarketerFilter').style.display = 'none';
    }
    if (!canManage()) {
      el('entryPlanFilter').style.display = 'none';
    }
  }

  async function loadPlans() {
    if (!canManage()) return;
    try {
      const data = await S.fetchJson('/api/commission-plans');
      plans = data.plans || [];
      el('planBody').innerHTML = plans.length ? plans.map(plan => `
        <tr>
          <td><strong>${S.escape(plan.name)}</strong><div class="small muted">${S.escape(plan.description || '')}</div></td>
          <td>${S.badge(plan.calculation_basis, 'blue')}</td>
          <td>${commissionableLabel(plan)}</td>
          <td>v${Number(plan.current_version_no || 1)}</td>
          <td>${plan.rule_count || (plan.rules || []).filter(r => r.is_active).length}</td>
          <td>${plan.effective_from ? S.formatDate(plan.effective_from) : 'Any'} – ${plan.effective_to ? S.formatDate(plan.effective_to) : 'Open'}</td>
          <td>${plan.approval_required ? 'Required' : 'Not required'}</td>
          <td>${plan.is_active ? '<span class="badge badge-green">Active</span>' : '<span class="badge badge-gray">Inactive</span>'}</td>
          <td class="toolbar">
            <button class="btn btn-ghost btn-xs" type="button" data-edit-plan="${plan.id}">Edit</button>
            <button class="btn ${plan.is_active ? 'btn-danger' : 'btn-green'} btn-xs" type="button" data-plan-status="${plan.id}" data-active="${plan.is_active ? '1' : '0'}">${plan.is_active ? 'Deactivate' : 'Activate'}</button>
          </td>
        </tr>`).join('') : '<tr><td colspan="9"><div class="empty-state">No commission plans configured.</div></td></tr>';
      el('planBody').querySelectorAll('[data-edit-plan]').forEach(btn => btn.addEventListener('click', () => openPlanModal(Number(btn.getAttribute('data-edit-plan')))));
      el('planBody').querySelectorAll('[data-plan-status]').forEach(btn => btn.addEventListener('click', () => togglePlan(Number(btn.getAttribute('data-plan-status')), btn.getAttribute('data-active') === '1')));
      const activePlans = plans.filter(p => p.is_active);
      el('entryPlanFilter').innerHTML = '<option value="">All plans</option>' + activePlans.map(p => `<option value="${p.id}">${S.escape(p.name)}</option>`).join('');
      el('generatePlan').innerHTML = activePlans.map(p => `<option value="${p.id}">${S.escape(p.name)}</option>`).join('');
    } catch (error) { S.toast(error.message, true); }
  }

  async function loadClients() {
    if (!canManage()) return;
    try {
      const data = await S.fetchJson('/api/clients?limit=100');
      el('generateClient').innerHTML = '<option value="">All eligible clients</option>' + (data.clients || []).map(c => `<option value="${c.id}">${S.escape(c.client_reference)} — ${S.escape(c.full_name)}</option>`).join('');
    } catch { /* optional */ }
  }

  function queryParams() {
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('limit', '20');
    if (el('entryStatusFilter').value) params.set('status', el('entryStatusFilter').value);
    if (el('entryPlanFilter').value) params.set('plan_id', el('entryPlanFilter').value);
    if (el('entryFrom').value) params.set('from', el('entryFrom').value);
    if (el('entryTo').value) params.set('to', el('entryTo').value);
    if (canManage() && el('entryBranchFilter').value) params.set('branch_id', el('entryBranchFilter').value);
    if ((canManage() || me.role === 'Branch Manager') && el('entryMarketerFilter').value) params.set('marketer_id', el('entryMarketerFilter').value);
    return params;
  }

  async function loadEntries() {
    try {
      const data = await S.fetchJson('/api/commissions?' + queryParams().toString());
      entries = data.entries || [];
      total = data.pagination ? data.pagination.total : entries.length;
      el('entryCount').textContent = `${total} commission entr${total === 1 ? 'y' : 'ies'}`;
      const pages = Math.max(1, Math.ceil(total / 20));
      el('entryPageLabel').textContent = `Page ${page} of ${pages}`;
      el('entryPrev').disabled = page <= 1;
      el('entryNext').disabled = page >= pages;
      renderKpis(data.summary || {});
      renderEntries();
    } catch (error) { S.toast(error.message, true); }
  }

  function renderKpis(summary) {
    const values = hasCommissionAccess()
      ? [
        ['Commission earned', summary.earned_kobo],
        ['Awaiting approval', summary.pending_approval_kobo],
        ['Approved', summary.approved_kobo],
        ['Paid', summary.paid_kobo],
        ['Outstanding', summary.outstanding_kobo]
      ]
      : [
        ['Commission earned', summary.earned_kobo],
        ['Expected after adjustments', summary.expected_kobo],
        ['Paid', summary.paid_kobo],
        ['Outstanding', summary.outstanding_kobo],
        ['Entries', null]
      ];
    el('commissionKpis').innerHTML = values.map(([label, value]) => `<div class="kpi"><div class="label">${label}</div><div class="value">${value === null ? (summary.total_count || 0) : money(value || 0)}</div><div class="delta">${summary.total_count || 0} total entries</div></div>`).join('');
  }

  function renderEntries() {
    const own = !hasCommissionAccess();
    el('commissionBody').innerHTML = entries.length ? entries.map(entry => `
      <tr>
        <td><strong>${S.escape(entry.commission_ref)}</strong><div class="small muted">${S.escape(entry.created_at || '').slice(0, 10)}</div></td>
        <td>${S.escape(entry.recipient_name || (own ? me.full_name : '-'))}<div class="small muted">${S.escape(entry.recipient_role || '')}</div></td>
        <td>${S.escape(entry.client_name || '-')}<div class="small muted">${S.escape(entry.client_reference || '')}</div></td>
        <td>${own ? '—' : S.escape(entry.plan_name || '-')}<div class="small muted">${own ? '' : S.escape(entry.basis || '')}</div></td>
        <td>${own ? '—' : (entry.rate_bps ? (entry.rate_bps / 100).toFixed(2) + '%' : 'Fixed')}</td>
        <td class="nowrap">${money(own ? entry.expected_kobo : entry.commission_kobo)}</td>
        <td class="nowrap">${money(entry.paid_kobo)}</td>
        <td class="nowrap">${money(entry.outstanding_kobo)}</td>
        <td>${S.badge(entry.status, S.statusTone(entry.status))}</td>
        <td><button class="btn btn-ghost btn-xs" type="button" data-entry-id="${entry.id}">Open</button></td>
      </tr>`).join('') : '<tr><td colspan="10"><div class="empty-state">No commission entries in this scope.</div></td></tr>';
    el('commissionBody').querySelectorAll('[data-entry-id]').forEach(btn => btn.addEventListener('click', () => openEntry(Number(btn.getAttribute('data-entry-id')))));
  }

  function ruleRow(rule = {}) {
    const row = document.createElement('div');
    row.className = 'card mb-16';
    row.style.boxShadow = 'none';
    row.dataset.ruleId = rule.id || '';
    row.innerHTML = `<div class="form-grid">
      <div class="field-group"><label class="field-label">Eligible role</label><select class="field-input rule-role">${optionHtml(options.roles.map(r => ({ role: r })), 'role', 'role', rule.role_name || 'Marketer')}</select></div>
      <div class="field-group"><label class="field-label">Rate (%)</label><input class="field-input rule-rate" type="number" step="0.01" min="0" max="100" value="${rule.rate_bps ? rule.rate_bps / 100 : ''}" placeholder="e.g. 5.00"></div>
      <div class="field-group"><label class="field-label">Fixed amount (₦)</label><input class="field-input rule-fixed" type="number" step="0.01" min="0" value="${rule.fixed_amount_kobo ? rule.fixed_amount_kobo / 100 : ''}" placeholder="For fixed plans"></div>
      <div class="field-group"><label class="field-label">Property category</label><select class="field-input rule-category">${optionHtml(options.categories, 'id', 'name', rule.property_category_id, 'Any category')}</select></div>
      <div class="field-group"><label class="field-label">Sales type</label><select class="field-input rule-sale">${optionHtml(options.sale_types.map(s => ({ s })), 's', 's', rule.sales_type, 'Any sale type')}</select></div>
      <div class="field-group"><label class="field-label">Branch</label><select class="field-input rule-branch">${optionHtml(options.branches, 'id', 'name', rule.branch_id, 'Any branch')}</select></div>
      <div class="field-group"><label class="field-label">Team</label><select class="field-input rule-team">${optionHtml(options.teams, 'id', 'name', rule.team_id, 'Any team')}</select></div>
      <div class="field-group" style="display:flex;align-items:flex-end;gap:10px"><label class="tag" style="display:flex;align-items:center;gap:6px;padding:10px"><input type="checkbox" class="rule-active" ${rule.is_active === 0 ? '' : 'checked'}> Active</label><button class="btn btn-ghost btn-sm" type="button" data-remove-rule>Remove</button></div>
    </div>`;
    row.querySelector('[data-remove-rule]').addEventListener('click', () => row.remove());
    return row;
  }

  function addRule(rule) {
    el('planRules').appendChild(ruleRow(rule || {}));
  }

  function syncCommissionableFields() {
    const mode = el('planCommissionableMode').value;
    el('planFirstMonthsGroup').style.display = mode === 'first_months' ? '' : 'none';
    el('planPercentGroup').style.display = mode === 'percentage' ? '' : 'none';
    el('planCapGroup').style.display = mode === 'capped_amount' ? '' : 'none';
  }

  function openPlanModal(id) {
    const plan = id ? plans.find(p => Number(p.id) === Number(id)) : null;
    el('planId').value = id || '';
    el('planModalTitle').textContent = id ? 'Edit commission plan' : 'New commission plan';
    el('planName').value = plan ? plan.name : '';
    el('planBasis').value = plan ? plan.calculation_basis : 'contract_value';
    el('planActive').value = plan ? String(plan.is_active) : '1';
    el('planFrom').value = plan && plan.effective_from ? String(plan.effective_from).slice(0, 10) : '';
    el('planTo').value = plan && plan.effective_to ? String(plan.effective_to).slice(0, 10) : '';
    el('planApproval').value = plan ? String(plan.approval_required) : '1';
    el('planSeparation').value = plan ? String(plan.separation_of_duties) : '1';
    el('planDescription').value = plan ? (plan.description || '') : '';
    el('planCommissionableMode').value = plan ? (plan.commissionable_mode || 'full') : 'full';
    el('planFirstMonths').value = plan ? Number(plan.commissionable_first_months || 2) : 2;
    el('planPercent').value = plan ? Number(plan.commissionable_percent_bps || 10000) / 100 : 100;
    el('planCap').value = plan ? Number(plan.commissionable_cap_kobo || 0) / 100 : 0;
    syncCommissionableFields();
    el('planRules').innerHTML = '';
    const rules = plan && plan.rules ? plan.rules.filter(r => r.is_active) : [{}];
    (rules.length ? rules : [{}]).forEach(addRule);
    S.openModal('planModal');
  }

  async function savePlan(event) {
    event.preventDefault();
    const id = el('planId').value;
    const basis = el('planBasis').value;
    const rules = [...el('planRules').children].map(row => ({
      id: row.dataset.ruleId ? Number(row.dataset.ruleId) : undefined,
      role_name: row.querySelector('.rule-role').value,
      rate_bps: basis === 'fixed' ? 0 : Math.round(Number(row.querySelector('.rule-rate').value || 0) * 100),
      fixed_amount: basis === 'fixed' ? Number(row.querySelector('.rule-fixed').value || 0) : 0,
      property_category_id: row.querySelector('.rule-category').value || null,
      sales_type: row.querySelector('.rule-sale').value || null,
      branch_id: row.querySelector('.rule-branch').value || null,
      team_id: row.querySelector('.rule-team').value || null,
      is_active: row.querySelector('.rule-active').checked
    }));
    const body = {
      name: el('planName').value.trim(),
      description: el('planDescription').value.trim(),
      calculation_basis: basis,
      effective_from: el('planFrom').value || null,
      effective_to: el('planTo').value || null,
      approval_required: el('planApproval').value === '1',
      separation_of_duties: el('planSeparation').value === '1',
      is_active: el('planActive').value === '1',
      commissionable_mode: el('planCommissionableMode').value,
      commissionable_first_months: Number(el('planFirstMonths').value || 2),
      commissionable_percent: Number(el('planPercent').value || 100),
      commissionable_cap_amount: Number(el('planCap').value || 0),
      rules
    };
    try {
      if (id) await S.fetchJson(`/api/commission-plans/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      else await S.fetchJson('/api/commission-plans', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      S.closeModal('planModal');
      S.toast(id ? 'Commission plan updated.' : 'Commission plan created.');
      await loadPlans();
    } catch (error) { S.toast(error.message, true); }
  }

  async function togglePlan(id, active) {
    if (!confirm(active ? 'Deactivate this commission plan?' : 'Activate this commission plan?')) return;
    try {
      await S.fetchJson(`/api/commission-plans/${id}/status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_active: !active }) });
      S.toast('Commission plan status updated.');
      await loadPlans();
    } catch (error) { S.toast(error.message, true); }
  }

  async function submitGenerate(event) {
    event.preventDefault();
    try {
      const result = await S.fetchJson('/api/commissions/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan_id: el('generatePlan').value ? Number(el('generatePlan').value) : null,
          client_id: el('generateClient').value ? Number(el('generateClient').value) : null,
          from: el('generateFrom').value || null,
          to: el('generateTo').value || null,
          draft: el('generateDraft').checked
        })
      });
      S.closeModal('generateModal');
      S.toast(`Generated ${result.created} commission entries; skipped ${result.skipped}.`);
      await loadEntries();
    } catch (error) { S.toast(error.message, true); }
  }

  async function openEntry(id) {
    try {
      const data = await S.fetchJson(`/api/commissions/${id}`);
      currentEntry = data.entry;
      renderEntryDetail(data);
      S.openModal('commissionDetailModal');
    } catch (error) { S.toast(error.message, true); }
  }

  function renderEntryDetail(data) {
    const entry = data.entry;
    if (!hasCommissionAccess()) {
      el('commissionDetailTitle').textContent = entry.commission_ref || 'My commission';
      el('commissionDetailBody').innerHTML = `
        <div class="card" style="box-shadow:none">
          <div class="card-head"><h3>${S.escape(entry.client_name || 'Commission')}</h3>${S.badge(entry.status, S.statusTone(entry.status))}</div>
          <table class="table">
            <tr><td class="muted">Commission reference</td><td>${S.escape(entry.commission_ref)}</td></tr>
            <tr><td class="muted">Client</td><td>${S.escape(entry.client_name || '-')} (${S.escape(entry.client_reference || '')})</td></tr>
            <tr><td class="muted">Earned</td><td>${money(entry.earned_kobo)}</td></tr>
            <tr><td class="muted">Expected after adjustments</td><td><strong>${money(entry.expected_kobo)}</strong></td></tr>
            <tr><td class="muted">Paid</td><td>${money(entry.paid_kobo)}</td></tr>
            <tr><td class="muted">Outstanding</td><td>${money(entry.outstanding_kobo)}</td></tr>
          </table>
          <div class="mini-list mt-16">${(data.payments || []).map(p => `<div class="mini-item"><div class="mini-main"><strong>${S.escape(p.payment_ref)} · ${money(p.amount_kobo)}</strong><span>${S.escape(p.method)} · ${S.formatDateTime(p.paid_at)} · ${S.escape(p.external_reference || '')}</span></div></div>`).join('') || '<div class="empty-state">No payments recorded.</div>'}</div>
        </div>`;
      return;
    }
    const canAct = canManage();
    const actionButtons = [];
    if (canAct && ["Draft", "Calculated"].includes(entry.status)) actionButtons.push(`<button class="btn btn-green btn-sm" data-action="submit">Submit for approval</button>`);
    if (canAct && entry.status === 'Pending Approval') {
      actionButtons.push(`<button class="btn btn-green btn-sm" data-action="approve">Approve</button>`);
      actionButtons.push(`<button class="btn btn-danger btn-sm" data-action="reject">Reject</button>`);
    }
    if (canAct && ["Approved", "Partially Paid"].includes(entry.status)) actionButtons.push(`<button class="btn btn-green btn-sm" data-action="pay">Record payment</button>`);
    if (canAct && !["Rejected", "Cancelled"].includes(entry.status)) actionButtons.push(`<button class="btn btn-ghost btn-sm" data-action="adjust">Adjust</button>`);
    const payments = (data.payments || []).map(p => `<div class="mini-item"><div class="mini-main"><strong>${S.escape(p.payment_ref)} · ${money(p.amount_kobo)}</strong><span>${S.escape(p.method)} · ${S.formatDateTime(p.paid_at)} · ${S.escape(p.paid_by_name || '')}</span></div><a class="btn btn-ghost btn-xs" href="/api/commissions/payments/${p.id}/receipt" target="_blank" rel="noopener">Receipt</a></div>`).join('');
    const approvals = (data.approvals || []).map(a => `<div class="mini-item"><div class="mini-main"><strong>${S.escape(a.action)}</strong><span>${S.escape(a.actor_name || '')} · ${S.formatDateTime(a.created_at)}${a.reason ? ' · ' + S.escape(a.reason) : ''}</span></div></div>`).join('');
    const adjustments = (data.adjustments || []).map(a => `<div class="mini-item"><div class="mini-main"><strong>${S.escape(a.adjustment_type)} · ${money(a.amount_kobo)}</strong><span>${S.escape(a.reason)} · ${S.formatDateTime(a.created_at)}</span></div></div>`).join('');
    const attribution = data.attribution || {};
    el('commissionDetailTitle').textContent = `${entry.commission_ref} — ${entry.client_name}`;
    el('commissionDetailBody').innerHTML = `
      <div class="split-grid wide-left">
        <div>
          <div class="card" style="box-shadow:none">
            <div class="card-head"><h3>${S.escape(entry.plan_name)}</h3>${S.badge(entry.status, S.statusTone(entry.status))}</div>
            <table class="table">
              <tr><td class="muted">Recipient</td><td>${S.escape(entry.recipient_name)} · ${S.escape(entry.recipient_role)}</td></tr>
              <tr><td class="muted">Client</td><td>${S.escape(entry.client_name)} (${S.escape(entry.client_reference)})</td></tr>
              <tr><td class="muted">Property</td><td>${S.escape(entry.property_title || '-')}</td></tr>
              <tr><td class="muted">Basis</td><td>${S.escape(entry.basis)}${entry.rate_bps ? ' · ' + (entry.rate_bps / 100).toFixed(2) + '%' : ' · fixed'}</td></tr>
              <tr><td class="muted">Plan version</td><td>v${Number(entry.plan_version_no || 1)}${entry.commissionable_mode ? ' · ' + S.escape(entry.commissionable_mode) : ''}</td></tr>
              <tr><td class="muted">Payment amount</td><td>${money(entry.payment_amount_kobo || entry.qualifying_amount_kobo)}</td></tr>
              <tr><td class="muted">Qualifying amount</td><td>${money(entry.qualifying_amount_kobo)}</td></tr>
              <tr><td class="muted">Commission earned</td><td><strong>${money(entry.commission_kobo)}</strong></td></tr>
              <tr><td class="muted">Adjustments</td><td>${money(entry.adjusted_kobo)}</td></tr>
              <tr><td class="muted">Paid</td><td>${money(entry.paid_kobo)}</td></tr>
              <tr><td class="muted">Outstanding</td><td><strong>${money(entry.outstanding_kobo)}</strong></td></tr>
              <tr><td class="muted">Attribution snapshot</td><td>Marketer: ${attribution.marketer_id || '-'} · Team lead: ${attribution.team_lead_id || '-'} · Branch: ${attribution.branch_id || '-'} · Team: ${attribution.team_id || '-'}</td></tr>
            </table>
            <div class="toolbar mt-16">${actionButtons.join('')}</div>
          </div>
        </div>
        <div>
          <div class="card" style="box-shadow:none"><h3>Approval history</h3><div class="mini-list">${approvals || '<div class="empty-state">No approval events.</div>'}</div></div>
          <div class="card mt-16" style="box-shadow:none"><h3>Payments</h3><div class="mini-list">${payments || '<div class="empty-state">No payments recorded.</div>'}</div></div>
          <div class="card mt-16" style="box-shadow:none"><h3>Adjustments</h3><div class="mini-list">${adjustments || '<div class="empty-state">No adjustments recorded.</div>'}</div></div>
        </div>
      </div>
      <div id="commissionActionPanel" class="mt-16"></div>`;
    el('commissionDetailBody').querySelectorAll('[data-action]').forEach(btn => btn.addEventListener('click', () => commissionAction(btn.getAttribute('data-action'))));
  }

  async function commissionAction(action) {
    if (!currentEntry) return;
    if (action === 'submit' || action === 'approve') {
      try {
        await S.fetchJson(`/api/commissions/${currentEntry.id}/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        S.toast(action === 'submit' ? 'Submitted for approval.' : 'Commission approved.');
        await openEntry(currentEntry.id);
        await loadEntries();
      } catch (error) { S.toast(error.message, true); }
      return;
    }
    if (action === 'reject') {
      const reason = prompt('Rejection reason:');
      if (!reason) return;
      try {
        await S.fetchJson(`/api/commissions/${currentEntry.id}/reject`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }) });
        S.toast('Commission rejected.');
        await openEntry(currentEntry.id);
        await loadEntries();
      } catch (error) { S.toast(error.message, true); }
      return;
    }
    if (action === 'pay') {
      el('commissionActionPanel').innerHTML = `<div class="card" style="box-shadow:none"><h3>Record commission payment</h3><form id="payForm" class="form-grid">
        <div class="field-group"><label class="field-label">Amount (₦)</label><input class="field-input" id="payAmount" type="number" step="0.01" min="0.01" required></div>
        <div class="field-group"><label class="field-label">Method</label><input class="field-input" id="payMethod" value="Bank Transfer" required></div>
        <div class="field-group"><label class="field-label">External reference</label><input class="field-input" id="payExternal"></div>
        <div class="field-group"><label class="field-label">Idempotency key</label><input class="field-input" id="payIdempotency" placeholder="Optional"></div>
        <div class="field-group full"><label class="field-label">Notes / evidence</label><textarea class="field-input" id="payNotes" rows="2"></textarea></div>
        <div class="field-group full"><button class="btn btn-green" type="submit">Record payment</button></div>
      </form></div>`;
      el('payForm').addEventListener('submit', async event => {
        event.preventDefault();
        try {
          await S.fetchJson(`/api/commissions/${currentEntry.id}/payments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
            amount: Number(el('payAmount').value), method: el('payMethod').value.trim(),
            external_reference: el('payExternal').value.trim(), notes: el('payNotes').value.trim(),
            idempotency_key: el('payIdempotency').value.trim() || undefined
          }) });
          S.toast('Commission payment recorded.');
          await openEntry(currentEntry.id);
          await loadEntries();
        } catch (error) { S.toast(error.message, true); }
      });
      return;
    }
    if (action === 'adjust') {
      el('commissionActionPanel').innerHTML = `<div class="card" style="box-shadow:none"><h3>Commission adjustment</h3><form id="adjustForm" class="form-grid">
        <div class="field-group"><label class="field-label">Type</label><select class="field-input" id="adjustType"><option value="correction">Correction</option><option value="manual">Manual</option><option value="refund">Refund</option><option value="reversal">Reversal</option></select></div>
        <div class="field-group"><label class="field-label">Amount (₦, negative to reduce)</label><input class="field-input" id="adjustAmount" type="number" step="0.01" required></div>
        <div class="field-group full"><label class="field-label">Reason</label><textarea class="field-input" id="adjustReason" rows="2" required></textarea></div>
        <div class="field-group full"><button class="btn btn-green" type="submit">Record adjustment</button></div>
      </form></div>`;
      el('adjustForm').addEventListener('submit', async event => {
        event.preventDefault();
        try {
          await S.fetchJson(`/api/commissions/${currentEntry.id}/adjustments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
            adjustment_type: el('adjustType').value, amount: Number(el('adjustAmount').value), reason: el('adjustReason').value.trim()
          }) });
          S.toast('Commission adjustment recorded.');
          await openEntry(currentEntry.id);
          await loadEntries();
        } catch (error) { S.toast(error.message, true); }
      });
    }
  }

  function bindTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const tab = btn.getAttribute('data-tab');
        el('entriesTab').style.display = tab === 'entries' ? '' : 'none';
        el('plansTab').style.display = tab === 'plans' ? '' : 'none';
      });
    });
  }

  document.addEventListener('DOMContentLoaded', async () => {
    me = await S.initShell('commissions');
    if (!me) return;
    if (!canViewCommission()) {
      S.toast('Commission access is restricted.', true);
      window.location.href = 'dashboard.html';
      return;
    }
    if (!["Managing Director", "Finance Officer", "Branch Manager", "Team Lead", "Marketer", "Head Accountant", "Super Admin"].includes(me.role)) {
      window.location.href = 'dashboard.html';
      return;
    }
    const scopeLabel = ["Managing Director", "Finance Officer"].includes(me.role) ? 'Company-wide' : (me.branch_name || me.team_names || 'Assigned scope');
    el('heroMeta').innerHTML = [`<span class="scope-badge">${S.escape(me.role)}</span>`, `<span class="scope-badge">${S.escape(scopeLabel)}</span>`].join('');
    if (!canManage()) {
      el('newPlanBtn').style.display = 'none';
      el('generateBtn').style.display = 'none';
      el('plansTabBtn').style.display = 'none';
    }
    await loadOptions();
    if (canManage()) {
      await loadPlans();
      await loadClients();
    }
    bindTabs();
    el('newPlanBtn').addEventListener('click', () => openPlanModal(null));
    el('generateBtn').addEventListener('click', () => S.openModal('generateModal'));
    el('addRuleBtn').addEventListener('click', () => addRule({}));
    el('planCommissionableMode').addEventListener('change', syncCommissionableFields);
    el('planForm').addEventListener('submit', savePlan);
    el('generateForm').addEventListener('submit', submitGenerate);
    el('applyEntryFilters').addEventListener('click', () => { page = 1; loadEntries(); });
    el('resetEntryFilters').addEventListener('click', () => {
      el('entryStatusFilter').value = '';
      el('entryPlanFilter').value = '';
      el('entryFrom').value = '';
      el('entryTo').value = '';
      el('entryBranchFilter').value = '';
      el('entryMarketerFilter').value = '';
      page = 1;
      loadEntries();
    });
    el('entryPrev').addEventListener('click', () => { if (page > 1) { page--; loadEntries(); } });
    el('entryNext').addEventListener('click', () => { if (page * 20 < total) { page++; loadEntries(); } });
    el('entryFrom').value = S.daysAgo(90);
    el('entryTo').value = S.today();
    await loadEntries();
  });
})();
