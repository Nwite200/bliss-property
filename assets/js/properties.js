const API = "/api";

function money(n) { return "₦" + Number(n || 0).toLocaleString("en-NG"); }
function esc(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

let currentPage = 1;
let totalPages = 1;
let me = null;

async function fetchJson(path, opts = {}) {
  const res = await fetch(API + path, { credentials: "include", ...opts });
  return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) };
}

function actualRole() { return (me && (me.actual_role || me.role)) || ""; }
function canManageProperties() { return ["Managing Director", "Super Admin", "Branch Manager"].includes(actualRole()); }
function canApproveProperties() { return ["Managing Director", "Super Admin"].includes(actualRole()); }

async function load() {
  const meRes = await fetchJson("/me");
  if (!meRes.ok) { window.location.href = "/login.html"; return; }
  me = meRes.data;
  if (!canManageProperties()) {
    const add = document.getElementById("addPropertyBtn");
    if (add) add.style.display = "none";
  }
  if (!canApproveProperties()) {
    const pending = document.getElementById("pendingApprovalBtn");
    if (pending) pending.style.display = "none";
  }
  await loadCategories();
  await loadBranches();
  await loadProperties();
  document.getElementById("logoutBtn").addEventListener("click", async (e) => {
    e.preventDefault();
    await fetch("/api/logout", { method: "POST", credentials: "include" });
    window.location.href = "/login.html";
  });
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

function workflowBadge(status) {
  const map = {
    draft: "gray", pending_approval: "amber", published: "green",
    unpublished: "gray", sold_out: "blue", archived: "red"
  };
  return `<span class="badge badge-${map[status] || "gray"}">${esc(String(status || "draft").replace(/_/g, " "))}</span>`;
}

function flags(p) {
  const out = [];
  if (p.is_demo) out.push('<span class="badge badge-amber">DEMO</span>');
  if (p.is_internal_test) out.push('<span class="badge badge-red">TEST</span>');
  if (p.is_archived) out.push('<span class="badge badge-gray">ARCHIVED</span>');
  return out.join(" ") || '<span class="small muted">-</span>';
}

async function loadProperties() {
  const params = new URLSearchParams();
  params.set("page", currentPage);
  params.set("limit", 20);
  const q = document.getElementById("searchInput").value; if (q) params.set("q", q);
  const cat = document.getElementById("categoryFilter").value; if (cat) params.set("category", cat);
  const status = document.getElementById("statusFilter").value; if (status) params.set("status", status);
  const workflow = document.getElementById("workflowFilter").value; if (workflow) params.set("workflow_status", workflow);
  const branch = document.getElementById("branchFilter").value; if (branch) params.set("branch", branch);
  if (document.getElementById("flagsFilter").checked) params.set("flags", "1");
  if (document.getElementById("archivedFilter").checked && canManageProperties()) params.set("include_archived", "1");

  const { data } = await fetchJson("/properties?" + params.toString());
  let properties = data.properties || [];
  if (document.getElementById("flagsFilter").checked) {
    properties = properties.filter(p => p.is_demo || p.is_internal_test || p.is_archived);
  }
  render(properties);
  renderKpis(properties);
  renderPagination(data.total || 0, data.limit || 20, data.page || 1);
}

function renderKpis(props) {
  document.getElementById("kpiTotal").textContent = props.length;
  document.getElementById("kpiPublished").textContent = props.filter(p => p.workflow_status === "published" || p.is_published).length;
  document.getElementById("kpiPending").textContent = props.filter(p => p.workflow_status === "pending_approval").length;
  document.getElementById("kpiTestDemo").textContent = props.filter(p => p.is_demo || p.is_internal_test).length;
}

function render(props) {
  const tbody = document.getElementById("propertyTableBody");
  if (!props.length) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;color:var(--muted)">No properties found.</td></tr>`;
    return;
  }
  tbody.innerHTML = props.map(p => {
    const actions = [`<a class="btn btn-ghost btn-xs" href="property-details.html?id=${p.id}">Open</a>`];
    if (canManageProperties()) {
      if (p.workflow_status === "pending_approval" && canApproveProperties()) {
        actions.push(`<button class="btn btn-green btn-xs" data-action="approve" data-id="${p.id}">Approve</button>`);
      }
      if (!p.is_archived && p.workflow_status !== "published" && p.workflow_status !== "pending_approval") {
        const label = actualRole() === "Branch Manager" ? "Submit" : "Publish";
        actions.push(`<button class="btn btn-green btn-xs" data-action="publish" data-id="${p.id}">${label}</button>`);
      }
      if (p.workflow_status === "published") {
        actions.push(`<button class="btn btn-outline btn-xs" data-action="unpublish" data-id="${p.id}">Unpublish</button>`);
      }
      if (!p.is_archived) {
        actions.push(`<button class="btn btn-danger btn-xs" data-action="archive" data-id="${p.id}">Archive</button>`);
      }
      if (p.is_demo || p.is_internal_test) {
        actions.push(`<button class="btn btn-outline btn-xs" data-action="convert" data-id="${p.id}">Convert to real</button>`);
      }
    }
    return `<tr>
      <td><strong>${esc(p.reference)}</strong></td>
      <td>
        <strong>${esc(p.title)}</strong>
        <div class="small muted">${esc(p.category_name || p.property_type || "-")} · ${esc(p.city || "")}${p.state ? ", " + esc(p.state) : ""}</div>
      </td>
      <td>${money(p.sale_price)}</td>
      <td>${esc(p.branch_name || "-")}</td>
      <td>${workflowBadge(p.workflow_status)}</td>
      <td>${esc(p.status || "-")}</td>
      <td>${flags(p)}</td>
      <td>${Number(p.enabled_plan_count || 0)}</td>
      <td class="toolbar">${actions.join(" ")}</td>
    </tr>`;
  }).join("");

  tbody.querySelectorAll("[data-action]").forEach(button => {
    button.addEventListener("click", async () => {
      const action = button.getAttribute("data-action");
      const id = button.getAttribute("data-id");
      button.disabled = true;
      try {
        let result;
        if (action === "publish") {
          result = await fetchJson(`/properties/${id}`, {
            method: "PUT", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ is_published: true })
          });
        } else {
          result = await fetchJson(`/properties/${id}/${action}`, { method: "POST" });
        }
        if (!result.ok) throw new Error(result.data.error || "Action failed");
        if (action === "publish" && result.data.workflow_status === "pending_approval") {
          alert("Submitted for MD/Super Admin approval.");
        }
        await loadProperties();
      } catch (error) {
        alert(error.message);
        button.disabled = false;
      }
    });
  });
}

