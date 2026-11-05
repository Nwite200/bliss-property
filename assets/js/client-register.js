const API = "/api";
async function fetchJson(path, opts = {}) {
  const res = await fetch(API + path, { credentials: "include", ...opts });
  return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) };
}
async function load() {
  await loadBranches();
  await loadProperties();
  document.getElementById("interested_property_id").addEventListener("change", onPropertyChange);
  document.getElementById("clientForm").addEventListener("submit", onSubmit);
  document.getElementById("logoutBtn").addEventListener("click", async (e) => {
    e.preventDefault();
    await fetch("/api/logout", { method: "POST", credentials: "include" });
    window.location.href = "/login.html";
  });
  const me = await fetchJson("/me");
  if (!me.ok) { window.location.href = "/login.html"; return; }
  const canSetPrice = ["Managing Director", "Branch Manager"].includes(me.data.role);
  window.__blissCanSetClientPrice = canSetPrice;
  if (!canSetPrice) {
    const price = document.getElementById("agreed_purchase_price");
    if (price) {
      price.value = "";
      price.disabled = true;
      const group = price.closest("div");
      if (group) group.style.display = "none";
    }
  }
}
async function loadBranches() {
  const { data } = await fetchJson("/branches");
  const sel = document.getElementById("assigned_branch_id");
  (data.branches || []).forEach(b => { const o = document.createElement("option"); o.value = b.id; o.textContent = b.name; sel.appendChild(o); });
}

async function loadProperties() {
  const { data } = await fetchJson("/properties?limit=50");
  const sel = document.getElementById("interested_property_id");
  sel.innerHTML = '<option value="">No property selected</option>' + (data.properties || []).map(p => `<option value="${p.id}">${p.reference} — ${p.title}</option>`).join("");
}

function planLabel(type) {
  return ({ outright: "Outright", part_payment: "Part payment", daily: "Daily", weekly: "Weekly", bi_monthly: "Bi-monthly", monthly: "Monthly" })[type] || type;
}

async function onPropertyChange() {
  const propertyId = document.getElementById("interested_property_id").value;
  const wrap = document.getElementById("planOffering");
  const hidden = document.getElementById("property_plan_id");
  const price = document.getElementById("agreed_purchase_price");
  hidden.value = "";
  price.readOnly = false;
  if (!propertyId) {
    wrap.innerHTML = '<span class="small muted">Select a property to see its payment plans.</span>';
    return;
  }
  wrap.innerHTML = '<span class="small muted">Loading payment plans…</span>';
  const { data, ok } = await fetchJson(`/properties/${propertyId}/payment-plans`);
  if (!ok) { wrap.innerHTML = '<span class="small muted">Unable to load plans.</span>'; return; }
  const plans = data.plans || [];
  if (!plans.length) {
    wrap.innerHTML = '<span class="small muted">This property has no enabled payment plans. A plan can be added from the property screen.</span>';
    return;
  }
  wrap.innerHTML = plans.map((plan, index) => `
    <label class="tag" style="cursor:pointer;display:flex;align-items:center;gap:8px;padding:10px;flex-wrap:wrap">
      <input type="radio" name="propertyPlanChoice" value="${plan.id}" data-total="${Number(plan.total_price_kobo || 0) / 100}" ${index === 0 ? "checked" : ""}>
      <strong>${planLabel(plan.plan_type)}</strong>
      <span>₦${(Number(plan.total_price_kobo || 0) / 100).toLocaleString("en-NG")}</span>
      <span class="small muted">Deposit ₦${(Number(plan.deposit_kobo || 0) / 100).toLocaleString("en-NG")} · Instalment ₦${(Number(plan.installment_kobo || 0) / 100).toLocaleString("en-NG")}${plan.number_of_installments ? ` · ${plan.number_of_installments} instalment(s)` : ""}${plan.duration_months ? ` · ${plan.duration_months} month(s)` : ""}</span>
    </label>`).join("");
  const selectFirst = () => {
    const checked = wrap.querySelector('input[name="propertyPlanChoice"]:checked');
    if (checked) {
      hidden.value = checked.value;
      price.value = checked.getAttribute("data-total");
      price.readOnly = true;
    }
  };
  wrap.querySelectorAll('input[name="propertyPlanChoice"]').forEach(input => input.addEventListener("change", selectFirst));
  selectFirst();
}
async function onSubmit(e) {
  e.preventDefault();
  const msg = document.getElementById("formMsg"); msg.textContent = "";
  const body = {
    full_name: document.getElementById("full_name").value,
    phone_number: document.getElementById("phone_number").value,
    alternate_phone: document.getElementById("alternate_phone").value,
    email_address: document.getElementById("email_address").value,
    residential_address: document.getElementById("residential_address").value,
    state: document.getElementById("state").value,
    city: document.getElementById("city").value,
    next_of_kin_name: document.getElementById("next_of_kin_name").value,
    next_of_kin_phone: document.getElementById("next_of_kin_phone").value,
    next_of_kin_relationship: document.getElementById("next_of_kin_relationship").value,
    next_of_kin_address: document.getElementById("next_of_kin_address").value,
    identity_type: document.getElementById("identity_type").value,
    identity_number: document.getElementById("identity_number").value.trim(),
    referral_code: document.getElementById("referral_code").value,
    notes: document.getElementById("notes").value,
    preferred_channel: document.getElementById("preferred_channel").value,
    sale_type: document.getElementById("sale_type").value,
    status: document.getElementById("status").value,
    interested_property_id: document.getElementById("interested_property_id").value
      ? Number(document.getElementById("interested_property_id").value) : null,
    property_plan_id: document.getElementById("property_plan_id").value
      ? Number(document.getElementById("property_plan_id").value) : null,
    plan_start_date: new Date().toISOString().slice(0, 10),
    agreed_purchase_price: window.__blissCanSetClientPrice && !document.getElementById("agreed_purchase_price").readOnly && document.getElementById("agreed_purchase_price").value
      ? Number(document.getElementById("agreed_purchase_price").value) : null,
    assigned_branch_id: document.getElementById("assigned_branch_id").value,
    static_wallet_bvn: document.getElementById("static_wallet_bvn").value.trim() || null,
  };
  if (!body.full_name || !body.phone_number) { msg.textContent = "Full name and phone number are required."; return; }
  const res = await fetchJson("/clients", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (res.ok) { window.location.href = "client-detail.html?id=" + res.data.id + "&verify=1"; } else { msg.textContent = res.data.error || "Registration failed"; }
}
load();
