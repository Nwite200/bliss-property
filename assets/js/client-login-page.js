/* Bliss Legacy Limited — client portal login page behaviour. */
(function () {
  "use strict";

  function byId(id) { return document.getElementById(id); }

  function clientLanding(user) {
    if (user && user.role === "Client") {
      return user.must_change_password ? "/client-profile.html?force=1" : "/client-dashboard.html";
    }
    if (user && user.role === "Finance Officer") return "/finance-dashboard.html";
    return "/dashboard.html";
  }

  function loadBranchContacts() {
    try { if (window.BLISS_CONFIG_READY) return window.BLISS_CONFIG_READY.then(renderBranches, renderBranches); } catch (error) { /* ignore */ }
    renderBranches();
  }

  function renderBranches() {
    var list = byId("branchCareList");
    if (!list) return;
    var branches = window.BLIS_CONFIG && Array.isArray(window.BLIS_CONFIG.branches) ? window.BLIS_CONFIG.branches : [];
    list.innerHTML = branches.length
      ? branches.map(function (branch) {
        return "<div>" + branch.name + (branch.phone
          ? " — <a href=\"tel:" + String(branch.phone).replace(/[^0-9+]/g, "") + "\" style=\"color:var(--green-dark);font-weight:700\">" + branch.phone + "</a>"
          : "") + "</div>";
      }).join("")
      : "<div>" + ((window.BLIS_CONFIG && window.BLIS_CONFIG.phone) || "Please contact customer care.") + "</div>";
  }

  function init() {
    loadBranchContacts();
    var form = byId("clientLoginForm");
    if (!form) return;
    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      var msg = byId("loginMsg");
      var submitBtn = byId("submitBtn");
      msg.textContent = "";
      submitBtn.disabled = true;
      submitBtn.textContent = "Verifying Credentials...";

      var identifier = byId("clientIdentifier").value.trim();
      var password = byId("clientPassword").value;

      try {
        var response = await fetch("/api/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: identifier, password: password })
        });
        var data = await response.json();
        if (!response.ok) {
          msg.textContent = data.error || "Login failed. Please verify your credentials.";
          submitBtn.disabled = false;
          submitBtn.textContent = "Sign In to Portal →";
          return;
        }
        if (!(data.user && data.user.must_change_password) && window.BlissPasskeys) {
          try { await window.BlissPasskeys.offerEnrollment(); } catch (error) { /* never block login */ }
        }
        window.location.href = clientLanding(data.user);
      } catch (error) {
        msg.textContent = "Network communication error. Please try again.";
        submitBtn.disabled = false;
        submitBtn.textContent = "Sign In to Portal →";
      }
    });

    if (window.BlissPasskeys) {
      window.BlissPasskeys.bindLogin(byId("passkeyLoginBtn"), {
        getIdentifier: function () { return byId("clientIdentifier").value.trim(); },
        onStart: function () { byId("loginMsg").textContent = ""; },
        onError: function (error) { byId("loginMsg").textContent = error.message || "Passkey sign-in failed."; },
        onSuccess: function (data) { window.location.href = clientLanding(data.user); },
        unsupported: byId("passkeyUnsupported")
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
