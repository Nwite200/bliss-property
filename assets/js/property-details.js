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
  const canManageAssets = me.ok && ["Managing Director", "Branch Manager"].includes(me.data.role);
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

  document.getElementById("publishBtn").onclick = async () => {
    const res = await fetchJson("/properties/" + id, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ is_published: true }) });
    if (res.ok) { alert("Published"); location.reload(); } else alert(res.data.error || "Failed");
  };

  document.getElementById("logoutBtn").addEventListener("click", async (e) => {
    e.preventDefault();
    await fetch("/api/logout", { method: "POST", credentials: "include" });
    window.location.href = "/login.html";
  });
}

load();
