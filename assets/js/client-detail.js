const API = "/api";
const params = new URLSearchParams(window.location.search);
const id = params.get("id");
async function fetchJson(path, opts = {}) {
  const res = await fetch(API + path, { credentials: "include", ...opts });
  return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) };
}
function money(n) { return n != null ? "₦" + Number(n).toLocaleString("en-NG") : "-"; }
async function load() {
  const { data } = await fetchJson("/clients/" + id);
  if (!data.client) { document.body.innerHTML = "<p>Client not found.</p><a href='clients.html'>Back</a>"; return; }
  const c = data.client;
  document.getElementById("refBadge").textContent = c.client_reference;
  document.getElementById("clientName").textContent = c.full_name;
  document.getElementById("clientMeta").textContent = c.phone_number + (c.email_address ? " · " + c.email_address : "") + " · " + (c.branch_name || "");
  document.getElementById("detailRef").textContent = c.client_reference;
  document.getElementById("detailPhone").textContent = c.phone_number;
  document.getElementById("detailEmail").textContent = c.email_address || "-";
  document.getElementById("detailAddress").textContent = c.residential_address || "-";
  document.getElementById("detailStateCity").textContent = [c.state, c.city].filter(Boolean).join(", ");
  document.getElementById("detailStatus").textContent = c.status;
  document.getElementById("detailBranch").textContent = c.branch_name || "-";
  document.getElementById("detailMarketer").textContent = c.original_marketer_name || "-";
  document.getElementById("detailPrice").textContent = money(c.agreed_purchase_price);
  document.getElementById("detailProperty").textContent = c.interested_property_id || "-";
  document.getElementById("statusSelect").value = c.status;
  document.getElementById("saveStatus").onclick = async () => {
    await fetchJson("/clients/" + id + "/status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: document.getElementById("statusSelect").value }) });
    location.reload();
  };

  // Assignment history
  const assignmentHistory = data.assignment_history || data.history;
  if (assignmentHistory) {
    const el = document.getElementById("assignHistoryList");
    el.innerHTML = assignmentHistory.map(h => `
      <div style="padding:6px 0;border-bottom:1px solid var(--line)">
        <div style="font-size:11px;color:var(--muted)">${new Date(h.changed_at).toLocaleString()}</div>
        <div><span style="color:var(--green-dark)">→</span> ${h.new_manager_name || "-"} · ${h.new_branch_id ? h.new_branch_id : "-"}</div>
        <div style="font-size:11px">Authorized by ${h.authorized_by_name || "-"} · ${h.reason || ""}</div>
      </div>`).join("");
  }

  // Status history
  if (data.status_history) {
    const el = document.getElementById("statusHistoryList");
    el.innerHTML = data.status_history.map(h => `
      <div style="padding:6px 0;border-bottom:1px solid var(--line)">
        <div style="font-size:11px;color:var(--muted)">${new Date(h.changed_at).toLocaleString()}</div>
        <div>${h.old_status || "-"} → <strong>${h.new_status}</strong> <span style="color:var(--muted);font-size:11px">by ${h.changed_by_name || "-"}</span></div>
      </div>`).join("");
  }

  // Notes
  if (data.notes) {
    const el = document.getElementById("notesList");
    el.innerHTML = data.notes.map(n => `<div style="padding:6px 0;border-bottom:1px solid var(--line)"><div style="font-size:11px;color:var(--muted)">${new Date(n.created_at).toLocaleString()}</div><div style="padding-left:12px">${n.note}</div></div>`).join("");
  }

  document.getElementById("logoutBtn").addEventListener("click", async (e) => {
    e.preventDefault();
    await fetch("/api/logout", { method: "POST", credentials: "include" });
    window.location.href = "/login.html";
  });
}
load();
