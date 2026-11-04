const API = "/api";
const params = new URLSearchParams(window.location.search);
const id = params.get("id");

function money(n) { return "₦" + Number(n).toLocaleString("en-NG"); }

async function fetchJson(path, opts = {}) {
  const res = await fetch(API + path, { credentials: "include", ...opts });
  return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) };
}

async function load() {
  const { data } = await fetchJson("/properties/" + id);
  if (!data.property) { document.body.innerHTML = "<p>Property not found.</p><a href='properties.html'>Back</a>"; return; }
  const p = data.property;
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