function renderPagination(total, limit, page) {
  totalPages = Math.ceil(total / limit) || 1;
  const el = document.getElementById("pagination");
  el.innerHTML = "";
  const add = (label, pg, disabled, active) => {
    const btn = document.createElement("button");
    btn.textContent = label; btn.disabled = disabled;
    btn.style.padding = "6px 10px"; btn.style.border = "1px solid var(--line)"; btn.style.background = active ? "var(--green)" : "#fff";
    btn.style.color = active ? "#fff" : "var(--ink)"; btn.style.borderRadius = "6px";
    if (!disabled && !active) btn.onclick = () => { currentPage = pg; loadProperties(); };
    el.appendChild(btn);
  };
  add("«", currentPage - 1, currentPage === 1, false);
  for (let i = Math.max(1, currentPage - 1); i <= Math.min(totalPages, currentPage + 1); i++) add(String(i), i, false, i === currentPage);
  add("»", currentPage + 1, currentPage === totalPages, false);
}

["input", "change"].forEach(ev => {
  document.getElementById("searchInput")?.addEventListener(ev === "input" ? "input" : "change", () => { currentPage = 1; loadProperties(); });
  document.getElementById("categoryFilter")?.addEventListener("change", () => { currentPage = 1; loadProperties(); });
  document.getElementById("statusFilter")?.addEventListener("change", () => { currentPage = 1; loadProperties(); });
  document.getElementById("workflowFilter")?.addEventListener("change", () => { currentPage = 1; loadProperties(); });
  document.getElementById("branchFilter")?.addEventListener("change", () => { currentPage = 1; loadProperties(); });
  document.getElementById("flagsFilter")?.addEventListener("change", () => { currentPage = 1; loadProperties(); });
  document.getElementById("archivedFilter")?.addEventListener("change", () => { currentPage = 1; loadProperties(); });
});

document.getElementById("pendingApprovalBtn")?.addEventListener("click", () => {
  document.getElementById("workflowFilter").value = "pending_approval";
  currentPage = 1;
  loadProperties();
});

load();
