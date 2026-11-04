const API = "/api";
async function fetchJson(path, opts = {}) {
  const res = await fetch(API + path, { credentials: "include", ...opts });
  return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) };
}

async function load() {
  await loadCategories();
  await loadBranches();
  document.getElementById("propertyForm").addEventListener("submit", onSubmit);
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
  const sel = document.getElementById("category_id");
  (data.categories || []).forEach(c => { const o = document.createElement("option"); o.value = c.id; o.textContent = c.name; sel.appendChild(o); });
}

async function loadBranches() {
  const { data } = await fetchJson("/branches");
  const sel = document.getElementById("branch_id");
  (data.branches || []).forEach(b => { const o = document.createElement("option"); o.value = b.id; o.textContent = b.name; sel.appendChild(o); });
}

async function onSubmit(e) {
  e.preventDefault();
  const msg = document.getElementById("formMsg"); msg.textContent = "";
  const features = document.getElementById("features").value.split(",").map(s => s.trim()).filter(Boolean);
  const body = {
    title: document.getElementById("title").value,
    description: "",
    category_name: document.getElementById("category_id").selectedIndex > 0 ? document.getElementById("category_id").options[document.getElementById("category_id").selectedIndex].text : "",
    property_type: document.getElementById("property_type").value,
    sale_price: Number(document.getElementById("sale_price").value),
    promotional_price: document.getElementById("promotional_price").value ? Number(document.getElementById("promotional_price").value) : null,
    state: document.getElementById("state").value,
    city: document.getElementById("city").value,
    address: document.getElementById("address").value,
    branch_name: document.getElementById("branch_id").selectedIndex > 0 ? document.getElementById("branch_id").options[document.getElementById("branch_id").selectedIndex].text : "",
    land_size: document.getElementById("land_size").value || null,
    bedrooms: document.getElementById("bedrooms").value ? Number(document.getElementById("bedrooms").value) : null,
    bathrooms: document.getElementById("bathrooms").value ? Number(document.getElementById("bathrooms").value) : null,
    toilets: document.getElementById("toilets").value ? Number(document.getElementById("toilets").value) : null,
    parking_spaces: document.getElementById("parking_spaces").value ? Number(document.getElementById("parking_spaces").value) : null,
    features,
    is_featured: document.getElementById("is_featured").checked,
    is_published: document.getElementById("is_published").checked,
  };
  const res = await fetchJson("/properties", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (res.ok) { window.location.href = "property-details.html?id=" + res.data.id; } else { msg.textContent = res.data.error || "Creation failed"; }
}

load();
