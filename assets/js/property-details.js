const API = "/api";
const params = new URLSearchParams(window.location.search);
const id = params.get("id");

function money(n) { return "₦" + Number(n).toLocaleString("en-NG"); }
function esc(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

async function fetchJson(path, opts = {}) {
  const res = await fetch(API + path, { credentials: "include", ...opts });
  return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) };
}

async function load() {
  const { data } = await fetchJson("/properties/" + id);
  if (!data.property) { document.body.innerHTML = "<p>Property not found.</p><a href='properties.html'>Back</a>"; return; }
  const p = data.property;
  const me = await fetchJson("/me");
  const actual = me.ok ? (me.data.actual_role || me.data.role) : "";
  const inBranch = actual !== "Branch Manager" || (me.ok && Number(p.branch_id) === Number(me.data.branch_id));
  const canManageAssets = me.ok && ["Managing Director", "Super Admin", "Branch Manager"].includes(actual) && inBranch;
  const canApprove = me.ok && ["Managing Director", "Super Admin"].includes(actual);
  const canManagePlans = canManageAssets;
  const canManageFlags = canApprove;
  if (!canManageAssets) {
    const uploads = [document.getElementById("imageUploadControls"), document.getElementById("docUploadControls")];
    uploads.forEach(el => { if (el) el.style.display = "none"; });
  }
  document.getElementById("pageTitle").textContent = p.title;
  document.getElementById("pageSub").textContent = p.reference + " · " + (p.category_name || "") + " · " + (p.branch_name || "");
  document.getElementById("detailTitle").textContent = p.title;
  document.getElementById("detailMeta").textContent = (p.state ? p.state + ", " : "") + (p.city || "") + " · " + money(p.sale_price);
  document.getElementById("detailDesc").textContent = p.description || "No description provided.";
  document.getElementById("detailPrice").textContent = money(p.sale_price);
  document.getElementById("detailStatus").textContent = p.status;
  document.getElementById("detailWorkflow").textContent = String(p.workflow_status || "draft").replace(/_/g, " ");
  document.getElementById("detailUnits").textContent = p.available_units !== null && p.available_units !== undefined
    ? `${p.available_units} available${p.total_units ? " of " + p.total_units : ""}`
    : (p.land_size || "-");
  document.getElementById("detailCategory").textContent = p.category_name || "-";
  document.getElementById("detailBranch").textContent = p.branch_name || "-";
  document.getElementById("detailBeds").textContent = p.bedrooms || "-";
  document.getElementById("detailBaths").textContent = p.bathrooms || "-";
  document.getElementById("detailParking").textContent = p.parking_spaces || "-";
  const feats = p.features ? JSON.parse(p.features) : [];
  const featEl = document.getElementById("detailFeatures");
  featEl.innerHTML = feats.map(f => `<span style="background:#f3f8f4;padding:5px 9px;border-radius:5px;font-size:11px">${f}</span>`).join("");

  // gallery
  const mainImg = document.getElementById("mainImg");
  const thumbs = document.getElementById("galleryThumbs");
  thumbs.innerHTML = "";
  (data.images || []).forEach((img, i) => {
    const thumb = document.createElement("img");
    thumb.src = "/api/files/" + encodeURIComponent(img.r2_key);
    thumb.style.width = "90px"; thumb.style.height = "90px"; thumb.style.objectFit = "cover"; thumb.style.borderRadius = "6px";
    thumb.style.opacity = img.is_main ? "1" : "0.7"; thumb.style.border = img.is_main ? "2px solid var(--green)" : "1px solid var(--line)";
    thumb.onclick = () => { mainImg.src = thumb.src; thumbs.querySelectorAll("img").forEach(x => { x.style.opacity="0.7"; x.style.border="1px solid var(--line)" }); thumb.style.opacity="1"; thumb.style.border="2px solid var(--green)" };
    thumbs.appendChild(thumb);
    if (i === 0) mainImg.src = thumb.src;
  });

  // Media and private document management
  const imageList = document.getElementById("imageList");
  const docList = document.getElementById("docList");
  function renderImages(images) {
    if (!imageList) return;
    if (!images.length) { imageList.innerHTML = "<p>No images uploaded yet.</p>"; return; }
    imageList.innerHTML = images.map(img => `
      <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--line)">
        <img src="/api/files/${encodeURIComponent(img.r2_key)}" alt="" style="width:46px;height:38px;object-fit:cover;border-radius:5px">
        <span style="flex:1">${img.is_main ? "<strong>Main image</strong>" : "Listing image"}</span>
        ${canManageAssets ? `<button class="btn btn-outline btn-sm" data-delete-image="${img.id}" style="padding:3px 8px;font-size:11px">Delete</button>` : ""}
      </div>`).join("");
    imageList.querySelectorAll("[data-delete-image]").forEach(btn => {
      btn.addEventListener("click", async () => {
        if (!confirm("Delete this image from R2 and the property record?")) return;
        const result = await fetchJson(`/properties/${id}/images/${btn.dataset.deleteImage}`, { method: "DELETE" });
        if (!result.ok) { alert(result.data.error || "Unable to delete image."); return; }
        renderImages(images.filter(img => String(img.id) !== btn.dataset.deleteImage));
      });
    });
  }
  function renderDocuments(documents) {
    if (!docList) return;
    if (!documents.length) { docList.innerHTML = "<p>No internal documents uploaded.</p>"; return; }
    docList.innerHTML = documents.map(doc => `
      <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--line)">
        <span style="flex:1">${esc(doc.filename || "Property document")}</span>
        <a class="btn btn-outline btn-sm" href="/api/properties/${id}/documents/${doc.id}/download" style="padding:3px 8px;font-size:11px">Download</a>
        ${canManageAssets ? `<button class="btn btn-outline btn-sm" data-delete-doc="${doc.id}" style="padding:3px 8px;font-size:11px">Delete</button>` : ""}
      </div>`).join("");
    docList.querySelectorAll("[data-delete-doc]").forEach(btn => {
      btn.addEventListener("click", async () => {
        if (!confirm("Delete this private document?")) return;
        const result = await fetchJson(`/properties/${id}/documents/${btn.dataset.deleteDoc}`, { method: "DELETE" });
        if (!result.ok) { alert(result.data.error || "Unable to delete document."); return; }
        renderDocuments(documents.filter(doc => String(doc.id) !== btn.dataset.deleteDoc));
      });
    });
  }
  renderImages(data.images || []);
  renderDocuments(data.documents || []);

  let propertyPlans = data.payment_plans || [];
  function planLabel(type) {
    return ({ outright: "Outright", part_payment: "Part payment", daily: "Daily", weekly: "Weekly", bi_monthly: "Bi-monthly", monthly: "Monthly" })[type] || type;
  }
  function renderPaymentPlans() {
    const tbody = document.getElementById("paymentPlanBody");
    if (!tbody) return;
    if (!propertyPlans.length) {
      tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state">No payment plans configured. Clients will not be able to choose a plan for this property.</div></td></tr>';
      return;
    }
    tbody.innerHTML = propertyPlans.map(plan => `
      <tr>
        <td><strong>${esc(planLabel(plan.plan_type))}</strong>${plan.is_easy_buy ? ' <span class="badge badge-blue">easy buy</span>' : ''}</td>
        <td>${money(plan.total_price_kobo / 100)}</td>
        <td>${money((plan.deposit_kobo || 0) / 100)}</td>
        <td>${money((plan.installment_kobo || 0) / 100)}</td>
        <td>${plan.duration_months ? plan.duration_months + ' month(s)' : '-'}${plan.number_of_installments ? ' · ' + plan.number_of_installments + ' instalment(s)' : ''}${Number(plan.balance_difference_kobo || 0) !== 0 ? `<div class="small" style="color:#B45309;margin-top:4px">Balance difference: ${money(Number(plan.balance_difference_kobo) / 100)}</div>` : ''}${plan.first_payment_rule ? `<div class="small muted" style="margin-top:4px">${esc(plan.first_payment_rule)}</div>` : ''}</td>
        <td>${plan.is_enabled ? '<span class="badge badge-green">Enabled</span>' : '<span class="badge badge-gray">Disabled</span>'}</td>
        <td>${canManagePlans ? `<button class="btn btn-ghost btn-xs" type="button" data-edit-plan="${plan.id}">Edit</button>` : ''}</td>
      </tr>`).join("");
    tbody.querySelectorAll("[data-edit-plan]").forEach(button => {
      button.addEventListener("click", () => openPlanModal(propertyPlans.find(plan => Number(plan.id) === Number(button.getAttribute("data-edit-plan")))));
    });
  }
  function openPlanModal(plan) {
    const editing = Boolean(plan);
    document.getElementById("ppExistingId").value = editing ? plan.id : "";
    document.getElementById("paymentPlanModalTitle").textContent = editing ? "Edit payment plan" : "Add payment plan";
    document.getElementById("ppType").value = editing ? plan.plan_type : "outright";
    document.getElementById("ppType").disabled = editing;
    document.getElementById("ppEnabled").value = editing ? String(plan.is_enabled) : "1";
    document.getElementById("ppTotal").value = editing ? Number(plan.total_price_kobo || 0) / 100 : Number(p.sale_price || 0);
    document.getElementById("ppDeposit").value = editing ? Number(plan.deposit_kobo || 0) / 100 : 0;
    document.getElementById("ppInstallment").value = editing ? Number(plan.installment_kobo || 0) / 100 : 0;
    document.getElementById("ppCount").value = editing && plan.number_of_installments ? plan.number_of_installments : "";
    document.getElementById("ppDuration").value = editing && plan.duration_months ? plan.duration_months : "";
    document.getElementById("ppFirstRule").value = editing ? (plan.first_payment_rule || "") : "";
    document.getElementById("ppNotes").value = editing ? (plan.notes || "") : "";
    document.getElementById("paymentPlanModal").classList.add("open");
  }
  renderPaymentPlans();
  if (canManagePlans) {
    document.getElementById("addPaymentPlanBtn").addEventListener("click", () => openPlanModal(null));
    document.getElementById("paymentPlanForm").addEventListener("submit", async event => {
      event.preventDefault();
      const planType = document.getElementById("ppType").value;
      const payload = {
        plans: [{
          plan_type: planType,
          is_enabled: document.getElementById("ppEnabled").value === "1",
          total_price: Number(document.getElementById("ppTotal").value),
          deposit: Number(document.getElementById("ppDeposit").value || 0),
          installment: Number(document.getElementById("ppInstallment").value || 0),
          duration_months: document.getElementById("ppDuration").value ? Number(document.getElementById("ppDuration").value) : null,
          number_of_installments: document.getElementById("ppCount").value ? Number(document.getElementById("ppCount").value) : null,
          first_payment_rule: document.getElementById("ppFirstRule").value.trim() || null,
          notes: document.getElementById("ppNotes").value.trim() || null
        }]
      };
      const result = await fetchJson(`/properties/${id}/payment-plans`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
      });
      if (!result.ok) { alert(result.data.error || "Unable to save payment plan."); return; }
      const refreshed = await fetchJson(`/properties/${id}/payment-plans?all=1`);
      propertyPlans = refreshed.data.plans || [];
      renderPaymentPlans();
      document.getElementById("paymentPlanModal").classList.remove("open");
    });
  } else {
    document.getElementById("addPaymentPlanBtn").style.display = "none";
  }

  if (canManageAssets) {
    document.getElementById("imageUploadBtn").onclick = async () => {
      const file = document.getElementById("imageFile").files[0];
      const message = document.getElementById("imageMessage");
      if (!file) { message.textContent = "Choose an image first."; return; }
      const form = new FormData();
      form.append("file", file);
      form.append("is_main", document.getElementById("imageIsMain").checked ? "1" : "0");
      const result = await fetchJson(`/properties/${id}/images`, { method: "POST", body: form });
      if (!result.ok) { message.textContent = result.data.error || "Upload failed."; return; }
      location.reload();
    };
    document.getElementById("docUploadBtn").onclick = async () => {
      const file = document.getElementById("docFile").files[0];
      const message = document.getElementById("docMessage");
      if (!file) { message.textContent = "Choose a document first."; return; }
      const form = new FormData();
      form.append("file", file);
      const result = await fetchJson(`/properties/${id}/documents`, { method: "POST", body: form });
      if (!result.ok) { message.textContent = result.data.error || "Upload failed."; return; }
      location.reload();
    };
  }

  // status history
  const histEl = document.getElementById("statusHistory");
  const { data: histData } = await fetchJson("/properties/" + id + "/status-history");
  if (histData.history && histData.history.length) {
    histEl.innerHTML = histData.history.map(h => `<div style="padding:6px 0;border-bottom:1px solid var(--line)"><div style="font-size:11px;color:var(--muted)">${h.changed_at}</div><div>${h.old_status ? h.old_status + " → " : ""}<strong>${h.new_status}</strong> <span style="color:var(--muted);font-size:11px">by ${h.changed_by || "system"}</span></div>`).join("");
  } else {
    histEl.innerHTML = "<p style='color:var(--muted)'>No status history yet.</p>";
  }

  // status select
  const sel = document.getElementById("statusSelect");
  ["Available","Reserved","Sold","Unavailable"].forEach(s => {
    const o = document.createElement("option"); o.value = s; o.textContent = s; if (s === p.status) o.selected = true; sel.appendChild(o);
  });
  document.getElementById("changeStatusBtn").onclick = async () => {
    const res = await fetchJson("/properties/" + id + "/status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: sel.value }) });
    if (res.ok) { alert("Status updated"); location.reload(); } else alert(res.data.error || "Failed");
  };

  const workflow = p.workflow_status || "draft";
  const publishBtn = document.getElementById("publishBtn");
  const approveBtn = document.getElementById("approveBtn");
  const unpublishBtn = document.getElementById("unpublishBtn");
  const archiveBtn = document.getElementById("archiveBtn");
  const convertBtn = document.getElementById("convertBtn");
  const flagsBox = document.getElementById("managementFlags");

  if (!canManageAssets || p.is_archived || workflow === "published" || workflow === "pending_approval") publishBtn.style.display = "none";
  if (canManageAssets && actual === "Branch Manager") publishBtn.textContent = "Submit for approval";
  if (canApprove && workflow === "pending_approval") approveBtn.style.display = "";
  if (canManageAssets && workflow === "published") unpublishBtn.style.display = "";
  if (canManageAssets && !p.is_archived) archiveBtn.style.display = "";
  if (canManageAssets && (p.is_demo || p.is_internal_test)) convertBtn.style.display = "";
  if (canManageFlags) {
    flagsBox.style.display = "";
    document.getElementById("flagDemo").checked = Boolean(p.is_demo);
    document.getElementById("flagInternalTest").checked = Boolean(p.is_internal_test);
    document.getElementById("saveFlagsBtn").onclick = async () => {
      const result = await fetchJson(`/properties/${id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          is_demo: document.getElementById("flagDemo").checked,
          is_internal_test: document.getElementById("flagInternalTest").checked
        })
      });
      if (!result.ok) { alert(result.data.error || "Unable to save flags"); return; }
      location.reload();
    };
  }
  if (!canManageAssets) {
    document.getElementById("statusSelect").style.display = "none";
    document.getElementById("changeStatusBtn").style.display = "none";
  }

  const runWorkflow = async (action) => {
    const result = await fetchJson(`/properties/${id}/${action}`, { method: "POST" });
    if (!result.ok) { alert(result.data.error || "Action failed"); return; }
    location.reload();
  };
  document.getElementById("publishBtn").onclick = async () => {
    const res = await fetchJson(`/properties/${id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_published: true })
    });
    if (!res.ok) { alert(res.data.error || "Failed"); return; }
    if (res.data.workflow_status === "pending_approval") alert("Submitted for MD/Super Admin approval.");
    else alert("Published");
    location.reload();
  };
  document.getElementById("approveBtn").onclick = () => runWorkflow("approve");
  document.getElementById("unpublishBtn").onclick = () => runWorkflow("unpublish");
  document.getElementById("archiveBtn").onclick = () => {
    if (confirm("Archive this property? It will be removed from public listings.")) runWorkflow("archive");
  };
  document.getElementById("convertBtn").onclick = () => {
    if (confirm("Convert this demo/test property into a real property?")) runWorkflow("convert-to-real");
  };

  document.getElementById("logoutBtn").addEventListener("click", async (e) => {
    e.preventDefault();
    await fetch("/api/logout", { method: "POST", credentials: "include" });
    window.location.href = "/login.html";
  });
  document.querySelectorAll("[data-close-modal]").forEach(button => {
    button.addEventListener("click", () => {
      const modal = document.getElementById(button.getAttribute("data-close-modal"));
      if (modal) modal.classList.remove("open");
    });
  });
}

load();
