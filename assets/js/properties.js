const API = "/api";

function money(n) { return "₦" + Number(n).toLocaleString("en-NG"); }

let currentPage = 1;
let totalPages = 1;

async function fetchJson(path, opts = {}) {
  const res = await fetch(API + path, { credentials: "include", ...opts });
  return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) };
}

async function load() {
  await loadCategories();
  await loadBranches();
  await loadProperties();
  document.getElementById("logoutBtn").addEventListener("click", async (e) => {
    e.preventDefault();
    await fetch("/api/logout", { method: "POST", credentials: "include" });
    window.location.href = "/login.html";
  });
  const me = await fetchJson("/me");
  if (!me.ok) window.location.href = "/login.html";
}

async function loadCategories() {
  const { data } = await fetchJson("/property-categories");
  const sel = document.getElementById("categoryFilter");
  (data.categories || []).forEach(c => {
    const o = document.createElement("option"); o.value = c.name; o.textContent = c.name; sel.appendChild(o);
  });
}

async function loadBranches() {
  const { data } = await fetchJson("/branches");
  const sel = document.getElementById("branchFilter");
  (data.branches || []).forEach(b => {
    const o = document.createElement("option"); o.value = b.name; o.textContent = b.name; sel.appendChild(o);
  });
}

function badge(status) {
  const cls = status === "Available" ? "badge-green" : "badge-gray";
  return `<span class="badge ${cls}">${status}</span>`;
}

async function loadProperties() {
  const params = new URLSearchParams();
  params.set("page", currentPage);
  params.set("limit", 20);
  const q = document.getElementById("searchInput").value; if (q) params.set("q", q);
  const cat = document.getElementById("categoryFilter").value; if (cat) params.set("category", cat);
  const status = document.getElementById("statusFilter").value; if (status) params.set("status", status);
  const branch = document.getElementById("branchFilter").value; if (branch) params.set("branch", branch);
  if (document.getElementById("featuredFilter").checked) params.set("featured", "1");
  if (document.getElementById("publishedFilter").checked) params.set("is_published", "1");

  const { data } = await fetchJson("/properties?" + params.toString());
  render(data.properties || []);
  renderKpis(data.properties || []);
  renderPagination(data.total || 0, data.limit || 20, data.page || 1);
}

function renderKpis(props) {
  document.getElementById("kpiTotal").textContent = props.length;
  document.getElementById("kpiPublished").textContent = props.filter(p => p.is_published).length;
  document.getElementById("kpiFeatured").textContent = props.filter(p => p.is_featured).length;
  document.getElementById("kpiAvailable").textContent = props.filter(p => p.status === "Available").length;
}

function render(props) {
  const tbody = document.getElementById("propertyTableBody");
  tbody.innerHTML = "";
  if (!props.length) { tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;color:var(--muted)">No properties found.</td></tr>`; return; }
  props.forEach(p => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${p.reference}</strong></td>
      <td>${p.title}</td>
      <td>${p.category_name || "-"}</td>
      <td>${money(p.sale_price)}</td>
      <td>${p.branch_name || "-"}</td>
      <td>${badge(p.status)}</td>
      <td>${p.is_featured ? '<span class="badge badge-green">Yes</span>' : "-"}</td>
      <td>${p.is_published ? '<span class="badge badge-green">Yes</span>' : "-"}</td>
      <td>
        <a class="details-link" href="property-details.html?id=${p.id}" style="color:var(--green-dark)">View</a>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function renderPagination(total, limit, page) {
  totalPages = Math.ceil(total / limit);
  const el = document.getElementById("pagination");
  el.innerHTML = "";
  const add = (label, pg, disabled) => {
    const btn = document.createElement("button");
    btn.textContent = label; btn.disabled = disabled;
    btn.style.padding = "6px 10px"; btn.style.border = "1px solid var(--line)"; btn.style.background = "#fff"; btn.style.borderRadius = "6px";
    if (!disabled) btn.onclick = () => { currentPage = pg; loadProperties(); };
    el.appendChild(btn);
  };
  add("«", currentPage - 1, currentPage === 1);
  for (let i = Math.max(1, currentPage - 1); i <= Math.min(totalPages, currentPage + 1); i++) {
    const btn = document.createElement("button");
    btn.textContent = i; btn.style.padding = "6px 10px"; btn.style.border = "1px solid var(--line)";
    btn.style.background = i === currentPage ? "var(--green)" : "#fff"; btn.style.color = i === currentPage ? "#fff" : "var(--ink)";
    btn.style.borderRadius = "6px"; btn.onclick = () => { currentPage = i; loadProperties(); };
    el.appendChild(btn);
  }
  add("»", currentPage + 1, currentPage === totalPages);
}

["input","change"].forEach(ev => {
  document.getElementById("searchInput")?.addEventListener(ev === "input" ? "input" : "change", () => { currentPage = 1; loadProperties(); });
  document.getElementById("categoryFilter")?.addEventListener("change", () => { currentPage = 1; loadProperties(); });
  document.getElementById("statusFilter")?.addEventListener("change", () => { currentPage = 1; loadProperties(); });
  document.getElementById("branchFilter")?.addEventListener("change", () => { currentPage = 1; loadProperties(); });
  document.getElementById("featuredFilter")?.addEventListener("change", loadProperties);
  document.getElementById("publishedFilter")?.addEventListener("change", loadProperties);
});

load();
