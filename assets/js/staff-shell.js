// Bliss Legacy Limited — shared staff shell, API helpers and formatting.
(function () {
  const BlissStaff = window.BlissStaff = window.BlissStaff || {};

  BlissStaff.roles = {
    "Super Admin": "SA",
    "Managing Director": "MD",
    "Sub Admin": "SUB",
    "GSM": "GSM",
    "Accountant": "ACC",
    "Project Manager": "PM",
    "Branch Manager": "BM",
    "Team Lead": "TL",
    "Marketer": "MK",
    "Finance Officer": "FIN",
    "Head Accountant": "HA",
    "Customer Care": "CC"
  };

  BlissStaff.isStaffRole = function (role) {
    // Any authenticated role other than a client is staff. This keeps newly
    // added future roles working without a frontend code change.
    return Boolean(role) && role !== "Client";
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

  const NAV_ICON_PATHS = {
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    clipboard: '<path d="M9 4h6l1 2h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2l1-2Z"/><path d="M9 4v2h6V4"/><path d="m9 14 2 2 4-4"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    home: '<path d="m3 10 9-7 9 7"/><path d="M5 9v11h14V9"/><path d="M9 20v-6h6v6"/>',
    target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2"/>',
    briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M3 12h18"/>',
    card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h8"/>',
    coins: '<circle cx="8" cy="8" r="5"/><path d="M18.09 10.37A6 6 0 1 1 10.34 18"/><path d="M7 6h1v4"/><path d="m16.71 13.88.7.71-2.82 2.82"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/>',
    bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
    chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a15 15 0 0 1 0 18"/><path d="M12 3a15 15 0 0 0 0 18"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
    settings: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3"/><path d="M1 14h6M9 8h6M17 16h6"/>',
    phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92Z"/>',
    alert: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    chart: '<path d="M3 3v18h18"/><path d="m7 14 4-4 3 3 5-6"/>'
  };

  BlissStaff.icon = function (name, size) {
    const dimension = Number(size) || 18;
    const path = NAV_ICON_PATHS[name] || NAV_ICON_PATHS.grid;
    return `<svg class="nav-icon" width="${dimension}" height="${dimension}" viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`;
  };

  BlissStaff.sidebar = function (me, activePage) {
    const role = me.role;
    const actualRole = me.actual_role || role;
    const caps = me.capabilities || {};
    const isOwner = ["Super Admin", "Managing Director"].includes(actualRole) || caps.owner === true;
    const financeRoles = ["Managing Director", "Super Admin", "Sub Admin", "Finance Officer", "Head Accountant", "Branch Manager", "Accountant"];
    const clientRoles = ["Managing Director", "Super Admin", "Sub Admin", "Branch Manager", "Team Lead", "Marketer", "Finance Officer", "Accountant"];
    const reportsRoles = ["Managing Director", "Super Admin", "Sub Admin", "Finance Officer", "Branch Manager", "Team Lead", "Marketer"];
    const canOperations = isOwner || actualRole === "Sub Admin" || Boolean(caps.operations);

    const groups = [
      {
        label: "Overview",
        links: [
          { href: "dashboard.html", label: "Overview", page: "dashboard", icon: "grid", show: role !== "Client" && actualRole !== "Customer Care" },
          { href: "gsm-dashboard.html", label: "GSM Dashboard", page: "gsm", icon: "target", show: actualRole === "GSM" },
          { href: "accountant-dashboard.html", label: "Accountant", page: "accountant", icon: "chart", show: actualRole === "Accountant" },
          { href: "customer-care.html", label: "Customer Care", page: "care", icon: "phone", show: actualRole === "Customer Care" },
          { href: "performance.html", label: "Performance", page: "performance", icon: "chart", show: ["Managing Director", "Super Admin", "Sub Admin", "Branch Manager", "Team Lead", "Marketer", "Finance Officer", "Head Accountant"].includes(role) },
          { href: "activity-centre.html", label: "Activity Centre", page: "activity", icon: "clock", show: true }
        ]
      },
      {
        label: "Approvals",
        links: [
          { href: "sub-admin-dashboard.html", label: "Operations & Approvals", page: "sub-admin", icon: "clipboard", show: canOperations }
        ]
      },
      {
        label: "Clients & Properties",
        links: [
          { href: "properties.html", label: "Properties", page: "properties", icon: "home", show: Boolean(caps.properties_manage) || ["Managing Director", "Super Admin", "Sub Admin", "Branch Manager", "Team Lead", "Marketer", "Finance Officer", "Project Manager"].includes(role) },
          { href: "clients.html", label: "Clients", page: "clients", icon: "users", show: Boolean(caps.clients_view) || clientRoles.includes(role) },
          { href: "defaulting.html", label: "Defaulting Clients", page: "defaulting", icon: "alert", show: Boolean(caps.finance_view) || financeRoles.includes(role) || ["Team Lead", "Marketer"].includes(role) },
          { href: "phone-cleanup.html", label: "Phone Cleanup", page: "phone-cleanup", icon: "phone", show: Boolean(caps.clients_edit) || ["Managing Director", "Super Admin", "Sub Admin", "Branch Manager", "Team Lead", "Marketer"].includes(role) },
          { href: "sms-center.html", label: "SMS Centre", page: "sms", icon: "chat", show: Boolean(caps.sms_access) || Boolean(me.sms_access) }
        ]
      },
      {
        label: "Sales & Teams",
        links: [
          { href: "leads.html", label: "Lead Pipeline", page: "leads", icon: "target", show: Boolean(caps.leads_manage) || ["Managing Director", "Super Admin", "Sub Admin", "Branch Manager", "Team Lead", "Marketer"].includes(role) },
          { href: "staff-management.html", label: "Staff & Teams", page: "staff", icon: "briefcase", show: Boolean(caps.staff_manage) || ["Managing Director", "Super Admin", "Sub Admin", "Branch Manager"].includes(role) },
          { href: "revenue.html", label: "Revenue Drill-down", page: "revenue", icon: "chart", show: Boolean(caps.finance_view) || financeRoles.includes(role) || ["Team Lead", "Marketer"].includes(role) }
        ]
      },
      {
        label: "Finance",
        links: [
          { href: "commissions.html", label: "Commissions", page: "commissions", icon: "coins", show: Boolean(caps.commissions_view) || me.can_access_commissions || actualRole === "Sub Admin" || ["Marketer", "Team Lead", "Branch Manager", "Accountant"].includes(role) },
          { href: "finance-dashboard.html", label: "Finance & Ledger", page: "finance", icon: "card", show: Boolean(caps.finance_view) || financeRoles.includes(role) },
          { href: "provider-config.html", label: "Payment Provider", page: "provider", icon: "settings", show: isOwner || ["Finance Officer", "Branch Manager"].includes(actualRole) }
        ]
      },
      {
        label: "Reports",
        links: [
          { href: "reports.html", label: "Financial Reports", page: "reports", icon: "file", show: Boolean(caps.reports_view) || reportsRoles.includes(role) }
        ]
      },
      {
        label: "Account",
        links: [
          { href: "staff-notifications.html", label: "Notifications", page: "notifications", icon: "bell", show: true },
          { href: "staff-chat.html", label: "Staff Chat", page: "chat", icon: "chat", show: true },
          { href: "security.html", label: "Security & Devices", page: "security", icon: "shield", show: true },
          { href: "index.html", label: "Public Website", page: "public", icon: "globe", show: true },
          { href: "#", label: "Logout", page: "logout", icon: "logout", id: "logoutBtn", show: true }
        ]
      }
    ];

    if (isOwner) {
      groups.push({
        label: "System",
        links: [
          { href: "super-admin.html", label: "System Administration", page: "super-admin", icon: "shield", show: true },
          { href: "permissions.html", label: "Permissions", page: "permissions", icon: "settings", show: true }
        ]
      });
    }

    const items = groups.map(group => {
      const visible = group.links.filter(link => link.show);
      if (!visible.length) return "";
      const linksHtml = visible.map(link => {
        const isActive = link.page === activePage ||
          (link.page === "commissions" && activePage === "referral-commissions");
        return `
        <a href="${link.href}" ${isActive ? 'class="active"' : ""} ${link.id ? `id="${link.id}"` : ""} ${link.page === "logout" ? 'style="color:#F87171"' : ""}>
          ${BlissStaff.icon(link.icon)}<span>${link.label}</span>
        </a>`;
      }).join("");
      return `<div class="section-label">${group.label}</div>${linksHtml}`;
    }).join("");

    const scopeLabel = actualRole === "Customer Care"
      ? (me.care_scope === "national" ? "National" : (me.branch_name || "Branch"))
      : (["Managing Director", "Finance Officer", "Head Accountant", "Super Admin", "Sub Admin"].includes(actualRole)
        ? "Company-wide"
        : (me.branch_name || "Branch"));
    return `
      <div class="brand"><a href="dashboard.html"><img src="assets/images/bliss-legacy-logo.png" alt="Bliss Legacy" data-fallback-src="bliss-legacy-logo.png"></a></div>
      ${me.payment_mode === "test" ? '<div style="margin:0 8px 10px;padding:8px;border:1px solid #E0A800;background:#FFF8E1;color:#7A5200;border-radius:7px;font-size:11px;font-weight:800;text-align:center">TEST MODE — no real money</div>' : ""}
      <div style="padding:0 8px 8px;font-size:11px;color:#9FB2A3">${BlissStaff.escape(me.full_name)}<br><span style="color:#6F8575">${BlissStaff.escape(actualRole)} · ${BlissStaff.escape(scopeLabel)}</span></div>
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
