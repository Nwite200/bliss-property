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
  document.getElementById("clientMeta").textContent = c.phone_number + (c.email_address ? " · " + c.email_address : "") + " · " + (c.branch_name || "") + (c.is_internal_test ? " · TEST CLIENT" : "");
  document.getElementById("detailRef").textContent = c.client_reference;
  document.getElementById("detailPhone").textContent = c.phone_number;
  document.getElementById("detailAltPhone").textContent = c.alternate_phone || "-";
  document.getElementById("detailEmail").textContent = c.email_address || "-";
  document.getElementById("detailAddress").textContent = c.residential_address || "-";
  document.getElementById("detailStateCity").textContent = [c.state, c.city].filter(Boolean).join(", ");
  document.getElementById("detailStatus").textContent = c.status;
  document.getElementById("detailBranch").textContent = c.branch_name || "-";
  document.getElementById("detailMarketer").textContent = c.original_marketer_name || "-";
  document.getElementById("detailReferral").textContent = c.referred_by_name
    ? `${c.referred_by_name} (${c.referred_by_code || "no code"})` : (c.referral_code_used || "-");
  document.getElementById("detailNokName").textContent = c.next_of_kin_name || c.next_of_kin || "-";
  document.getElementById("detailNokPhone").textContent = c.next_of_kin_phone || "-";
  document.getElementById("detailNokRelationship").textContent = c.next_of_kin_relationship || "-";
  document.getElementById("detailNokAddress").textContent = c.next_of_kin_address || "-";
  document.getElementById("detailIdentityType").textContent = c.identity_type || "-";
  document.getElementById("detailIdentityNumber").textContent = c.identity_number_masked || "-";
  document.getElementById("detailBvn").textContent = c.bvn_last4 ? `•••••••${c.bvn_last4}` : "-";
  document.getElementById("detailKycStatus").textContent = c.kyc_status || "pending";
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
  const plan = data.payment_plan;
  if (plan) {
    const planLabel = ({ outright: "Outright", part_payment: "Part payment", daily: "Daily", weekly: "Weekly", bi_monthly: "Bi-monthly", monthly: "Monthly" })[plan.plan_type] || plan.plan_type;
    document.getElementById("planStatus").innerHTML = plan.status === "defaulting" ? '<span class="badge badge-red">Defaulting</span>' : '<span class="badge badge-green">Performing</span>';
    document.getElementById("paymentPlan").innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px">
        <div><span style="color:var(--muted)">Plan type</span><br><strong>${esc(planLabel)}${plan.is_easy_buy ? " · easy buy" : ""}</strong></div>
        <div><span style="color:var(--muted)">Agreed total</span><br><strong>${money(plan.total_agreed_price)}</strong></div>
        <div><span style="color:var(--muted)">Instalment</span><br><strong>${money(plan.installment_amount)}</strong></div>
        <div><span style="color:var(--muted)">Expected to date</span><br><strong>${money((plan.expected_to_date_kobo || 0) / 100)}</strong></div>
        <div><span style="color:var(--muted)">Paid to date</span><br><strong>${money((plan.paid_to_date_kobo || 0) / 100)}</strong></div>
        <div><span style="color:var(--muted)">Amount behind</span><br><strong style="color:${plan.amount_behind_kobo ? "var(--red,#DC2626)" : "var(--green-dark)"}">${money((plan.amount_behind_kobo || 0) / 100)}</strong></div>
        <div><span style="color:var(--muted)">Days overdue</span><br><strong>${plan.days_overdue || 0}</strong></div>
        <div><span style="color:var(--muted)">Grace period</span><br><strong>${plan.grace_days || 0} day(s)</strong></div>
      </div>`;
    const items = plan.expected_items || [];
    document.getElementById("planItemsWrap").style.display = items.length ? "" : "none";
    document.getElementById("planItems").innerHTML = items.map(item => `
      <tr><td>${item.sequence_no}</td><td>${esc(String(item.due_date || "").slice(0, 10))}</td><td>${money((item.amount_kobo || 0) / 100)}</td><td>${esc(item.status)}</td></tr>`).join("");
  } else {
    document.getElementById("planStatus").textContent = "No plan";
    document.getElementById("paymentPlan").innerHTML = '<div class="empty-state">No payment plan has been configured for this client.</div>';
  }

  // Payment account mode and password reset controls
  let me = {};
  try { const meRes = await fetchJson("/me"); if (meRes.ok) me = meRes.data || {}; } catch {}
  const actualRole = me.actual_role || me.role || "";
  const paymentAccount = data.payment_account || { mode: "none" };
  const paMode = document.getElementById("paymentAccountMode");
  const paDetails = document.getElementById("paymentAccountDetails");
  if (paMode) {
    paMode.innerHTML = paymentAccount.mode === "static"
      ? '<span class="badge badge-green">Static wallet</span>'
      : paymentAccount.mode === "dynamic"
        ? `<span class="badge ${paymentAccount.status === "expired" ? "badge-amber" : "badge-green"}">Dynamic account${paymentAccount.status === "expired" ? " · expired" : ""}</span>`
        : '<span class="badge badge-gray">No account yet</span>';
    paDetails.innerHTML = paymentAccount.account_number ? `
      <div><strong>${esc(paymentAccount.bank_name || "Wema Bank")}</strong> · ${esc(paymentAccount.account_name || "")}</div>
      <div style="font-family:monospace;font-size:18px;font-weight:800;color:var(--green-dark)">${esc(paymentAccount.account_number)}</div>
      ${paymentAccount.mode === "dynamic" ? `<div>Amount: <strong>${money(paymentAccount.amount_ngn)}</strong> · Expires: ${paymentAccount.expires_at ? new Date(paymentAccount.expires_at).toLocaleString() : "no expiry supplied"}</div>` : '<div>Permanent account for any amount.</div>'}
    ` : `<div>No static wallet or dynamic account yet. The client can pay without a BVN by generating a one-off account from My Virtual Account.</div>`;
  }

  const finList = document.getElementById("finChangeList");
  if (finList) {
    const requests = Array.isArray(data.financial_change_requests) ? data.financial_change_requests : [];
    finList.innerHTML = requests.length ? requests.map(r => `
      <div style="padding:8px 0;border-bottom:1px solid var(--line)">
        <div><strong>${esc(r.change_type)}</strong> · ${esc(r.status)} · ${new Date(r.created_at).toLocaleString()}</div>
        <div style="font-size:11px">Requested by ${esc(r.requested_by_name || "-")} · Reason: ${esc(r.reason || "")}</div>
        <div style="font-size:11px;font-family:monospace">${esc(r.payload_json || "")}</div>
        ${r.status === "pending" && ["Managing Director", "Super Admin", "Finance Officer", "Head Accountant"].includes(actualRole) ? `<div style="margin-top:6px"><button class="btn btn-green btn-xs" data-approve-fin="${r.id}">Approve</button> <button class="btn btn-danger btn-xs" data-reject-fin="${r.id}">Reject</button></div>` : ""}
      </div>`).join("") : "No financial change requests.";
    finList.querySelectorAll("[data-approve-fin]").forEach(btn => btn.onclick = async () => {
      const id = btn.getAttribute("data-approve-fin");
      const res = await fetchJson(`/financial-change-requests/${id}/approve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      alert(res.ok ? "Approved and applied." : (res.data.error || "Approval failed."));
      if (res.ok) location.reload();
    });
    finList.querySelectorAll("[data-reject-fin]").forEach(btn => btn.onclick = async () => {
      const id = btn.getAttribute("data-reject-fin");
      const reason = prompt("Rejection reason:");
      if (!reason) return;
      const res = await fetchJson(`/financial-change-requests/${id}/reject`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) });
      alert(res.ok ? "Rejected." : (res.data.error || "Rejection failed."));
      if (res.ok) location.reload();
    });
  }
  const finSubmit = document.getElementById("finChangeSubmitBtn");
  if (finSubmit) {
    finSubmit.onclick = async () => {
      const msg = document.getElementById("finChangeMsg");
      const type = document.getElementById("finChangeType").value;
      const reason = document.getElementById("finChangeReason").value.trim();
      const amount = Number(document.getElementById("finChangeAmount").value || 0);
      const installment = Number(document.getElementById("finChangeInstallment").value || 0);
      const count = Number(document.getElementById("finChangeCount").value || 0);
      if (!reason) { msg.textContent = "Enter a reason."; return; }
      const payload = type === "price" ? { agreed_purchase_price: amount }
        : type === "balance" ? { amount }
          : { total_amount: amount, installment_amount: installment || undefined, number_of_installments: count || undefined };
      const res = await fetchJson(`/clients/${id}/financial-change-requests`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ change_type: type, payload, reason })
      });
      msg.textContent = res.ok ? "Request submitted for approval." : (res.data.error || "Unable to submit request.");
      if (res.ok) setTimeout(() => location.reload(), 700);
    };
  }

  const resetBtn = document.getElementById("resetClientBtn");
  const canReset = ["Super Admin", "Managing Director", "Branch Manager", "Customer Care"].includes(actualRole);
  if (resetBtn) {
    resetBtn.style.display = canReset ? "" : "none";
    resetBtn.onclick = async () => {
      const result = document.getElementById("resetPasswordResult");
      const ok = window.confirm(`Reset the password for ${c.full_name} (${c.client_reference})? Confirm their identity from the record first. The temporary password will be shown only once.`);
      if (!ok) return;
      resetBtn.disabled = true;
      resetBtn.textContent = "Resetting…";
      try {
        const res = await fetchJson(`/clients/${id}/reset-password`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ send_sms: document.getElementById("resetSendSms").checked })
        });
        if (!res.ok) {
          result.style.display = "";
          result.textContent = res.data.error || "Unable to reset the password.";
          return;
        }
        result.style.display = "";
        result.innerHTML = `
          <div style="font-weight:800;margin-bottom:6px">Temporary password (shown once)</div>
          <div style="font-family:monospace;font-size:20px;font-weight:800;letter-spacing:1px;background:#fff;border:1px solid #E6C76A;border-radius:6px;padding:10px;word-break:break-all">${esc(res.data.temporary_password)}</div>
          <div style="margin-top:8px">Give this to the client now. They must change it at first login. It cannot be recovered later.</div>
          <div style="margin-top:6px">SMS: ${res.data.sms_sent ? "sent" : "not sent"} (${esc(res.data.sms_reason || "")}).</div>`;
      } catch {
        result.style.display = "";
        result.textContent = "Network error. The password may not have been reset.";
      } finally {
        resetBtn.disabled = false;
        resetBtn.textContent = "Generate temporary password";
      }
    };
  }
  const resetHistory = document.getElementById("resetHistoryList");
  if (resetHistory) {
    const history = Array.isArray(data.password_reset_history) ? data.password_reset_history : [];
    resetHistory.innerHTML = history.length ? history.map(h => {
      const meta = h.metadata || {};
      return `<div style="padding:6px 0;border-bottom:1px solid var(--line)">
        <div>${new Date(h.created_at).toLocaleString()} · <strong>${esc(h.action.replace("client.password_reset.", ""))}</strong></div>
        <div style="font-size:11px">${esc(h.actor_name || "System")}${meta.actor_role ? ` (${esc(meta.actor_role)})` : ""}${meta.sms_sent ? " · SMS sent" : ""}${meta.ip ? ` · ${esc(meta.ip)}` : ""}</div>
      </div>`;
    }).join("") : "No client password resets recorded.";
  }
  const phoneCard = document.getElementById("phoneChangeCard");
  if (phoneCard) {
    const canChangePhone = ["Super Admin", "Managing Director", "Customer Care"].includes(actualRole);
    phoneCard.style.display = canChangePhone ? "" : "none";
    const changeBtn = document.getElementById("changePhoneBtn");
    if (changeBtn) changeBtn.onclick = async () => {
      const msg = document.getElementById("phoneChangeMsg");
      const phone = document.getElementById("newClientPhone").value.trim();
      if (!phone) { msg.textContent = "Enter a new phone number."; return; }
      changeBtn.disabled = true;
      const res = await fetchJson(`/clients/${id}/phone`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone_number: phone, reason: document.getElementById("phoneChangeReason").value.trim() })
      });
      changeBtn.disabled = false;
      msg.textContent = res.ok ? "Phone number changed and audited." : (res.data.error || "Unable to change the phone number.");
      if (res.ok) setTimeout(() => location.reload(), 700);
    };
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

  async function loadStaticWallet() {
    const card = document.getElementById("staticWalletCard");
    if (!card) return;
    const data = await fetchJson("/finance/clients/" + id + "/static-wallet");
    if (!data.ok) { card.style.display = "none"; return; }
    const wallet = data.data.wallet;
    const statusEl = document.getElementById("staticWalletStatus");
    const details = document.getElementById("staticWalletDetails");
    const msg = document.getElementById("staticWalletMessage");
    if (!wallet) {
      statusEl.innerHTML = '<span class="badge badge-gray">Not created</span>';
      details.textContent = "No static wallet yet.";
      document.getElementById("staticWalletValidateWrap").style.display = "none";
      return;
    }
    statusEl.innerHTML = wallet.status === "active"
      ? '<span class="badge badge-green">Active</span>'
      : '<span class="badge badge-amber">OTP pending</span>';
    details.innerHTML = `
      <div><strong>${esc(wallet.account_number || "—")}</strong></div>
      <div>${esc(wallet.account_name || "")} · ${esc(wallet.bank_name || "Wema Bank")}</div>
      <div class="small muted">Wallet reference: ${esc(wallet.wallet_reference || "—")} · ${esc(wallet.payment_mode || "test")} mode</div>`;
    if (wallet.status === "active") {
      document.getElementById("staticWalletInitiateWrap").style.display = "none";
      document.getElementById("staticWalletValidateWrap").style.display = "none";
      msg.textContent = "Permanent account number is active.";
      return;
    }
    document.getElementById("staticWalletInitiateWrap").style.display = "none";
    document.getElementById("staticWalletValidateWrap").style.display = "";
    document.getElementById("staticWalletValidateBtn").onclick = async () => {
      const result = await fetchJson("/finance/clients/" + id + "/static-wallet/validate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ otp: document.getElementById("staticWalletOtp").value.trim() })
      });
      if (!result.ok) { msg.textContent = result.data.error || "Unable to validate wallet"; return; }
      msg.textContent = "Static wallet active.";
      await loadStaticWallet();
    };
  }
  document.getElementById("staticWalletInitiateBtn").onclick = async () => {
    const msg = document.getElementById("staticWalletMessage");
    const bvn = document.getElementById("staticWalletBvn").value.trim();
    if (!bvn) { msg.textContent = "Enter the client BVN."; return; }
    const result = await fetchJson("/finance/clients/" + id + "/static-wallet/initiate", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bvn })
    });
    document.getElementById("staticWalletBvn").value = "";
    if (!result.ok) { msg.textContent = result.data.error || "Unable to create static wallet"; return; }
    msg.textContent = result.data.message || "OTP sent. Enter it below.";
    await loadStaticWallet();
  };
  loadStaticWallet();

  // Identity / KYC review
  const kycBadge = document.getElementById("kycStatusBadge");
  const kycDetails = document.getElementById("kycDetails");
  const kycMessage = document.getElementById("kycMessage");
  const kycState = c.kyc_status || "pending";
  kycBadge.innerHTML = kycState === "verified"
    ? '<span class="badge badge-green">Verified</span>'
    : (kycState === "rejected" ? '<span class="badge badge-red">Rejected</span>' : '<span class="badge badge-amber">Pending review</span>');
  kycDetails.innerHTML = `
    <div><span style="color:var(--muted)">Type:</span> <strong>${esc(c.identity_type || "Not provided")}</strong></div>
    <div><span style="color:var(--muted)">Number:</span> <strong>${esc(c.identity_number_masked || "—")}</strong></div>
    <div><span style="color:var(--muted)">BVN:</span> <strong>${c.bvn_last4 ? "•••••••" + esc(c.bvn_last4) : "Not supplied"}</strong></div>
    <div><span style="color:var(--muted)">Submitted:</span> ${c.kyc_submitted_at ? new Date(c.kyc_submitted_at).toLocaleString() : "—"}</div>
    <div><span style="color:var(--muted)">Reviewed:</span> ${c.kyc_reviewed_at ? new Date(c.kyc_reviewed_at).toLocaleString() : "—"}</div>`;
  document.getElementById("kycNotes").value = c.kyc_notes || "";
  async function reviewKyc(status) {
    kycMessage.textContent = "";
    const notes = document.getElementById("kycNotes").value.trim();
    if (status === "rejected" && !notes) { kycMessage.textContent = "Add a reason before rejecting."; return; }
    const result = await fetchJson("/clients/" + id + "/kyc", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, notes })
    });
    if (!result.ok) { kycMessage.textContent = result.data.error || "Unable to save the review."; return; }
    kycMessage.textContent = status === "verified" ? "Identity approved." : (status === "rejected" ? "Identity rejected." : "Returned to review.");
    setTimeout(() => location.reload(), 700);
  }
  document.getElementById("kycVerifyBtn").onclick = () => reviewKyc("verified");
  document.getElementById("kycRejectBtn").onclick = () => reviewKyc("rejected");

  async function loadClientVerification() {
    const card = document.getElementById("clientVerificationCard");
    if (!card) return;
    const data = await fetchJson("/clients/" + id + "/verification");
    if (!data.ok) { card.style.display = "none"; return; }
    const state = data.data;
    const statusEl = document.getElementById("verificationStatus");
    const msg = document.getElementById("verificationMessage");
    statusEl.innerHTML = state.verification_status === "verified"
      ? '<span class="badge badge-green">Verified</span>'
      : '<span class="badge badge-amber">Unverified</span>';
    const channel = document.getElementById("verificationChannel");
    channel.querySelector('option[value="email"]').disabled = !(state.has_email && state.email_ready);
    channel.querySelector('option[value="sms"]').disabled = !(state.has_phone && state.sms_ready);
    if (!channel.querySelector('option[value="sms"]').disabled) channel.value = "sms";
    else if (!channel.querySelector('option[value="email"]').disabled) channel.value = "email";
    if (state.verification_status === "verified") {
      msg.textContent = `Verified ${state.verified_at ? new Date(state.verified_at).toLocaleString() : ""} via ${state.verification_channel || "OTP"}.`;
      document.getElementById("sendVerificationBtn").disabled = true;
      document.getElementById("verifyClientBtn").disabled = true;
      document.getElementById("verificationCode").disabled = true;
      return;
    }
    msg.textContent = state.active_otp
      ? `Code sent to ${state.active_otp.destination} via ${state.active_otp.channel}.`
      : "No active code. Send one to the client.";
    document.getElementById("sendVerificationBtn").onclick = async () => {
      msg.textContent = "Sending…";
      const result = await fetchJson("/clients/" + id + "/verification/send", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: channel.value })
      });
      if (!result.ok) { msg.textContent = result.data.error || "Unable to send code"; return; }
      msg.textContent = `Code sent to ${result.data.destination} via ${result.data.channel}.`;
    };
    document.getElementById("verifyClientBtn").onclick = async () => {
      const result = await fetchJson("/clients/" + id + "/verification/verify", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: document.getElementById("verificationCode").value.trim() })
      });
      if (!result.ok) { msg.textContent = result.data.error || "Unable to verify"; return; }
      msg.textContent = "Client verified.";
      await loadClientVerification();
    };
  }
  loadClientVerification();

  const meResult = await fetchJson("/me");
  if (meResult.ok && meResult.data.sms_access) {
    const optout = await fetchJson("/clients/" + id + "/sms-optout");
    if (optout.ok) {
      document.getElementById("smsOptOutWrap").style.display = "";
      document.getElementById("smsOptOut").checked = Boolean(optout.data.opted_out);
      document.getElementById("smsOptOut").addEventListener("change", async event => {
        const result = await fetchJson("/clients/" + id + "/sms-optout", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ opted_out: event.target.checked, reason: "Updated from client record" })
        });
        if (!result.ok) { alert(result.data.error || "Unable to update SMS preference"); event.target.checked = !event.target.checked; }
      });
    }
  }

  document.getElementById("logoutBtn").addEventListener("click", async (e) => {
    e.preventDefault();
    await fetch("/api/logout", { method: "POST", credentials: "include" });
    window.location.href = "/login.html";
  });
}
load();
