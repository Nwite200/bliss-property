const API = "/api";
const params = new URLSearchParams(window.location.search);
const id = params.get("id");
async function fetchJson(path, opts = {}) {
  const res = await fetch(API + path, { credentials: "include", ...opts });
  return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) };
}
function money(n) { return n != null ? "₦" + Number(n).toLocaleString("en-NG") : "-"; }
function esc(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
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
  const properties = Array.isArray(data.properties) ? data.properties : [];
  const financials = data.financials || {};
  document.getElementById("detailProperty").textContent = properties.length ? properties[0].title : (c.interested_property_id || "-");

  const portfolio = document.getElementById("propertyPortfolio");
  const summary = document.getElementById("portfolioSummary");
  if (summary) {
    summary.innerHTML = `Contract: <strong>${money(financials.agreed_price_ngn)}</strong><br>
      Verified: <strong style="color:var(--green-dark)">${money(financials.total_verified_ngn)}</strong><br>
      Outstanding: <strong>${money(financials.outstanding_balance_ngn)}</strong>`;
  }
  if (portfolio) {
    if (!properties.length) {
      portfolio.innerHTML = `<p style="color:var(--muted);font-size:13px">No property allocation recorded for this client.</p>`;
    } else {
      portfolio.innerHTML = properties.map(p => `
        <div style="border:1px solid var(--line);border-radius:8px;padding:12px;margin-bottom:10px">
          <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap">
            <div>
              <strong>${esc(p.title)}</strong>
              <div style="font-size:11px;color:var(--muted);margin-top:2px">${esc(p.reference)} · ${esc(p.category_name || "Property")} · ${esc(p.location || "")}</div>
            </div>
            <div style="font-size:11px;color:var(--muted);text-align:right">
              ${p.verified_payments_count || 0} verified payment(s)<br>
              ${p.last_payment_at ? "Last: " + new Date(p.last_payment_at).toLocaleDateString() : "No verified payments"}
            </div>
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin-top:10px;font-size:12px">
            <div><span style="color:var(--muted)">Agreed</span><br><strong>${money(p.agreed_purchase_price)}</strong></div>
            <div><span style="color:var(--muted)">Paid</span><br><strong style="color:var(--green-dark)">${money(p.verified_ngn)}</strong></div>
            <div><span style="color:var(--muted)">Remaining</span><br><strong>${money(p.outstanding_ngn)}</strong></div>
          </div>
          <div style="height:8px;background:var(--line);border-radius:99px;margin-top:10px;overflow:hidden">
            <div style="height:100%;width:${Number(p.progress || 0)}%;background:var(--green)"></div>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--muted);margin-top:4px">
            <span>${esc(p.allocation_status || p.status || "Active")}</span>
            <strong style="color:var(--green-dark)">${Number(p.progress || 0)}% complete</strong>
          </div>
        </div>`).join("");
    }
  }
  document.getElementById("statusSelect").value = c.status;
  document.getElementById("saveStatus").onclick = async () => {
    const result = await fetchJson("/clients/" + id + "/status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: document.getElementById("statusSelect").value }) });
    if (!result.ok) {
      alert(result.data.error || "Unable to update status.");
      return;
    }
    location.reload();
  };

  const addNoteBtn = document.getElementById("addNoteBtn");
  if (addNoteBtn) {
    addNoteBtn.onclick = async () => {
      const input = document.getElementById("noteInput");
      const note = (input.value || "").trim();
      if (!note) { alert("Enter a note first."); return; }
      addNoteBtn.disabled = true;
      const result = await fetchJson("/clients/" + id + "/notes", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note })
      });
      addNoteBtn.disabled = false;
      if (!result.ok) { alert(result.data.error || "Unable to add note."); return; }
      input.value = "";
      location.reload();
    };
  }

  // Assignment history
  const assignmentHistory = data.assignment_history || data.history;
  if (assignmentHistory) {
    const el = document.getElementById("assignHistoryList");
    el.innerHTML = assignmentHistory.map(h => `
      <div style="padding:6px 0;border-bottom:1px solid var(--line)">
        <div style="font-size:11px;color:var(--muted)">${new Date(h.changed_at).toLocaleString()}</div>
        <div><span style="color:var(--green-dark)">→</span> ${esc(h.new_manager_name || "-")} · ${esc(h.new_branch_id || "-")}</div>
        <div style="font-size:11px">Authorized by ${esc(h.authorized_by_name || "-")} · ${esc(h.reason || "")}</div>
      </div>`).join("");
  }

  // Status history
  if (data.status_history) {
    const el = document.getElementById("statusHistoryList");
    el.innerHTML = data.status_history.map(h => `
      <div style="padding:6px 0;border-bottom:1px solid var(--line)">
        <div style="font-size:11px;color:var(--muted)">${new Date(h.changed_at).toLocaleString()}</div>
        <div>${esc(h.old_status || "-")} → <strong>${esc(h.new_status)}</strong> <span style="color:var(--muted);font-size:11px">by ${esc(h.changed_by_name || "-")}</span></div>
      </div>`).join("");
  }

  // Notes
  if (data.notes) {
    const el = document.getElementById("notesList");
    el.innerHTML = data.notes.map(n => `<div style="padding:6px 0;border-bottom:1px solid var(--line)"><div style="font-size:11px;color:var(--muted)">${new Date(n.created_at).toLocaleString()}</div><div style="padding-left:12px">${esc(n.note)}</div></div>`).join("");
  }

  document.getElementById("logoutBtn").addEventListener("click", async (e) => {
    e.preventDefault();
    await fetch("/api/logout", { method: "POST", credentials: "include" });
    window.location.href = "/login.html";
  });
}
load();
