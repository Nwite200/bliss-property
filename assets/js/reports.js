(function () {
  const S = window.BlissStaff;
  let me = null;
  const reportLabels = {
    sales: 'Sales report',
    collections: 'Collections report',
    outstanding: 'Outstanding balances report',
    commission: 'Commission report',
    branch_performance: 'Branch performance report',
    marketer_performance: 'Marketer performance report',
    refunds: 'Refund and reversal report',
    commission_liability: 'Commission liability report'
  };
  const el = id => document.getElementById(id);

  function allowedTypes() {
    if (me.role === 'Marketer') return ['commission', 'commission_liability'];
    if (me.role === 'Team Lead') return ['sales', 'collections', 'outstanding', 'commission', 'marketer_performance', 'refunds', 'commission_liability'];
    return Object.keys(reportLabels);
  }

  async function loadOptions() {
    const types = allowedTypes();
    el('reportType').innerHTML = types.map(t => `<option value="${t}">${reportLabels[t]}</option>`).join('');
    el('reportFilterType').innerHTML = '<option value="">All report types</option>' + types.map(t => `<option value="${t}">${reportLabels[t]}</option>`).join('');

    const branches = await S.fetchJson('/api/branches');
    el('reportBranch').innerHTML = '<option value="">All branches</option>' + (branches.branches || []).map(b => `<option value="${b.id}">${S.escape(b.name)}</option>`).join('');

    if (me.role === 'Marketer') {
      el('reportBranchGroup').style.display = 'none';
      el('reportTeamGroup').style.display = 'none';
      el('reportMarketerGroup').style.display = 'none';
    } else {
      try {
        const teams = await S.fetchJson('/api/teams');
        el('reportTeam').innerHTML = '<option value="">All teams</option>' + (teams.teams || []).map(t => `<option value="${t.id}">${S.escape(t.name)}</option>`).join('');
      } catch { el('reportTeamGroup').style.display = 'none'; }
      if (['Managing Director', 'Finance Officer', 'Branch Manager'].includes(me.role)) {
        try {
          const staff = await S.fetchJson('/api/users?role=Marketer');
          el('reportMarketer').innerHTML = '<option value="">All marketers</option>' + (staff.users || []).map(u => `<option value="${u.id}">${S.escape(u.full_name)}</option>`).join('');
        } catch { el('reportMarketerGroup').style.display = 'none'; }
      } else {
        el('reportMarketerGroup').style.display = 'none';
      }
      if (!['Managing Director', 'Finance Officer'].includes(me.role)) {
        el('reportBranchGroup').style.display = 'none';
      }
    }
  }

  async function loadReports() {
    try {
      const params = new URLSearchParams();
      if (el('reportFilterType').value) params.set('report_type', el('reportFilterType').value);
      params.set('limit', '100');
      const data = await S.fetchJson('/api/reports?' + params.toString());
      const rows = data.jobs || [];
      el('reportCount').textContent = `${data.pagination ? data.pagination.total : rows.length} report${(data.pagination ? data.pagination.total : rows.length) === 1 ? '' : 's'}`;
      el('reportBody').innerHTML = rows.length ? rows.map(job => `
        <tr>
          <td><strong>${S.escape(job.report_ref)}</strong></td>
          <td>${S.escape(reportLabels[job.report_type] || job.report_type)}</td>
          <td>${S.badge(job.format, 'blue')}</td>
          <td>${S.escape(job.requested_by_name || '-')}</td>
          <td>${S.formatDateTime(job.created_at)}</td>
          <td>${S.badge(job.status, S.statusTone(job.status))}</td>
          <td><a class="btn btn-ghost btn-xs" href="/api/reports/${job.id}/download" target="_blank" rel="noopener">Download</a></td>
        </tr>`).join('') : '<tr><td colspan="7"><div class="empty-state">No reports generated yet.</div></td></tr>';
    } catch (error) { S.toast(error.message, true); }
  }

  async function generate(event) {
    event.preventDefault();
    const body = {
      report_type: el('reportType').value,
      format: el('reportFormat').value,
      from: el('reportFrom').value || null,
      to: el('reportTo').value || null,
      branch_id: el('reportBranch').value || null,
      team_id: el('reportTeam').value || null,
      marketer_id: el('reportMarketer').value || null,
      include_test: Boolean(el('reportIncludeTest') && el('reportIncludeTest').checked)
    };
    try {
      const result = await S.fetchJson('/api/reports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      S.toast(`Report ${result.report_ref} generated.`);
      await loadReports();
    } catch (error) { S.toast(error.message, true); }
  }

  document.addEventListener('DOMContentLoaded', async () => {
    me = await S.initShell('reports');
    if (!me) return;
    const scopeLabel = ['Managing Director', 'Finance Officer'].includes(me.role) ? 'Company-wide' : (me.branch_name || me.team_names || 'Assigned scope');
    el('heroMeta').innerHTML = [`<span class="scope-badge">${S.escape(me.role)}</span>`, `<span class="scope-badge">${S.escape(scopeLabel)}</span>`].join('');
    el('reportFrom').value = S.daysAgo(29);
    el('reportTo').value = S.today();
    await loadOptions();
    el('reportForm').addEventListener('submit', generate);
    el('refreshReports').addEventListener('click', loadReports);
    el('reportFilterType').addEventListener('change', loadReports);
    await loadReports();
  });
})();
