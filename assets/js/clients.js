const API = "/api";
let currentPage = 1;
async function fetchJson(path, opts = {}) {
  const res = await fetch(API + path, { credentials: "include", ...opts });
  return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) };
}
function badge(status) {
  const cls = status === "Active Buyer" || status === "Completed" ? "badge-green" : status === "Prospect" || status === "Interested" ? "badge-gray" : "badge-amber";
  return `<span class="badge ${cls}">${status}</span>`;
}
async function loadBranches() {
  const { data } = await fetchJson("/branches");
  const sel = document.getElementById("branchFilter");
  (data.branches || []).forEach(b => { const o = document.createElement("option"); o.value = b.id; o.textContent = b.name; sel.appendChild(o); });
}
async function loadMarketers() {
  const { data } = await fetchJson("/users?role=Marketer");
  const sel = document.getElementById("marketerFilter");
  if (data.users) (data.users || []).forEach(u => { const o = document.createElement("option"); o.value = u.id; o.textContent = u.full_name; sel.appendChild(o); });
}
async function loadProperties() {
  const params = new URLSearchParams();
  params.set("page", currentPage);
  const q = document.getElementById("searchInput").value; if (q) params.set("q", q);
  const status = document.getElementById("statusFilter").value; if (status) params.set("status", status);
  const branch = document.getElementById("branchFilter").value; if (branch) params.set("branch", branch);
  const marketer = document.getElementById("marketerFilter").value; if (marketer) params.set("marketer", marketer);
  const { data } = await fetchJson("/clients?" + params.toString());
  render(data.clients || []);
  renderKpis(data.clients || []);
}
function renderKpis(clients) {
  document.getElementById("kpiTotal").textContent = clients.length;
  document.getElementById("kpiActive").textContent = clients.filter(c => c.status === "Active Buyer" || c.status === "Completed").length;
  document.getElementById("kpiProspect").textContent = clients.filter(c => c.status === "Prospect" || c.status === "Interested").length;
  document.getElementById("kpiPurchased").textContent = clients.filter(c => c.status === "Completed").length;
}
function render(clients) {
  const tbody = document.getElementById("clientTableBody");
  tbody.innerHTML = "";
  if (!clients.length) { tbody.innerHTML = "<tr><td colspan='7' style='text-align:center;color:var(--muted)'>No clients found.</td></tr>"; return; }
  clients.forEach(c => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td><strong>${c.client_reference}</strong></td><td>${c.full_name}${c.is_internal_test ? ' <span class="badge badge-red">TEST</span>' : ''}</td><td>${c.phone_number}</td><td>${badge(c.status)}</td><td>${c.branch_name || "-"}</td><td>${c.original_marketer_name || c.created_by_name || "-"}</td><td><a class="details-link" href="client-detail.html?id=${c.id}" style="color:var(--green-dark)">View</a></td>`;
    tbody.appendChild(tr);
  });
}
async function load() {
  const me = await fetchJson("/me");
  if (!me.ok) { window.location.href = "/login.html"; return; }
  await loadBranches();
  await loadMarketers();
  loadProperties();
  document.getElementById("logoutBtn").addEventListener("click", async (e) => {
    e.preventDefault();
    await fetch("/api/logout", { method: "POST", credentials: "include" });
    window.location.href = "/login.html";
  });
  const evs = ["input","change"];
  evs.forEach(ev => {
    document.getElementById("searchInput").addEventListener(ev === "input" ? "input" : "change", loadProperties);
    document.getElementById("statusFilter").addEventListener(ev === "input" ? "input" : "change", loadProperties);
    document.getElementById("branchFilter").addEventListener("change", loadProperties);
    document.getElementById("marketerFilter").addEventListener("change", loadProperties);
  });
}
load();
