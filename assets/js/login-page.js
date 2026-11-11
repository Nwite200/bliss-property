/* Bliss Legacy Limited — staff portal login page behaviour. */
(function () {
  "use strict";

  function byId(id) { return document.getElementById(id); }

  function staffLanding(role) {
    return role === "Customer Care"
      ? "/customer-care.html"
      : role === "Sub Admin"
        ? "/sub-admin-dashboard.html"
        : role === "GSM"
          ? "/gsm-dashboard.html"
          : role === "Accountant"
            ? "/accountant-dashboard.html"
            : role === "Head Accountant"
              ? "/finance-dashboard.html"
              : "/dashboard.html?role=" + encodeURIComponent(role || "");
  }

  async function finishStaffLogin() {
    var me = await fetch("/api/me").then(function (response) { return response.json(); });
    window.location.href = staffLanding(me.actual_role || me.role_name || me.role || "");
  }

  function init() {
    var form = byId("loginForm");
    if (!form) return;
    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      var msg = byId("msg");
      var submitBtn = byId("submitBtn");
      msg.textContent = "";
      submitBtn.disabled = true;
      submitBtn.textContent = "Authenticating...";

      try {
        var response = await fetch("/api/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: byId("email").value,
            password: byId("password").value
          })
        });
        var data = await response.json();
        if (!response.ok) {
          msg.textContent = data.error || "Login failed. Please check credentials.";
          submitBtn.disabled = false;
          submitBtn.textContent = "Sign In to Account";
          return;
        }
        // Passkey enrollment is offered after a normal login. It is optional,
        // never forced, and skipped when a password reset is required.
        if (!(data.user && data.user.must_change_password) && window.BlissPasskeys) {
          try { await window.BlissPasskeys.offerEnrollment(); } catch (error) { /* never block login */ }
        }
        await finishStaffLogin();
      } catch (error) {
        msg.textContent = "Server is currently offline. Please try again.";
        submitBtn.disabled = false;
        submitBtn.textContent = "Sign In to Account";
      }
    });

    if (window.BlissPasskeys) {
      window.BlissPasskeys.bindLogin(byId("passkeyLoginBtn"), {
        getIdentifier: function () { return byId("email").value.trim(); },
        onStart: function () { byId("msg").textContent = ""; },
        onError: function (error) { byId("msg").textContent = error.message || "Passkey sign-in failed."; },
        onSuccess: finishStaffLogin,
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
