// Bliss Legacy Limited — shared staff shell, API helpers and formatting.
(function () {
  const BlissStaff = window.BlissStaff = window.BlissStaff || {};

  BlissStaff.roles = {
    "Super Admin": "SA",
    "Managing Director": "MD",
    "Project Manager": "PM",
    "Branch Manager": "BM",
    "Team Lead": "TL",
    "Marketer": "MK",
    "Finance Officer": "FIN",
    "Head Accountant": "HA",
    "Customer Care": "CC"
  };

  BlissStaff.isStaffRole = function (role) {
    return ["Super Admin", "Managing Director", "Project Manager", "Branch Manager", "Team Lead", "Marketer", "Finance Officer", "Head Accountant", "Customer Care"].includes(role);
  };

  BlissStaff.fetchJson = async function (path, options = {}) {
    const res = await fetch(path, { credentials: "include", ...options });
    const contentType = res.headers.get("content-type") || "";
    const data = contentType.includes("application/json") ? await res.json() : null;
    if (!res.ok) {
      const error = new Error((data && data.error) || `Request failed (${res.status})`);
      error.status = res.status;
      error.data = data;
      throw error;
    }
    return data;
  };

  BlissStaff.money = function (kobo) {
    const value = Number(kobo || 0) / 100;
    return "₦" + value.toLocaleString("en-NG", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  };

  BlissStaff.moneyNaira = function (naira) {
    return "₦" + Number(naira || 0).toLocaleString("en-NG", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  };

  BlissStaff.escape = function (value) {
    if (value === null || value === undefined) return "";
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  };

  BlissStaff.initials = function (name) {
    return String(name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0].toUpperCase()).join("");
  };

  BlissStaff.formatDate = function (value) {
    if (!value) return "-";
    const raw = String(value).trim();
    const dateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const date = dateOnly
      ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
      : new Date(raw.includes("T") ? raw : raw.replace(" ", "T") + "Z");
    if (isNaN(date.getTime())) return raw.slice(0, 10);
    return date.toLocaleDateString("en-NG", { day: "2-digit", month: "short", year: "numeric" });
  };

  BlissStaff.formatDateTime = function (value) {
    if (!value) return "-";
    const raw = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return BlissStaff.formatDate(raw);
    const date = new Date(raw.includes("T") ? raw : raw.replace(" ", "T") + "Z");
    if (isNaN(date.getTime())) return raw;
    return date.toLocaleString("en-NG", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  BlissStaff.badge = function (text, tone) {
    const map = { green: "badge-green", amber: "badge-amber", red: "badge-red", blue: "badge-blue", gray: "badge-gray", dark: "badge-dark" };
    return `<span class="badge ${map[tone] || "badge-gray"}">${BlissStaff.escape(text)}</span>`;
  };

  BlissStaff.leadBadge = function (status) {
    const tone = status === "Converted" ? "green" : status === "Lost" ? "red" : status === "New Lead" ? "blue" : "amber";
    const dot = status === "New Lead" ? "new" : status === "Contacted" ? "contacted" : status === "Interested" ? "interested" : status === "Inspection Scheduled" ? "inspection" : status === "Negotiation" ? "negotiation" : status === "Converted" ? "converted" : "lost";
    return `<span class="lead-status badge ${tone === "green" ? "badge-green" : tone === "red" ? "badge-red" : tone === "blue" ? "badge-blue" : "badge-amber"}"><span class="status-dot ${dot}"></span>${BlissStaff.escape(status)}</span>`;
  };

  BlissStaff.staffBadge = function (active) {
    return active ? '<span class="badge badge-green">Active</span>' : '<span class="badge badge-gray">Inactive</span>';
  };

  BlissStaff.toast = function (message, isError) {
    let el = document.getElementById("blissToast");
    if (!el) {
      el = document.createElement("div");
      el.id = "blissToast";
      el.className = "toast";
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.className = "toast show" + (isError ? " error" : "");
    clearTimeout(BlissStaff._toastTimer);
    BlissStaff._toastTimer = setTimeout(() => { el.className = "toast"; }, 3800);
  };

  BlissStaff.openModal = function (id) {
    const el = document.getElementById(id);
    if (el) el.classList.add("open");
  };

  BlissStaff.closeModal = function (id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove("open");
  };

  BlissStaff.bindModalClose = function () {
    document.querySelectorAll("[data-close-modal]").forEach(btn => {
      btn.addEventListener("click", () => BlissStaff.closeModal(btn.getAttribute("data-close-modal")));
    });
    document.querySelectorAll(".modal-backdrop").forEach(modal => {
      modal.addEventListener("click", event => {
        if (event.target === modal) modal.classList.remove("open");
      });
    });
  };

  BlissStaff.sidebar = function (me, activePage) {
    const role = me.role;
    const links = [
      { section: "Management" },
      { href: "dashboard.html", label: "📊 Overview", page: "dashboard", roles: ["Managing Director", "Branch Manager", "Team Lead", "Marketer", "Finance Officer"] },
      { href: "performance.html", label: "📈 Performance", page: "performance", roles: ["Managing Director", "Branch Manager", "Team Lead", "Marketer", "Finance Officer"] },
      { href: "revenue.html", label: "💰 Revenue Drill-down", page: "revenue", roles: ["Managing Director", "Branch Manager", "Team Lead", "Marketer", "Finance Officer"] },
      { href: "defaulting.html", label: "⚠️ Defaulting Clients", page: "defaulting", roles: ["Managing Director", "Branch Manager", "Team Lead", "Marketer", "Finance Officer"] },
      { href: "customer-care.html", label: "☎️ Customer Care", page: "care", roles: ["Customer Care"] },
      { href: "sms-center.html", label: "✉️ SMS Centre", page: "sms", roles: ["Managing Director", "Head Accountant", "Branch Manager", "Finance Officer"], requiresSmsAccess: true },
      { href: "properties.html", label: "🏡 Properties", page: "properties", roles: ["Managing Director", "Branch Manager", "Team Lead", "Marketer", "Finance Officer"] },
      { href: "clients.html", label: "👥 Clients", page: "clients", roles: ["Managing Director", "Branch Manager", "Team Lead", "Marketer", "Finance Officer"] },
      { href: "phone-cleanup.html", label: "📞 Phone Cleanup", page: "phone-cleanup", roles: ["Managing Director", "Branch Manager", "Team Lead", "Marketer"] },
      { section: "Sales & Teams" },
      { href: "leads.html", label: "🎯 Lead Pipeline", page: "leads", roles: ["Managing Director", "Branch Manager", "Team Lead", "Marketer"] },
      { href: "staff-management.html", label: "👔 Staff & Teams", page: "staff", roles: ["Managing Director", "Branch Manager"] },
      { href: "activity-centre.html", label: "🕘 Activity Centre", page: "activity", roles: ["Managing Director", "Branch Manager", "Team Lead", "Marketer", "Finance Officer"] },
      { section: "Finance" },
      { href: "commissions.html", label: "💰 Commissions", page: "commissions", roles: ["Managing Director", "Finance Officer", "Branch Manager", "Team Lead", "Marketer"], commissionNav: true },
      { href: "referral-commissions.html", label: "🧾 Referral Commissions", page: "referral-commissions", roles: ["Managing Director", "Finance Officer", "Branch Manager", "Team Lead", "Marketer"], commissionNav: true },
      { href: "reports.html", label: "📄 Financial Reports", page: "reports", roles: ["Managing Director", "Finance Officer", "Branch Manager", "Team Lead", "Marketer"] },
      { href: "finance-dashboard.html", label: "💳 Finance & Ledger", page: "finance", roles: ["Managing Director", "Branch Manager", "Finance Officer"] },
      { href: "provider-config.html", label: "🏦 Payment Provider", page: "provider", roles: ["Managing Director", "Branch Manager", "Finance Officer"] },
      { section: "Communication" },
      { href: "staff-notifications.html", label: "🔔 Notifications", page: "notifications", roles: ["Managing Director", "Branch Manager", "Team Lead", "Marketer", "Finance Officer"] },
      { href: "staff-chat.html", label: "💬 Staff Chat", page: "chat", roles: ["Managing Director", "Branch Manager", "Team Lead", "Marketer", "Finance Officer"] },
      { section: "Account" },
      { href: "index.html", label: "🌐 Public Website", page: "public", roles: ["Managing Director", "Branch Manager", "Team Lead", "Marketer", "Finance Officer"] },
      { href: "#", label: "🚪 Logout", page: "logout", roles: ["Managing Director", "Branch Manager", "Team Lead", "Marketer", "Finance Officer"], id: "logoutBtn" }
    ];
    let items = links.filter(item => (!item.roles || item.roles.includes(role)) &&
      (!item.requiresCommissionAccess || me.can_access_commissions) &&
      (!item.requiresSmsAccess || me.sms_access) &&
      (!item.commissionNav || me.can_access_commissions || ["Marketer", "Team Lead", "Branch Manager"].includes(role))).map(item => {
      if (item.section) return `<div class="section-label">${item.section}</div>`;
      return `<a href="${item.href}" ${item.page === activePage ? 'class="active"' : ""} ${item.id ? `id="${item.id}"` : ""} ${item.page === "logout" ? 'style="color:#E74C3C"' : ""}>${item.label}</a>`;
    }).join("");
    if (["Super Admin", "Managing Director"].includes(me.actual_role || role)) {
      items += `<div class="section-label">System</div><a href="super-admin.html" class="${activePage === "super-admin" ? "active" : ""}">🛡️ System Administration</a>`;
    }
    if (role === "Customer Care") {
      items += `<div class="section-label">Account</div><a href="index.html">🌐 Public Website</a><a href="#" id="logoutBtn" style="color:#E74C3C">🚪 Logout</a>`;
    }
    const scopeLabel = role === "Customer Care"
      ? (me.care_scope === "national" ? "National" : (me.branch_name || "Branch"))
      : (["Managing Director", "Finance Officer", "Head Accountant", "Super Admin"].includes(me.actual_role || role)
        ? "Company-wide"
        : (me.branch_name || "Branch"));
    return `
      <div class="brand"><a href="dashboard.html"><img src="assets/images/bliss-legacy-logo.png" alt="Bliss Legacy" onerror="this.src='bliss-legacy-logo.png'"></a></div>
      ${me.payment_mode === "test" ? '<div style="margin:0 8px 10px;padding:8px;border:1px solid #E0A800;background:#FFF8E1;color:#7A5200;border-radius:7px;font-size:11px;font-weight:800;text-align:center">TEST MODE — no real money</div>' : ""}
      <div style="padding:0 8px 8px;font-size:11px;color:#9FB2A3">${BlissStaff.escape(me.full_name)}<br><span style="color:#6F8575">${BlissStaff.escape(me.actual_role || role)} · ${BlissStaff.escape(scopeLabel)}</span></div>
      ${items}
      <div class="sidebar-note">In-app notifications are active. Email and WhatsApp delivery adapters remain pending provider integration.</div>
    `;
  };

  BlissStaff.initShell = async function (activePage) {
    const sidebar = document.getElementById("sidebar");
    let me;
    try {
      me = await BlissStaff.fetchJson("/api/me");
    } catch {
      window.location.href = "/login.html";
      return null;
    }
    const role = me.role || me.role_name;
    if (!BlissStaff.isStaffRole(role)) {
      window.location.href = "/client-dashboard.html";
      return null;
    }
    me.role = role;
    if (sidebar) {
      sidebar.innerHTML = BlissStaff.sidebar(me, activePage);
      if (!document.querySelector(".sidebar-toggle")) {
        const toggle = document.createElement("button");
        toggle.className = "sidebar-toggle";
        toggle.type = "button";
        toggle.setAttribute("aria-label", "Toggle navigation");
        toggle.textContent = "☰";
        toggle.addEventListener("click", () => sidebar.classList.toggle("open"));
        document.body.appendChild(toggle);
      }
      sidebar.querySelectorAll("a").forEach(link => {
        link.addEventListener("click", () => sidebar.classList.remove("open"));
      });
      const logout = sidebar.querySelector("#logoutBtn");
      if (logout) {
        logout.addEventListener("click", async event => {
          event.preventDefault();
          await fetch("/api/logout", { method: "POST", credentials: "include" });
          window.location.href = "/login.html";
        });
      }
    }
    BlissStaff.bindModalClose();
    return me;
  };

  BlissStaff.statusTone = function (value) {
    const status = String(value || "").toLowerCase();
    if (["active", "verified", "completed", "sold", "converted", "ready", "approved", "paid"].includes(status)) return "green";
    if (["reserved", "pending", "pending approval", "partially paid", "calculated", "negotiation", "inspection scheduled", "interested", "configured"].includes(status)) return "amber";
    if (["failed", "lost", "reversed", "refunded", "rejected", "cancelled", "unavailable", "inactive"].includes(status)) return "red";
    if (["available", "published", "new lead", "contacted", "draft"].includes(status)) return "blue";
    return "gray";
  };

  BlissStaff.query = function () {
    return new URLSearchParams(window.location.search);
  };

  BlissStaff.today = function () {
    return new Date().toISOString().slice(0, 10);
  };

  BlissStaff.daysAgo = function (days) {
    return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  };
})();
