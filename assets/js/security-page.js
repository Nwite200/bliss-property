/* Bliss Legacy Limited — Security & Devices page. */
(function () {
  "use strict";

  var state = {
    me: null,
    passkeys: [],
    renameTarget: null,
    removeTarget: null
  };

  function byId(id) { return document.getElementById(id); }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatDate(value) {
    if (!value) return "Never";
    var raw = String(value);
    if (!/[zZ]$|[+-]\d\d:\d\d$/.test(raw)) raw = raw.replace(" ", "T") + "Z";
    var date = new Date(raw);
    if (isNaN(date.getTime())) return String(value);
    return date.toLocaleString("en-NG", {
      day: "numeric", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit"
    });
  }

  function transportLabel(value) {
    var map = {
      internal: "This device",
      hybrid: "Phone or tablet",
      usb: "Security key (USB)",
      nfc: "Security key (NFC)",
      ble: "Bluetooth authenticator",
      "smart-card": "Smart card"
    };
    return map[value] || String(value);
  }

  function setStatus(message, tone) {
    var node = byId("passkeyStatus");
    if (!node) return;
    node.className = "pk-status pk-status-left" + (tone ? " pk-" + tone : "");
    node.textContent = message || "";
  }

  function setModalStatus(id, message, tone) {
    var node = byId(id);
    if (!node) return;
    node.className = "pk-status" + (tone ? " pk-" + tone : "");
    node.textContent = message || "";
  }

  function openModal(id) {
    var node = byId(id);
    if (node) node.classList.add("open");
  }

  function closeModal(id) {
    var node = byId(id);
    if (node) node.classList.remove("open");
    var status = id === "renamePasskeyModal" ? "renamePasskeyStatus" : id === "removePasskeyModal" ? "removePasskeyStatus" : null;
    if (status) setModalStatus(status, "");
  }

  window.closeModal = closeModal;

  function renderClientSidebar(me) {
    var sidebar = byId("sidebar");
    if (!sidebar) return;
    sidebar.innerHTML =
      '<div class="brand"><a href="client-dashboard.html"><img src="assets/images/bliss-legacy-logo.png" alt="Bliss Legacy" data-fallback-src="bliss-legacy-logo.png"></a></div>' +
      '<div style="padding:0 8px 8px;font-size:11px;color:#9FB2A3">' + escapeHtml(me.full_name || "Client") +
        '<br><span style="color:#6F8575">Client account</span></div>' +
      '<div class="section-label">Client Workspace</div>' +
      '<a href="client-dashboard.html">📊 Overview</a>' +
      '<a href="client-property.html">🏡 My Property</a>' +
      '<a href="client-payments.html">💳 Payment History</a>' +
      '<a href="client-virtual-account.html">🏦 My Virtual Account</a>' +
      '<a href="client-receipts.html">📄 Receipts</a>' +
      '<a href="client-notifications.html">🔔 Notifications</a>' +
      '<a href="client-profile.html">👤 Profile</a>' +
      '<a href="security.html" class="active">🔐 Security &amp; Devices</a>' +
      '<div class="section-label" style="margin-top:auto">Actions</div>' +
      '<a href="index.html">🌐 Public Website</a>' +
      '<a href="#" id="logoutBtn" style="color:#E74C3C">🚪 Sign Out</a>';

    if (!document.querySelector(".sidebar-toggle")) {
      var toggle = document.createElement("button");
      toggle.className = "sidebar-toggle";
      toggle.type = "button";
      toggle.setAttribute("aria-label", "Toggle navigation");
      toggle.textContent = "☰";
      toggle.addEventListener("click", function () { sidebar.classList.toggle("open"); });
      document.body.appendChild(toggle);
    }
    sidebar.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", function () { sidebar.classList.remove("open"); });
    });
    var logout = sidebar.querySelector("#logoutBtn");
    if (logout) {
      logout.addEventListener("click", async function (event) {
        event.preventDefault();
        await fetch("/api/logout", { method: "POST", credentials: "include" });
        window.location.href = "/client-login.html";
      });
    }
  }

  function deviceCard(passkey) {
    var synced = String(passkey.device_type || "") === "multiDevice";
    var transports = Array.isArray(passkey.transports)
      ? passkey.transports.map(transportLabel)
      : [];
    return '<article class="pk-device">' +
      '<div class="pk-device-main">' +
        '<div class="pk-device-title">' +
          '<span>' + escapeHtml(passkey.credential_name || "This device") + '</span>' +
          '<span class="pk-badge ' + (synced ? "pk-badge-blue" : "pk-badge-green") + '">' +
            (synced ? "Synced passkey" : "Single device") + '</span>' +
          (passkey.backed_up ? '<span class="pk-badge pk-badge-amber">Backed up</span>' : '') +
        '</div>' +
        '<div class="pk-device-meta">' +
          '<span>Added ' + escapeHtml(formatDate(passkey.created_at)) + '</span>' +
          '<span>Last used ' + escapeHtml(formatDate(passkey.last_used_at)) + '</span>' +
          (transports.length ? '<span>' + escapeHtml(transports.join(" · ")) + '</span>' : '') +
        '</div>' +
      '</div>' +
      '<div class="pk-device-actions">' +
        '<button class="btn btn-outline btn-sm" type="button" data-passkey-action="rename" data-passkey-id="' + escapeHtml(passkey.id) + '">Rename</button>' +
        '<button class="btn btn-danger btn-sm" type="button" data-passkey-action="remove" data-passkey-id="' + escapeHtml(passkey.id) + '">Remove</button>' +
      '</div>' +
    '</article>';
  }

  function renderList() {
    var list = byId("passkeyList");
    if (!list) return;
    if (!state.passkeys.length) {
      list.innerHTML =
        '<div class="pk-empty">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4"/><path d="M14 13.12c0 2.38 0 6.38-1 8.88"/><path d="M17.29 21.02c.12-.6.43-2.3.5-3.02"/><path d="M2 12a10 10 0 0 1 18-6"/><path d="M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2"/><path d="M8.65 22c.21-.66.45-1.32.57-2"/><path d="M9 6.8a6 6 0 0 1 9 5.2v2"/></svg>' +
          '<h4>No passkeys yet</h4>' +
          '<p>Add this device to sign in with fingerprint, Face ID, Windows Hello or your device PIN. Your password still works and remains your recovery method.</p>' +
        '</div>';
      return;
    }
    list.innerHTML = state.passkeys.map(deviceCard).join("");
  }

  async function loadPasskeys() {
    if (!window.BlissPasskeys) return;
    try {
      state.passkeys = await window.BlissPasskeys.list();
      renderList();
      setStatus(state.passkeys.length ? "" : "", "");
    } catch (error) {
      byId("passkeyList").innerHTML = '<div class="empty-state">Could not load your passkeys. Refresh the page to try again.</div>';
      setStatus(error.message || "Could not load your passkeys.", "error");
    }
  }

  function openRename(passkey) {
    state.renameTarget = passkey;
    byId("renamePasskeyName").value = passkey.credential_name || "";
    setModalStatus("renamePasskeyStatus", "");
    openModal("renamePasskeyModal");
    setTimeout(function () {
      var input = byId("renamePasskeyName");
      if (input) { input.focus(); input.select(); }
    }, 30);
  }

  function openRemove(passkey) {
    state.removeTarget = passkey;
    byId("removePasskeyPassword").value = "";
    setModalStatus("removePasskeyStatus", "");
    var warning = byId("removePasskeyWarning");
    if (warning) {
      warning.textContent = state.passkeys.length <= 1
        ? "This is your only passkey. Removing it will leave password sign-in as your only method until you add another device. Make sure you know your password and can access your recovery email or phone."
        : "This device will no longer be able to sign in with a passkey. You can still use your password and add the device again later.";
    }
    openModal("removePasskeyModal");
    setTimeout(function () {
      var input = byId("removePasskeyPassword");
      if (input) input.focus();
    }, 30);
  }

  async function saveRename() {
    if (!state.renameTarget || !window.BlissPasskeys) return;
    var input = byId("renamePasskeyName");
    var name = String(input.value || "").trim();
    if (!name) {
      setModalStatus("renamePasskeyStatus", "Enter a device name.", "error");
      input.focus();
      return;
    }
    var button = byId("savePasskeyNameBtn");
    button.disabled = true;
    setModalStatus("renamePasskeyStatus", "Saving…", "");
    try {
      await window.BlissPasskeys.rename(state.renameTarget.id, name);
      state.renameTarget.credential_name = name;
      renderList();
      closeModal("renamePasskeyModal");
      setStatus("Device name updated.", "success");
    } catch (error) {
      setModalStatus("renamePasskeyStatus", error.message || "Could not rename this device.", "error");
    } finally {
      button.disabled = false;
    }
  }

  async function confirmRemove() {
    if (!state.removeTarget || !window.BlissPasskeys) return;
    var input = byId("removePasskeyPassword");
    var password = String(input.value || "");
    if (!password) {
      setModalStatus("removePasskeyStatus", "Enter your current password to remove this passkey.", "error");
      input.focus();
      return;
    }
    var button = byId("confirmRemovePasskeyBtn");
    button.disabled = true;
    setModalStatus("removePasskeyStatus", "Removing passkey…", "");
    try {
      await window.BlissPasskeys.remove(state.removeTarget.id, password);
      state.passkeys = state.passkeys.filter(function (item) {
        return String(item.id) !== String(state.removeTarget.id);
      });
      state.removeTarget = null;
      renderList();
      closeModal("removePasskeyModal");
      setStatus("Passkey removed. You can still sign in with your password.", "success");
    } catch (error) {
      setModalStatus("removePasskeyStatus", error.message || "Could not remove this passkey.", "error");
    } finally {
      button.disabled = false;
    }
  }

  function bindEvents() {
    var addButton = byId("addPasskeyBtn");
    if (addButton && window.BlissPasskeys) {
      if (!window.BlissPasskeys.supported()) {
        addButton.disabled = true;
        var note = byId("passkeyUnsupported");
        if (note) note.hidden = false;
      } else {
        addButton.addEventListener("click", async function () {
          addButton.disabled = true;
          setStatus("Opening your device security prompt…", "");
          try {
            var result = await window.BlissPasskeys.offerEnrollment({ force: true });
            if (result && result.registered) {
              setStatus("Passkey added to this device.", "success");
              await loadPasskeys();
            } else {
              setStatus("");
            }
          } catch (error) {
            setStatus(error.message || "Could not add a passkey to this device.", "error");
          } finally {
            addButton.disabled = false;
          }
        });
      }
    }

    var list = byId("passkeyList");
    if (list) {
      list.addEventListener("click", function (event) {
        var button = event.target.closest("[data-passkey-action]");
        if (!button) return;
        var id = button.getAttribute("data-passkey-id");
        var passkey = state.passkeys.find(function (item) { return String(item.id) === String(id); });
        if (!passkey) return;
        if (button.getAttribute("data-passkey-action") === "rename") openRename(passkey);
        if (button.getAttribute("data-passkey-action") === "remove") openRemove(passkey);
      });
    }

    var saveName = byId("savePasskeyNameBtn");
    if (saveName) saveName.addEventListener("click", saveRename);
    var renameInput = byId("renamePasskeyName");
    if (renameInput) {
      renameInput.addEventListener("keydown", function (event) {
        if (event.key === "Enter") { event.preventDefault(); saveRename(); }
      });
    }

    var confirm = byId("confirmRemovePasskeyBtn");
    if (confirm) confirm.addEventListener("click", confirmRemove);
    var passwordInput = byId("removePasskeyPassword");
    if (passwordInput) {
      passwordInput.addEventListener("keydown", function (event) {
        if (event.key === "Enter") { event.preventDefault(); confirmRemove(); }
      });
    }

    document.querySelectorAll(".modal-backdrop").forEach(function (modal) {
      modal.addEventListener("click", function (event) {
        if (event.target === modal) closeModal(modal.id);
      });
    });
    document.addEventListener("keydown", function (event) {
      if (event.key !== "Escape") return;
      closeModal("renamePasskeyModal");
      closeModal("removePasskeyModal");
    });
  }

  async function init() {
    var me;
    try {
      var response = await fetch("/api/me", { credentials: "include" });
      if (!response.ok) throw new Error("unauthenticated");
      me = await response.json();
    } catch (error) {
      window.location.href = "/login.html";
      return;
    }
    state.me = me;
    var role = me.role || "";
    if (window.BlissStaff && window.BlissStaff.isStaffRole(role)) {
      await window.BlissStaff.initShell("security");
    } else if (role === "Client") {
      renderClientSidebar(me);
    } else {
      window.location.href = "/login.html";
      return;
    }
    bindEvents();
    await loadPasskeys();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
