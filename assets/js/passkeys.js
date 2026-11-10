/* Bliss Legacy Limited — browser passkey (WebAuthn) flows.
   Native browser WebAuthn only. No biometric data ever reaches Bliss Legacy:
   the authenticator keeps the private key and we store the public key. */
(function () {
  "use strict";

  var FINGERPRINT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4"/><path d="M14 13.12c0 2.38 0 6.38-1 8.88"/><path d="M17.29 21.02c.12-.6.43-2.3.5-3.02"/><path d="M2 12a10 10 0 0 1 18-6"/><path d="M2 16h.01"/><path d="M21.8 16c.2-2 .131-5.354 0-6"/><path d="M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2"/><path d="M8.65 22c.21-.66.45-1.32.57-2"/><path d="M9 6.8a6 6 0 0 1 9 5.2v2"/></svg>';

  function bytesToBase64Url(value) {
    var bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
    var binary = "";
    for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function base64UrlToBytes(value) {
    var raw = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
    var padded = raw + "=".repeat((4 - (raw.length % 4)) % 4);
    var binary = atob(padded);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function supported() {
    return Boolean(
      window.PublicKeyCredential &&
      window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable &&
      navigator.credentials &&
      typeof navigator.credentials.create === "function" &&
      typeof navigator.credentials.get === "function"
    );
  }

  async function platformAvailable() {
    if (!supported()) return false;
    try {
      return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    } catch (error) {
      return false;
    }
  }

  function detectDeviceName() {
    var ua = navigator.userAgent || "";
    var platform = "This device";
    if (/iPhone/i.test(ua)) platform = "iPhone";
    else if (/iPad/i.test(ua)) platform = "iPad";
    else if (/Android/i.test(ua)) platform = /Mobile/i.test(ua) ? "Android phone" : "Android tablet";
    else if (/Macintosh|Mac OS X/i.test(ua)) platform = "Mac";
    else if (/Windows/i.test(ua)) platform = "Windows PC";
    else if (/CrOS/i.test(ua)) platform = "Chromebook";
    else if (/Linux/i.test(ua)) platform = "Linux device";

    var browser = "";
    if (/Edg\//i.test(ua)) browser = "Edge";
    else if (/OPR\//i.test(ua)) browser = "Opera";
    else if (/Firefox\//i.test(ua)) browser = "Firefox";
    else if (/Chrome\//i.test(ua)) browser = "Chrome";
    else if (/Safari\//i.test(ua)) browser = "Safari";
    return browser ? platform + " · " + browser : platform;
  }

  function passkeyError(error) {
    var name = error && error.name ? String(error.name) : "";
    if (name === "NotAllowedError" || name === "AbortError") {
      return new Error("Passkey setup was cancelled or timed out. You can try again, or keep using your password.");
    }
    if (name === "InvalidStateError") {
      return new Error("This device already has a passkey for this account.");
    }
    if (name === "NotSupportedError") {
      return new Error("This browser or device does not support passkeys. Try a supported browser, or keep using your password.");
    }
    if (name === "SecurityError") {
      return new Error("Passkeys require the secure Bliss Legacy domain. Use the HTTPS production site and try again.");
    }
    return new Error((error && error.message) || "Passkey request failed. Please try again.");
  }

  async function api(path, options) {
    options = options || {};
    var headers = Object.assign({ "Content-Type": "application/json" }, options.headers || {});
    var response = await fetch(path, Object.assign({ credentials: "include" }, options, { headers: headers }));
    var data = {};
    try { data = await response.json(); } catch (error) { /* non-JSON error body */ }
    if (!response.ok) {
      var failure = new Error(data.error || "Request failed. Please try again.");
      failure.status = response.status;
      throw failure;
    }
    return data;
  }

  function decodeCreationOptions(options) {
    var publicKey = Object.assign({}, options);
    publicKey.challenge = base64UrlToBytes(options.challenge);
    publicKey.user = Object.assign({}, options.user, { id: base64UrlToBytes(options.user.id) });
    if (Array.isArray(options.excludeCredentials)) {
      publicKey.excludeCredentials = options.excludeCredentials.map(function (item) {
        return Object.assign({}, item, { id: base64UrlToBytes(item.id) });
      });
    }
    return publicKey;
  }

  function decodeRequestOptions(options) {
    var publicKey = Object.assign({}, options);
    publicKey.challenge = base64UrlToBytes(options.challenge);
    if (Array.isArray(options.allowCredentials)) {
      publicKey.allowCredentials = options.allowCredentials.map(function (item) {
        return Object.assign({}, item, { id: base64UrlToBytes(item.id) });
      });
    }
    return publicKey;
  }

  function credentialToJSON(credential) {
    var response = credential.response || {};
    var json = {
      id: credential.id,
      rawId: bytesToBase64Url(credential.rawId),
      type: credential.type || "public-key",
      clientExtensionResults: typeof credential.getClientExtensionResults === "function"
        ? credential.getClientExtensionResults()
        : {},
      response: {}
    };
    if (credential.authenticatorAttachment) json.authenticatorAttachment = credential.authenticatorAttachment;
    if (response.clientDataJSON) json.response.clientDataJSON = bytesToBase64Url(response.clientDataJSON);
    if (response.attestationObject) json.response.attestationObject = bytesToBase64Url(response.attestationObject);
    if (response.authenticatorData) json.response.authenticatorData = bytesToBase64Url(response.authenticatorData);
    if (response.signature) json.response.signature = bytesToBase64Url(response.signature);
    if (response.userHandle) json.response.userHandle = bytesToBase64Url(response.userHandle);
    if (typeof response.getTransports === "function") {
      try { json.response.transports = response.getTransports(); } catch (error) { /* ignore */ }
    }
    return json;
  }

  async function register(options) {
    options = options || {};
    if (!supported()) throw new Error("Passkeys are not supported in this browser.");
    var name = String(options.name || "").trim().slice(0, 60) || detectDeviceName();
    var start = await api("/api/passkey/register/options", { method: "POST", body: "{}" });
    var credential;
    try {
      credential = await navigator.credentials.create({ publicKey: decodeCreationOptions(start.options) });
    } catch (error) {
      throw passkeyError(error);
    }
    if (!credential) throw new Error("The device did not return a passkey.");
    var verified = await api("/api/passkey/register/verify", {
      method: "POST",
      body: JSON.stringify({
        challenge_id: start.challenge_id,
        device_name: name,
        response: credentialToJSON(credential)
      })
    });
    return verified.passkey;
  }

  async function login(options) {
    options = options || {};
    if (!supported()) throw new Error("Passkeys are not supported in this browser.");
    var body = {};
    if (options.identifier) body.identifier = String(options.identifier).trim();
    var start = await api("/api/passkey/login/options", { method: "POST", body: JSON.stringify(body) });
    var credential;
    try {
      credential = await navigator.credentials.get({ publicKey: decodeRequestOptions(start.options) });
    } catch (error) {
      throw passkeyError(error);
    }
    if (!credential) throw new Error("The device did not return a passkey.");
    return await api("/api/passkey/login/verify", {
      method: "POST",
      body: JSON.stringify({
        challenge_id: start.challenge_id,
        response: credentialToJSON(credential)
      })
    });
  }

  async function list() {
    var data = await api("/api/passkeys", { method: "GET" });
    return Array.isArray(data.passkeys) ? data.passkeys : [];
  }

  async function rename(id, name) {
    return await api("/api/passkeys/" + encodeURIComponent(id), {
      method: "PATCH",
      body: JSON.stringify({ credential_name: name })
    });
  }

  async function remove(id, password) {
    return await api("/api/passkeys/" + encodeURIComponent(id), {
      method: "DELETE",
      body: JSON.stringify({ current_password: password })
    });
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function buildEnrollmentModal(force) {
    var existing = document.getElementById("blissPasskeyModal");
    if (existing) existing.remove();
    var wrapper = document.createElement("div");
    wrapper.id = "blissPasskeyModal";
    wrapper.className = "pk-modal-backdrop open";
    wrapper.setAttribute("role", "dialog");
    wrapper.setAttribute("aria-modal", "true");
    wrapper.setAttribute("aria-labelledby", "blissPasskeyTitle");
    wrapper.innerHTML =
      '<div class="pk-modal">' +
        '<div class="pk-modal-icon">' + FINGERPRINT_ICON + '</div>' +
        '<h2 id="blissPasskeyTitle">' + (force ? "Add this device" : "Make your next login easier") + '</h2>' +
        '<p>' + (force
          ? "Enable secure fingerprint, Face ID, Windows Hello or device PIN sign-in on this device. Your device stores the passkey; Bliss Legacy only receives a public key."
          : "Enable secure fingerprint, Face ID, Windows Hello or device PIN authentication. Your device stores the passkey; Bliss Legacy never receives your fingerprint, face data or device PIN.") + '</p>' +
        '<div class="pk-field">' +
          '<label for="blissPasskeyName">Device name</label>' +
          '<input id="blissPasskeyName" type="text" maxlength="60" autocomplete="off" value="' + escapeHtml(detectDeviceName()) + '">' +
          '<span class="pk-field-note">You can rename this later under Security &amp; Devices.</span>' +
        '</div>' +
        '<div class="pk-status" id="blissPasskeyStatus"></div>' +
        '<div class="pk-actions">' +
          '<button class="pk-btn" type="button" id="blissPasskeyEnable">' + FINGERPRINT_ICON + '<span>Enable now</span></button>' +
          '<button class="pk-btn pk-btn-light" type="button" id="blissPasskeySkip">Not now</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrapper);
    return wrapper;
  }

  async function offerEnrollment(options) {
    options = options || {};
    if (!supported()) return { offered: false, reason: "unsupported" };
    if (!options.force) {
      try {
        if (sessionStorage.getItem("bliss_passkey_prompt_skipped") === "1") {
          return { offered: false, reason: "skipped" };
        }
      } catch (error) { /* storage can be blocked */ }
      var alreadyAvailable = await platformAvailable();
      if (!alreadyAvailable) return { offered: false, reason: "no_platform_authenticator" };
      try {
        var existing = await list();
        if (existing.length) return { offered: false, reason: "already_registered" };
      } catch (error) {
        return { offered: false, reason: "unavailable" };
      }
    }

    return await new Promise(function (resolve) {
      var modal = buildEnrollmentModal(Boolean(options.force));
      var nameInput = modal.querySelector("#blissPasskeyName");
      var enable = modal.querySelector("#blissPasskeyEnable");
      var skip = modal.querySelector("#blissPasskeySkip");
      var status = modal.querySelector("#blissPasskeyStatus");
      var busy = false;

      function finish(result) {
        modal.remove();
        resolve(result);
      }

      function skipNow() {
        if (busy) return;
        try { sessionStorage.setItem("bliss_passkey_prompt_skipped", "1"); } catch (error) { /* ignore */ }
        finish({ offered: true, registered: false, reason: "skipped" });
      }

      skip.addEventListener("click", skipNow);
      modal.addEventListener("click", function (event) {
        if (event.target === modal) skipNow();
      });
      modal.addEventListener("keydown", function (event) {
        if (event.key === "Escape") skipNow();
        if (event.key === "Enter" && event.target === nameInput) {
          event.preventDefault();
          enable.click();
        }
      });
      enable.addEventListener("click", async function () {
        if (busy) return;
        busy = true;
        enable.disabled = true;
        skip.disabled = true;
        status.className = "pk-status";
        status.textContent = "Opening your device security prompt…";
        try {
          var passkey = await register({ name: nameInput ? nameInput.value : "" });
          status.className = "pk-status pk-success";
          status.textContent = "Passkey added. You can use it next time you sign in.";
          setTimeout(function () {
            finish({ offered: true, registered: true, passkey: passkey });
          }, 1100);
        } catch (error) {
          busy = false;
          enable.disabled = false;
          skip.disabled = false;
          status.className = "pk-status pk-error";
          status.textContent = error.message || "Passkey setup failed. Please try again.";
        }
      });
      if (nameInput) {
        nameInput.focus();
        nameInput.select();
      }
    });
  }

  function bindLogin(button, options) {
    options = options || {};
    if (!button) return;
    if (!supported()) {
      button.hidden = true;
      var note = options.unsupported;
      if (note) {
        note.hidden = false;
        note.textContent = "Passkeys are not available in this browser. Use your password, or open Bliss Legacy in a supported browser.";
      }
      return;
    }
    var original = button.innerHTML;
    button.addEventListener("click", async function () {
      if (button.disabled) return;
      button.disabled = true;
      button.innerHTML = "Waiting for your device…";
      if (options.onStart) options.onStart();
      try {
        var identifier = typeof options.getIdentifier === "function" ? options.getIdentifier() : "";
        var data = await login({ identifier: identifier });
        if (options.onSuccess) await options.onSuccess(data);
      } catch (error) {
        if (options.onError) options.onError(error);
      } finally {
        button.disabled = false;
        button.innerHTML = original;
      }
    });
  }

  window.BlissPasskeys = {
    supported: supported,
    platformAvailable: platformAvailable,
    detectDeviceName: detectDeviceName,
    register: register,
    login: login,
    list: list,
    rename: rename,
    remove: remove,
    offerEnrollment: offerEnrollment,
    bindLogin: bindLogin,
    fingerprintIcon: FINGERPRINT_ICON
  };
})();
