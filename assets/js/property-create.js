const API = "/api";
const PLAN_DEFS = [
  { type: "outright", label: "Outright", hint: "Full payment" },
  { type: "part_payment", label: "Part payment", hint: "Deposit + instalments" },
  { type: "daily", label: "Daily easy buy", hint: "Daily instalments" },
  { type: "weekly", label: "Weekly easy buy", hint: "Weekly instalments" },
  { type: "bi_monthly", label: "Bi-monthly easy buy", hint: "Every 15 days" },
  { type: "monthly", label: "Monthly easy buy", hint: "Monthly instalments" }
];

async function fetchJson(path, opts = {}) {
  const res = await fetch(API + path, { credentials: "include", ...opts });
  return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) };
}

function numberValue(id) {
  const el = document.getElementById(id);
  return el ? Number(el.value) : 0;
}

function naira(value) {
  return "₦" + Number(value || 0).toLocaleString("en-NG", { maximumFractionDigits: 2 });
}

function planInput(row, name) {
  return row.querySelector(`[data-plan-${name}]`);
}

function salePriceValue() {
  const value = numberValue("sale_price");
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function deriveCount(type, durationMonths) {
  const duration = Number(durationMonths || 0);
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  if (type === "daily") return Math.round(duration * 30);
  if (type === "weekly") return Math.round((duration * 30) / 7);
  if (type === "bi_monthly") return Math.round(duration * 2);
  if (type === "monthly") return Math.round(duration);
  if (type === "part_payment") return Math.round(duration);
  return 0;
}

function setPlanEnabled(row, enabled) {
  row.querySelectorAll("input[data-plan-total], input[data-plan-deposit], input[data-plan-installment], input[data-plan-count], input[data-plan-duration]")
    .forEach(input => { input.disabled = !enabled; });
  const type = row.getAttribute("data-plan-type");
  if (type === "outright") {
    planInput(row, "deposit").disabled = true;
    planInput(row, "installment").disabled = true;
    planInput(row, "count").disabled = true;
    planInput(row, "duration").disabled = true;
  }
  const total = planInput(row, "total");
  if (enabled && !total.value) total.value = salePriceValue() || "";
  if (!enabled) {
    row.querySelector("[data-plan-balance]").textContent = "—";
    return;
  }
  updatePlanBalance(row);
}

function autoInstallment(row) {
  const type = row.getAttribute("data-plan-type");
  if (type === "outright") return;
  const total = Number(planInput(row, "total").value || 0);
  const deposit = Number(planInput(row, "deposit").value || 0);
  let count = Number(planInput(row, "count").value || 0);
  const duration = Number(planInput(row, "duration").value || 0);
  if (!count && duration > 0) {
    count = deriveCount(type, duration);
    if (count > 0) planInput(row, "count").value = count;
  }
  const installmentInput = planInput(row, "installment");
  if (total > 0 && count > 0 && !installmentInput.dataset.manual) {
    const installment = (total - deposit) / count;
    if (Number.isFinite(installment) && installment > 0) {
      installmentInput.value = Math.round(installment * 100) / 100;
    }
  }
}

function updatePlanBalance(row) {
  const type = row.getAttribute("data-plan-type");
  const balanceEl = row.querySelector("[data-plan-balance]");
  if (!balanceEl) return;
  if (type === "outright") {
    const total = Number(planInput(row, "total").value || 0);
    balanceEl.textContent = total > 0 ? "Paid in full" : "Enter total";
    balanceEl.style.color = total > 0 ? "#047857" : "#b45309";
    return;
  }
  const total = Number(planInput(row, "total").value || 0);
  const deposit = Number(planInput(row, "deposit").value || 0);
  const installment = Number(planInput(row, "installment").value || 0);
  let count = Number(planInput(row, "count").value || 0);
  const duration = Number(planInput(row, "duration").value || 0);
  if (!count && duration > 0) count = deriveCount(type, duration);
  if (total <= 0) {
    balanceEl.textContent = "Enter total";
    balanceEl.style.color = "#b45309";
    return;
  }
  if (count <= 0) {
    balanceEl.textContent = "Enter instalments or duration";
    balanceEl.style.color = "#b45309";
    return;
  }
  const difference = Math.round((total - deposit - installment * count) * 100) / 100;
  balanceEl.textContent = Math.abs(difference) < 0.01 ? "Adds up" : naira(difference) + " off";
  balanceEl.style.color = Math.abs(difference) < 0.01 ? "#047857" : "#b91c1c";
}

function renderPlanEditor() {
  const body = document.getElementById("planEditorBody");
  if (!body) return;
  const price = salePriceValue();
  body.innerHTML = PLAN_DEFS.map(def => {
    const isOutright = def.type === "outright";
    return `
      <tr data-plan-type="${def.type}">
        <td><strong>${def.label}</strong><div class="small muted">${def.hint}</div></td>
        <td><input type="checkbox" data-plan-enabled ${isOutright ? "checked" : ""}></td>
        <td><input type="number" min="0" step="0.01" class="field-input" data-plan-total value="${price || ""}" style="min-width:120px"></td>
        <td><input type="number" min="0" step="0.01" class="field-input" data-plan-deposit value="0" ${isOutright ? "disabled" : "disabled"} style="min-width:110px"></td>
        <td><input type="number" min="0" step="0.01" class="field-input" data-plan-installment value="" ${isOutright ? "disabled" : "disabled"} style="min-width:110px"></td>
        <td><input type="number" min="1" max="1000" step="1" class="field-input" data-plan-count value="" ${isOutright ? "disabled" : "disabled"} style="min-width:90px"></td>
        <td><input type="number" min="0" max="120" step="1" class="field-input" data-plan-duration value="" ${isOutright ? "disabled" : "disabled"} style="min-width:90px"></td>
        <td><span data-plan-balance style="font-size:11px">—</span></td>
      </tr>`;
  }).join("");

  body.querySelectorAll("tr[data-plan-type]").forEach(row => {
    const type = row.getAttribute("data-plan-type");
    const enabled = row.querySelector("[data-plan-enabled]");
    const total = planInput(row, "total");
    const deposit = planInput(row, "deposit");
    const installment = planInput(row, "installment");
    const count = planInput(row, "count");
    const duration = planInput(row, "duration");

    enabled.addEventListener("change", () => {
      setPlanEnabled(row, enabled.checked);
      if (!enabled.checked) return;
      if (type !== "outright" && !count.value && !duration.value) {
        count.value = 12;
        autoInstallment(row);
      }
      updatePlanBalance(row);
    });
    total.addEventListener("input", () => { autoInstallment(row); updatePlanBalance(row); });
    deposit.addEventListener("input", () => { autoInstallment(row); updatePlanBalance(row); });
    installment.addEventListener("input", () => {
      installment.dataset.manual = "1";
      updatePlanBalance(row);
    });
    count.addEventListener("input", () => {
      delete installment.dataset.manual;
      autoInstallment(row);
      updatePlanBalance(row);
    });
    duration.addEventListener("input", () => {
      if (!count.value) delete installment.dataset.manual;
      autoInstallment(row);
      updatePlanBalance(row);
    });
  });

  const syncBtn = document.getElementById("syncPlanTotalsBtn");
  if (syncBtn) syncBtn.addEventListener("click", () => {
    const price = salePriceValue();
    body.querySelectorAll("tr[data-plan-type]").forEach(row => {
      planInput(row, "total").value = price || "";
      autoInstallment(row);
      updatePlanBalance(row);
    });
  });

  body.querySelectorAll("tr[data-plan-type]").forEach(row => {
    setPlanEnabled(row, row.querySelector("[data-plan-enabled]").checked);
  });
}

function collectPlans() {
  const body = document.getElementById("planEditorBody");
  if (!body) return { plans: [], warning: "Payment plan editor is unavailable." };
  const plans = [];
  const errors = [];
  for (const row of body.querySelectorAll("tr[data-plan-type]")) {
    if (!row.querySelector("[data-plan-enabled]").checked) continue;
    const type = row.getAttribute("data-plan-type");
    const label = PLAN_DEFS.find(def => def.type === type)?.label || type;
    const total = Number(planInput(row, "total").value || 0);
    if (!Number.isFinite(total) || total <= 0) {
      errors.push(`${label}: enter a total price.`);
      continue;
    }
    if (type === "outright") {
      plans.push({
        plan_type: type,
        is_enabled: true,
        total_price: total,
        deposit: 0,
        installment: 0,
        number_of_installments: null,
        duration_months: null
      });
      continue;
    }
    const deposit = Number(planInput(row, "deposit").value || 0);
    const installment = Number(planInput(row, "installment").value || 0);
    let count = Number(planInput(row, "count").value || 0);
    const durationMonths = Number(planInput(row, "duration").value || 0);
    if (!count && durationMonths > 0) count = deriveCount(type, durationMonths);
    if (!Number.isFinite(deposit) || deposit < 0) {
      errors.push(`${label}: deposit is invalid.`);
      continue;
    }
    if (!Number.isFinite(installment) || installment <= 0) {
      errors.push(`${label}: enter a positive instalment amount.`);
      continue;
    }
    if (!count || count < 1) {
      errors.push(`${label}: enter the number of instalments or a duration.`);
      continue;
    }
    const difference = Math.round((total - deposit - installment * count) * 100) / 100;
    if (Math.abs(difference) >= 0.01) {
      errors.push(`${label}: deposit + instalment × count is ${naira(difference)} away from the total.`);
      continue;
    }
    plans.push({
      plan_type: type,
      is_enabled: true,
      total_price: total,
      deposit,
      installment,
      number_of_installments: count,
      duration_months: durationMonths > 0 ? durationMonths : null
    });
  }
  return {
    plans,
    error: errors.length ? errors.join(" ") : "",
    warning: plans.length ? "" : "No plan is enabled. The property will be saved as a draft and cannot be published until you enable one."
  };
}

async function load() {
  await loadCategories();
  await loadBranches();
  const me = await fetchJson("/me");
  if (!me.ok) { window.location.href = "/login.html"; return; }
  const actual = me.data.actual_role || me.data.role;
  if (!["Managing Director", "Super Admin", "Branch Manager"].includes(actual)) {
    document.querySelector("main").innerHTML = "<div class='card'><h2>Read-only access</h2><p>Only the MD, Super Admin or a Branch Manager can create properties.</p></div>";
    return;
  }
  if (["Managing Director", "Super Admin"].includes(actual)) {
    const flags = document.getElementById("adminFlags");
    if (flags) flags.style.display = "";
  }
  renderPlanEditor();
  document.getElementById("sale_price").addEventListener("input", () => {
    const body = document.getElementById("planEditorBody");
    if (!body) return;
    const price = salePriceValue();
    body.querySelectorAll("tr[data-plan-type]").forEach(row => {
      if (!row.querySelector("[data-plan-enabled]").checked) return;
      const total = planInput(row, "total");
      if (!total.value) total.value = price || "";
      autoInstallment(row);
      updatePlanBalance(row);
    });
  });
  document.getElementById("propertyForm").addEventListener("submit", onSubmit);
  document.getElementById("logoutBtn").addEventListener("click", async (e) => {
    e.preventDefault();
    await fetch("/api/logout", { method: "POST", credentials: "include" });
    window.location.href = "/login.html";
  });
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
  const planResult = collectPlans();
  if (planResult.error) { msg.textContent = planResult.error; return; }
  const features = document.getElementById("features").value.split(",").map(s => s.trim()).filter(Boolean);
  const body = {
    title: document.getElementById("title").value,
    description: document.getElementById("description").value.trim(),
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
    available_units: document.getElementById("available_units").value ? Number(document.getElementById("available_units").value) : null,
    total_units: document.getElementById("total_units").value ? Number(document.getElementById("total_units").value) : null,
    features,
    is_featured: document.getElementById("is_featured").checked,
    is_demo: document.getElementById("is_demo") ? document.getElementById("is_demo").checked : false,
    is_internal_test: document.getElementById("is_internal_test") ? document.getElementById("is_internal_test").checked : false,
  };
  const res = await fetchJson("/properties", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) { msg.textContent = res.data.error || "Creation failed"; return; }
  const propertyId = res.data.id;
  if (planResult.plans.length) {
    const planRes = await fetchJson(`/properties/${propertyId}/payment-plans`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plans: planResult.plans })
    });
    if (!planRes.ok) {
      alert(`Property created as a draft, but the plans could not be saved: ${planRes.data.error || "unknown error"}. Fix them on the property page.`);
      window.location.href = "property-details.html?id=" + propertyId;
      return;
    }
  }
  window.location.href = "property-details.html?id=" + propertyId;
}

load();
