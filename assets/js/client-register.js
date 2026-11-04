const API = "/api";
async function fetchJson(path, opts = {}) {
  const res = await fetch(API + path, { credentials: "include", ...opts });
  return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) };
}
async function load() {
  await loadBranches();
  document.getElementById("clientForm").addEventListener("submit", onSubmit);
  document.getElementById("logoutBtn").addEventListener("click", async (e) => {
    e.preventDefault();
    await fetch("/api/logout", { method: "POST", credentials: "include" });
    window.location.href = "/login.html";
  });
  const me = await fetchJson("/api/me");
  if (!me.ok) window.location.href = "/login.html";
}
async function loadBranches() {
  const { data } = await fetchJson("/branches");
  const sel = document.getElementById("assigned_branch_id");
  (data.branches || []).forEach(b => { const o = document.createElement("option"); o.value = b.id; o.textContent = b.name; sel.appendChild(o); });
}
async function onSubmit(e) {
  e.preventDefault();
  const msg = document.getElementById("formMsg"); msg.textContent = "";
  const body = {
    full_name: document.getElementById("full_name").value,
    phone_number: document.getElementById("phone_number").value,
    email_address: document.getElementById("email_address").value,
    residential_address: document.getElementById("residential_address").value,
    state: document.getElementById("state").value,
    city: document.getElementById("city").value,
    next_of_kin: document.getElementById("next_of_kin").value,
    notes: document.getElementById("notes").value,
    preferred_channel: document.getElementById("preferred_channel").value,
    status: document.getElementById("status").value,
    interested_property_id: document.getElementById("interested_property_id").value,
    agreed_purchase_price: document.getElementById("agreed_purchase_price").value ? Number(document.getElementById("agreed_purchase_price").value) : null,
    assigned_branch_id: document.getElementById("assigned_branch_id").value,
  };
  if (!body.full_name || !body.phone_number) { msg.textContent = "Full name and phone number are required."; return; }
  const res = await fetchJson("/clients", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (res.ok) { window.location.href = "client-detail.html?id=" + res.data.id; } else { msg.textContent = res.data.error || "Registration failed"; }
}
load();
