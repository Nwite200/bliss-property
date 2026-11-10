/* ============================================================================
   Bliss Legacy Limited — Global Digital Human Ecosystem
   ----------------------------------------------------------------------------
   A persistent, free-to-operate, voice-enabled assistant available across the
   public site and every dashboard. It uses only browser-native speech APIs and
   the existing authenticated backend. It never invents records, never approves
   money and never claims a human handover succeeded before a staff member
   accepts it.
   ========================================================================== */
(function () {
  "use strict";

  if (window.__blissDigitalHuman) return;
  window.__blissDigitalHuman = true;
  if (document.documentElement.getAttribute("data-no-digital-human") === "1") return;

  var API = "/api/assistant";
  var STORAGE_KEY = "bliss.digitalHuman.v1";
  var CSS_HREF = "/assets/css/digital-human.css";
  var MAX_STORED_EVENTS = 60;
  var MAX_MESSAGES = 60;

  var state = {
    boot: null,
    open: false,
    persona: null,
    conversationRef: null,
    messages: [],
    listening: false,
    speaking: false,
    thinking: false,
    voiceEnabled: true,
    rate: 1,
    pitch: 1,
    volume: 1,
    recognition: null,
    recognitionSupported: false,
    synth: window.speechSynthesis || null,
    voices: [],
    greeted: false,
    hasInteracted: false,
    openedOnce: false,
    lastSpeech: "",
    seenEvents: [],
    seenHandovers: [],
    pendingHandovers: [],
    shownHandoverCards: {},
    handoverStatus: {},
    eventTimer: null,
    handoverTimer: null,
    formContextAvailable: false,
    currentCards: [],
    voiceFallback: false,
    startedAt: Date.now()
  };

  var el = {};
  var svgSeq = 0;

  /* -------------------------------------------------------------------------
     Small utilities
     ---------------------------------------------------------------------- */
  function readStore() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (error) {
      return {};
    }
  }

  function writeStore(patch) {
    try {
      var current = readStore();
      Object.keys(patch || {}).forEach(function (key) { current[key] = patch[key]; });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
    } catch (error) { /* storage may be unavailable */ }
  }

  function visitorId() {
    var store = readStore();
    if (store.visitorId && /^[A-Za-z0-9_-]{8,80}$/.test(store.visitorId)) return store.visitorId;
    var id = "v-" + (window.crypto && crypto.randomUUID
      ? crypto.randomUUID().replace(/-/g, "")
      : Date.now().toString(36) + Math.random().toString(36).slice(2));
    writeStore({ visitorId: id });
    return id;
  }

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  function nowTime() {
    try {
      return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch (error) { return ""; }
  }

  function clamp(value, min, max, fallback) {
    var n = Number(value);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  }

  function shade(hex, percent) {
    var match = String(hex || "#8A5A3B").replace("#", "");
    if (match.length === 3) match = match.split("").map(function (c) { return c + c; }).join("");
    var num = parseInt(match, 16);
    if (!Number.isFinite(num)) return hex;
    var r = (num >> 16) & 255, g = (num >> 8) & 255, b = num & 255;
    var amt = Math.round(255 * (percent / 100));
    r = Math.min(255, Math.max(0, r + amt));
    g = Math.min(255, Math.max(0, g + amt));
    b = Math.min(255, Math.max(0, b + amt));
    return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }

  function personaByKey(key) {
    var list = (state.boot && state.boot.personas) || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].key === key) return list[i];
    }
    return list[0] || null;
  }

  function api(path, options) {
    options = options || {};
    var headers = Object.assign({ "Accept": "application/json" }, options.headers || {});
    if (options.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
    return fetch(API + path, Object.assign({
      credentials: "same-origin",
      headers: headers
    }, options)).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (data) {
        if (!response.ok) {
          var error = new Error(data.error || "The request could not be completed.");
          error.status = response.status;
          error.data = data;
          throw error;
        }
        return data;
      });
    });
  }

  /* -------------------------------------------------------------------------
     Persona portraits — premium inline SVG, brand palette, blink and mouth
     movement during speech.
     ---------------------------------------------------------------------- */
  function hairMarkup(style, hairGradient, accent) {
    switch (String(style || "short")) {
      case "updo":
        return '<circle cx="100" cy="40" r="17" fill="url(#' + hairGradient + ')"/>' +
          '<path d="M63 90C58 52 76 40 100 40C124 40 142 52 137 90C132 65 120 55 100 55C80 55 68 65 63 90Z" fill="url(#' + hairGradient + ')"/>' +
          '<path d="M64 78C70 58 84 50 100 50" fill="none" stroke="rgba(255,255,255,.14)" stroke-width="2" stroke-linecap="round"/>';
      case "bob":
        return '<path d="M62 86C56 48 78 38 100 38C122 38 144 48 138 86L141 132L129 132L132 88C127 66 116 56 100 56C84 56 73 66 68 88L71 132L59 132Z" fill="url(#' + hairGradient + ')"/>' +
          '<path d="M66 94C64 72 76 58 100 56C124 58 136 72 134 94" fill="none" stroke="rgba(255,255,255,.10)" stroke-width="2"/>';
      case "braids":
        return '<path d="M62 88C57 50 77 40 100 40C123 40 143 50 138 88C133 64 120 56 100 56C80 56 67 64 62 88Z" fill="url(#' + hairGradient + ')"/>' +
          '<path d="M63 84C59 108 61 132 65 150L74 149C69 126 68 105 72 86Z" fill="url(#' + hairGradient + ')"/>' +
          '<path d="M137 84C141 108 139 132 135 150L126 149C131 126 132 105 128 86Z" fill="url(#' + hairGradient + ')"/>' +
          '<path d="M67 100L72 146M133 100L128 146" stroke="rgba(255,255,255,.14)" stroke-width="1.6" stroke-linecap="round"/>' +
          '<circle cx="74" cy="151" r="3" fill="' + accent + '"/><circle cx="126" cy="151" r="3" fill="' + accent + '"/>';
      case "wrap":
        return '<path d="M58 86C54 46 79 32 100 32C122 32 146 46 142 86C136 60 121 50 100 50C79 50 64 60 58 86Z" fill="' + accent + '"/>' +
          '<path d="M60 72C76 54 124 54 140 72" fill="none" stroke="rgba(255,255,255,.22)" stroke-width="3" stroke-linecap="round"/>' +
          '<path d="M63 84C80 70 120 70 137 84" fill="none" stroke="rgba(0,0,0,.16)" stroke-width="2" stroke-linecap="round"/>' +
          '<circle cx="139" cy="58" r="5" fill="rgba(229,193,91,.85)"/>';
      case "elegant":
        return '<circle cx="100" cy="39" r="15" fill="url(#' + hairGradient + ')"/>' +
          '<path d="M64 88C59 52 78 41 100 41C122 41 141 52 136 88C131 64 119 55 100 55C81 55 69 64 64 88Z" fill="url(#' + hairGradient + ')"/>' +
          '<path d="M66 86C70 102 78 112 88 118" fill="none" stroke="url(#' + hairGradient + ')" stroke-width="7" stroke-linecap="round"/>' +
          '<path d="M134 86C130 102 122 112 112 118" fill="none" stroke="url(#' + hairGradient + ')" stroke-width="7" stroke-linecap="round"/>';
      case "fade":
        return '<path d="M66 84C66 56 82 45 100 45C118 45 134 56 134 84C128 64 116 57 100 57C84 57 72 64 66 84Z" fill="url(#' + hairGradient + ')"/>' +
          '<path d="M70 76C79 62 90 56 100 56C110 56 121 62 130 76" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="1.8"/>';
      default:
        return '<path d="M63 88C59 54 76 43 100 43C124 43 141 54 137 88C133 64 120 57 100 57C80 57 67 64 63 88Z" fill="url(#' + hairGradient + ')"/>' +
          '<path d="M66 76C76 60 88 55 100 55C112 55 124 60 134 76" fill="none" stroke="rgba(255,255,255,.13)" stroke-width="2" stroke-linecap="round"/>';
    }
  }

  function personaSvg(persona, crop) {
    if (!persona) return "";
    var uid = "dh" + (++svgSeq) + "-" + String(persona.key || "p").replace(/[^a-z0-9]/gi, "");
    var avatar = persona.avatar || {};
    var accent = persona.accent || "#00B522";
    var skin = avatar.skin || "#8A5A3B";
    var hair = avatar.hair || "#1B1713";
    var outfit = avatar.outfit || "#0B3D2E";
    var shirt = avatar.shirt || "#F4EFE4";
    var beard = Boolean(avatar.beard);
    var earrings = Boolean(avatar.earrings);
    var viewBox = crop ? "38 18 124 124" : "0 0 200 200";
    var hairGradient = uid + "-hair";
    var skinGradient = uid + "-skin";
    var outfitGradient = uid + "-outfit";
    var bgGradient = uid + "-bg";
    var glow = uid + "-glow";

    return '<svg viewBox="' + viewBox + '" role="img" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">' +
      '<defs>' +
        '<linearGradient id="' + bgGradient + '" x1="0" y1="0" x2="1" y2="1">' +
          '<stop offset="0" stop-color="#1B2A21"/><stop offset="1" stop-color="#090E0B"/>' +
        '</linearGradient>' +
        '<radialGradient id="' + skinGradient + '" cx="38%" cy="28%" r="88%">' +
          '<stop offset="0" stop-color="' + shade(skin, 20) + '"/><stop offset="0.62" stop-color="' + skin + '"/><stop offset="1" stop-color="' + shade(skin, -18) + '"/>' +
        '</radialGradient>' +
        '<linearGradient id="' + hairGradient + '" x1="0" y1="0" x2="0.7" y2="1">' +
          '<stop offset="0" stop-color="' + shade(hair, 24) + '"/><stop offset="1" stop-color="' + shade(hair, -8) + '"/>' +
        '</linearGradient>' +
        '<linearGradient id="' + outfitGradient + '" x1="0" y1="0" x2="1" y2="1">' +
          '<stop offset="0" stop-color="' + shade(outfit, 16) + '"/><stop offset="1" stop-color="' + shade(outfit, -18) + '"/>' +
        '</linearGradient>' +
        '<filter id="' + glow + '" x="-60%" y="-60%" width="220%" height="220%">' +
          '<feGaussianBlur stdDeviation="13"/>' +
        '</filter>' +
      '</defs>' +
      '<rect width="200" height="200" fill="url(#' + bgGradient + ')"/>' +
      '<circle cx="158" cy="36" r="46" fill="' + accent + '" opacity="0.28" filter="url(#' + glow + ')"/>' +
      '<circle cx="32" cy="168" r="40" fill="' + accent + '" opacity="0.12" filter="url(#' + glow + ')"/>' +
      '<path d="M14 200C20 158 52 140 78 135L122 135C148 140 180 158 186 200Z" fill="url(#' + outfitGradient + ')"/>' +
      '<path d="M86 134L100 168L114 134C108 140 92 140 86 134Z" fill="' + shirt + '"/>' +
      '<path d="M86 134C88 146 94 156 100 168L82 150Z" fill="' + shade(outfit, -12) + '"/>' +
      '<path d="M114 134C112 146 106 156 100 168L118 150Z" fill="' + shade(outfit, -6) + '"/>' +
      '<path d="M88 112L112 112L112 141C104 149 96 149 88 141Z" fill="' + shade(skin, -12) + '"/>' +
      '<ellipse cx="100" cy="91" rx="33" ry="41" fill="url(#' + skinGradient + ')"/>' +
      '<path d="M67 91C68 113 81 134 100 134C119 134 132 113 133 91C130 117 118 131 100 131C82 131 70 117 67 91Z" fill="' + shade(skin, -30) + '" opacity=".22"/>' +
      '<ellipse cx="65" cy="94" rx="6" ry="9" fill="' + shade(skin, -10) + '"/>' +
      '<ellipse cx="135" cy="94" rx="6" ry="9" fill="' + shade(skin, -10) + '"/>' +
      '<path d="M64 93C66 97 68 99 67 102" fill="none" stroke="' + shade(skin, -26) + '" stroke-width="1" opacity=".5"/>' +
      '<path d="M136 93C134 97 132 99 133 102" fill="none" stroke="' + shade(skin, -26) + '" stroke-width="1" opacity=".5"/>' +
      (earrings ? '<circle cx="64" cy="105" r="2.8" fill="' + accent + '"/><circle cx="136" cy="105" r="2.8" fill="' + accent + '"/><circle cx="64" cy="105" r="1.2" fill="#F6E8B8"/><circle cx="136" cy="105" r="1.2" fill="#F6E8B8"/>' : '') +
      '<ellipse cx="84" cy="80" rx="13" ry="15" fill="#FFFFFF" opacity=".055"/>' +
      '<ellipse cx="116" cy="80" rx="12" ry="14" fill="#FFFFFF" opacity=".045"/>' +
      '<path d="M70 92C74 76 84 68 100 68C116 68 126 76 130 92C124 82 114 78 100 78C86 78 76 82 70 92Z" fill="rgba(0,0,0,.07)"/>' +
      hairMarkup(persona.hairStyle, hairGradient, accent) +
      (beard ? '<path d="M70 98C71 124 84 139 100 139C116 139 129 124 130 98C127 119 117 128 100 128C83 128 73 119 70 98Z" fill="url(#' + hairGradient + ')" opacity=".92"/>' +
        '<path d="M96 111C98 113 102 113 104 111" fill="none" stroke="' + shade(skin, -30) + '" stroke-width="1" opacity=".5"/>' : '') +
      '<g class="dh-eye">' +
        '<path d="M78.5 91C81.5 88.2 89 88.2 92.5 91C89 93.6 81.5 93.6 78.5 91Z" fill="#EDE5DB"/>' +
        '<circle cx="85.5" cy="91" r="2.15" fill="#2A1B13"/>' +
        '<circle cx="86.2" cy="90.3" r="0.75" fill="#FFFFFF"/>' +
        '<path d="M78 90C82 86.8 89 86.8 93 90" fill="none" stroke="#2B1D15" stroke-width="1.35" stroke-linecap="round"/>' +
        '<path d="M79 92.6C82.4 94.8 88.6 94.8 92 92.6" fill="none" stroke="' + shade(skin, -34) + '" stroke-width=".8" opacity=".55"/>' +
      '</g>' +
      '<g class="dh-eye">' +
        '<path d="M107.5 91C110.5 88.2 118 88.2 121.5 91C118 93.6 110.5 93.6 107.5 91Z" fill="#EDE5DB"/>' +
        '<circle cx="114.5" cy="91" r="2.15" fill="#2A1B13"/>' +
        '<circle cx="115.2" cy="90.3" r="0.75" fill="#FFFFFF"/>' +
        '<path d="M107 90C111 86.8 118 86.8 122 90" fill="none" stroke="#2B1D15" stroke-width="1.35" stroke-linecap="round"/>' +
        '<path d="M108 92.6C111.4 94.8 117.6 94.8 121 92.6" fill="none" stroke="' + shade(skin, -34) + '" stroke-width=".8" opacity=".55"/>' +
      '</g>' +
      '<path d="M77 82.5C81 79.5 88 79.5 92 82" fill="none" stroke="' + shade(hair, 12) + '" stroke-width="2.1" stroke-linecap="round"/>' +
      '<path d="M108 82C112 79.5 119 79.5 123 82.5" fill="none" stroke="' + shade(hair, 12) + '" stroke-width="2.1" stroke-linecap="round"/>' +
      '<path d="M100 91C98.6 97 97.4 103 99.2 106.5C100.2 107.6 102 107.6 103 106.4" fill="none" stroke="' + shade(skin, -26) + '" stroke-width="1.25" stroke-linecap="round" opacity=".65"/>' +
      '<path d="M96 108.5C98 109.6 102 109.6 104 108.5" fill="none" stroke="' + shade(skin, -32) + '" stroke-width=".9" stroke-linecap="round" opacity=".45"/>' +
      '<ellipse cx="99" cy="116.6" rx="1.1" ry=".7" fill="' + shade(skin, -36) + '" opacity=".3"/>' +
      '<ellipse cx="101" cy="116.6" rx="1.1" ry=".7" fill="' + shade(skin, -36) + '" opacity=".3"/>' +
      '<path d="M77 105C80.5 107 84 107 86.5 105.5" fill="none" stroke="' + accent + '" stroke-width="2" opacity=".07"/>' +
      '<path d="M123 105C119.5 107 116 107 113.5 105.5" fill="none" stroke="' + accent + '" stroke-width="2" opacity=".07"/>' +
      '<g class="dh-mouth">' +
        '<path d="M90 115.5C94 112.8 106 112.8 110 115.5C108 117.2 104 118.4 100 118.4C96 118.4 92 117.2 90 115.5Z" fill="' + shade(skin, -28) + '" opacity=".55"/>' +
        '<path d="M91 115.5C94.5 113.4 105.5 113.4 109 115.5C106.5 116.4 93.5 116.4 91 115.5Z" fill="#8A4A4A"/>' +
        '<path d="M92 117.2C96 119.2 104 119.2 108 117.2C106 119.5 94 119.5 92 117.2Z" fill="#9B5957"/>' +
        '<path d="M91.5 115.5C96 114.6 104 114.6 108.5 115.5" fill="none" stroke="#5F2E31" stroke-width=".8" stroke-linecap="round"/>' +
        '<path d="M92.5 116.6C96.5 117.7 103.5 117.7 107.5 116.6" fill="none" stroke="#F4E5DA" stroke-width=".7" stroke-linecap="round" opacity=".75"/>' +
      '</g>' +
      '<ellipse cx="100" cy="125" rx="8" ry="4" fill="#FFFFFF" opacity=".05"/>' +
      '<ellipse cx="78" cy="101" rx="7" ry="5" fill="' + accent + '" opacity=".06"/>' +
      '<ellipse cx="122" cy="101" rx="7" ry="5" fill="' + accent + '" opacity=".06"/>' +
      '</svg>';
  }

  function avatarMarkup(persona) {
    if (persona && persona.image) {
      return '<img src="' + esc(persona.image) + '" alt="" draggable="false" />';
    }
    return personaSvg(persona, true);
  }

  function paintAvatar(node, persona) {
    if (!node) return;
    node.innerHTML = avatarMarkup(persona);
    var img = node.querySelector("img");
    if (img) {
      img.addEventListener("error", function () {
        node.innerHTML = personaSvg(persona, true);
      }, { once: true });
    }
  }

  /* -------------------------------------------------------------------------
     DOM construction
     ---------------------------------------------------------------------- */
  function injectCss() {
    if (document.querySelector('link[data-dh-css="1"]')) return;
    var link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = CSS_HREF;
    link.setAttribute("data-dh-css", "1");
    document.head.appendChild(link);
  }

  function buildRoot() {
    var root = document.createElement("div");
    root.className = "dh-root";
    root.setAttribute("data-dh-root", "1");
    root.innerHTML =
      '<button type="button" class="dh-launcher" id="dhLauncher" aria-label="Open the Bliss Legacy digital assistant" aria-expanded="false" aria-controls="dhPanel">' +
        '<span class="dh-launcher-ring" aria-hidden="true"></span>' +
        '<span class="dh-launcher-avatar" id="dhLauncherAvatar" aria-hidden="true"></span>' +
        '<span class="dh-launcher-badge" id="dhLauncherBadge" aria-hidden="true">0</span>' +
        '<span class="dh-launcher-online" aria-hidden="true"></span>' +
      '</button>' +
      '<section class="dh-panel" id="dhPanel" role="dialog" aria-modal="false" aria-label="Bliss Legacy digital assistant" aria-hidden="true">' +
        '<header class="dh-header">' +
          '<div class="dh-avatar is-breathe" id="dhAvatar" aria-hidden="true"></div>' +
          '<div class="dh-ident">' +
            '<span class="dh-name" id="dhName">Adaora</span>' +
            '<span class="dh-role" id="dhRole">Main Concierge · Client Experience</span>' +
            '<span class="dh-live"><i aria-hidden="true"></i><span id="dhStatus">Online</span></span>' +
          '</div>' +
          '<div class="dh-header-actions">' +
            '<button type="button" class="dh-icon-btn" id="dhMute" aria-label="Turn assistant voice off" aria-pressed="true" title="Voice on">🔊</button>' +
            '<button type="button" class="dh-icon-btn" id="dhClose" aria-label="Close digital assistant">✕</button>' +
          '</div>' +
        '</header>' +
        '<div class="dh-body" id="dhBody">' +
          '<div class="dh-thread" id="dhThread"></div>' +
          '<div class="dh-chips" id="dhChips"></div>' +
          '<div class="dh-caption" id="dhCaption" aria-live="polite" aria-atomic="true"></div>' +
        '</div>' +
        '<form class="dh-compose" id="dhForm" autocomplete="off">' +
          '<button type="button" class="dh-mic" id="dhMic" aria-label="Speak to the assistant" title="Speak to the assistant">🎙</button>' +
          '<input class="dh-input" id="dhInput" type="text" placeholder="Type your message…" maxlength="1200" aria-label="Message the Bliss Legacy assistant" />' +
          '<button type="submit" class="dh-send" id="dhSend">Send</button>' +
        '</form>' +
        '<div class="dh-footer">' +
          '<button type="button" id="dhStop">Stop voice</button>' +
          '<button type="button" id="dhRepeat">Repeat</button>' +
          '<button type="button" id="dhAvail" hidden title="Set your handover availability">Available</button>' +
          '<span class="dh-footer-note" id="dhVoiceNote">Free browser voice</span>' +
        '</div>' +
      '</section>';

    document.body.appendChild(root);

    var toastWrap = document.createElement("div");
    toastWrap.className = "dh-toast-wrap";
    toastWrap.id = "dhToasts";
    toastWrap.setAttribute("aria-live", "polite");
    document.body.appendChild(toastWrap);

    el.root = root;
    el.launcher = document.getElementById("dhLauncher");
    el.launcherAvatar = document.getElementById("dhLauncherAvatar");
    el.launcherBadge = document.getElementById("dhLauncherBadge");
    el.panel = document.getElementById("dhPanel");
    el.avatar = document.getElementById("dhAvatar");
    el.name = document.getElementById("dhName");
    el.role = document.getElementById("dhRole");
    el.status = document.getElementById("dhStatus");
    el.mute = document.getElementById("dhMute");
    el.close = document.getElementById("dhClose");
    el.thread = document.getElementById("dhThread");
    el.chips = document.getElementById("dhChips");
    el.caption = document.getElementById("dhCaption");
    el.form = document.getElementById("dhForm");
    el.input = document.getElementById("dhInput");
    el.send = document.getElementById("dhSend");
    el.mic = document.getElementById("dhMic");
    el.stop = document.getElementById("dhStop");
    el.repeat = document.getElementById("dhRepeat");
    el.avail = document.getElementById("dhAvail");
    el.voiceNote = document.getElementById("dhVoiceNote");
    el.toasts = toastWrap;
    el.body = document.getElementById("dhBody");
  }

  function bindEvents() {
    el.launcher.addEventListener("click", function () {
      if (state.open) closePanel(); else openPanel();
    });
    el.close.addEventListener("click", closePanel);
    el.mute.addEventListener("click", toggleMute);
    el.form.addEventListener("submit", function (event) {
      event.preventDefault();
      var text = el.input.value.trim();
      if (!text) return;
      el.input.value = "";
      sendMessage(text);
    });
    el.input.addEventListener("keydown", function (event) {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        el.form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
      }
    });
    el.mic.addEventListener("click", toggleListening);
    el.stop.addEventListener("click", stopSpeaking);
    el.repeat.addEventListener("click", function () {
      if (state.lastSpeech) speak(state.lastSpeech);
    });
    el.avail.addEventListener("click", cycleAvailability);
    document.addEventListener("keydown", function (event) {
      state.hasInteracted = true;
      if (event.key === "Escape" && state.open) closePanel();
    }, true);
    document.addEventListener("pointerdown", function () {
      state.hasInteracted = true;
    }, { passive: true, once: true });
  }

  /* -------------------------------------------------------------------------
     Persona rendering and transitions
     ---------------------------------------------------------------------- */
  function applyPersona(persona, animate) {
    if (!persona) return;
    var previous = state.persona;
    var changed = previous && previous.key !== persona.key;
    state.persona = persona;

    var isFemale = String(persona.gender || "").toLowerCase() === "female";
    var title = persona.title || persona.department || "Digital specialist";
    el.name.textContent = persona.name || "Bliss Assistant";
    el.role.textContent = title + (persona.department ? " · " + persona.department : "");
    el.root.style.setProperty("--dh-persona-accent", persona.accent || "#00B522");
    el.launcher.setAttribute("aria-label", "Open " + (persona.name || "the Bliss Legacy") + ", digital assistant, " + title);

    if (!changed || !animate) {
      paintAvatar(el.avatar, persona);
      paintAvatar(el.launcherAvatar, persona);
      return;
    }

    el.avatar.classList.add("is-out");
    el.launcherAvatar.style.opacity = "0";
    setTimeout(function () {
      paintAvatar(el.avatar, persona);
      paintAvatar(el.launcherAvatar, persona);
      el.avatar.classList.remove("is-out");
      el.avatar.classList.add("is-in");
      el.launcherAvatar.style.opacity = "1";
      setTimeout(function () { el.avatar.classList.remove("is-in"); }, 520);
    }, 190);
  }

  function setStatus(text, tone) {
    el.status.textContent = text;
    el.status.parentElement.style.color = tone === "muted" ? "#9CB0A2" : (tone === "warn" ? "#E5C15B" : "#3BE06B");
  }

  /* -------------------------------------------------------------------------
     Thread rendering
     ---------------------------------------------------------------------- */
  function scrollThread() {
    try { el.body.scrollTop = el.body.scrollHeight; } catch (error) { /* ignore */ }
  }

  function clearThread() {
    el.thread.innerHTML = "";
  }

  function addMessage(role, text, options) {
    options = options || {};
    var wrap = document.createElement("div");
    wrap.className = "dh-msg dh-msg-" + (role === "user" ? "user" : (role === "system" ? "system" : "assistant"));

    if (role === "system") {
      wrap.textContent = String(text || "");
      el.thread.appendChild(wrap);
      scrollThread();
      return wrap;
    }

    if (role === "assistant") {
      var who = document.createElement("span");
      who.className = "dh-msg-who";
      who.innerHTML = '<i aria-hidden="true"></i>' + esc((options.persona && options.persona.name) || (state.persona && state.persona.name) || "Bliss Assistant");
      wrap.appendChild(who);
    }

    var bubble = document.createElement("div");
    bubble.className = "dh-bubble";
    bubble.textContent = String(text || "");
    wrap.appendChild(bubble);

    if (role === "assistant" && options.cards && options.cards.length) {
      wrap.appendChild(buildCards(options.cards));
    }

    if (options.action && options.action.type) {
      wrap.appendChild(buildAction(options.action));
    }

    if (options.handover) {
      wrap.appendChild(buildHandoverNote(options.handover));
    }

    if (role === "user" || role === "assistant") {
      var time = document.createElement("span");
      time.className = "dh-msg-time";
      time.textContent = options.time || nowTime();
      wrap.appendChild(time);
    }

    el.thread.appendChild(wrap);
    scrollThread();
    return wrap;
  }

  function buildCards(cards) {
    var box = document.createElement("div");
    box.className = "dh-cards";
    (cards || []).slice(0, 8).forEach(function (card) {
      if (!card) return;
      var node = document.createElement(card.href ? "a" : "div");
      node.className = "dh-card";
      if (card.href) {
        node.href = safeHref(card.href);
        node.addEventListener("click", function () { setTimeout(closePanel, 180); });
      }
      var main = document.createElement("span");
      main.className = "dh-card-main";
      var t = document.createElement("span");
      t.className = "dh-card-title";
      t.textContent = String(card.title || "Bliss Legacy");
      main.appendChild(t);
      if (card.subtitle) {
        var s = document.createElement("span");
        s.className = "dh-card-sub";
        s.textContent = String(card.subtitle);
        main.appendChild(s);
      }
      if (card.meta) {
        var m = document.createElement("span");
        m.className = "dh-card-meta";
        m.textContent = String(card.meta);
        main.appendChild(m);
      }
      node.appendChild(main);
      if (card.href) {
        var arrow = document.createElement("span");
        arrow.className = "dh-card-arrow";
        arrow.textContent = "→";
        arrow.setAttribute("aria-hidden", "true");
        node.appendChild(arrow);
      }
      box.appendChild(node);
    });
    return box;
  }

  function safeHref(value) {
    var href = String(value || "").trim();
    if (!href) return "#";
    if (href.indexOf("//") === 0) return "#";
    if (href.charAt(0) === "/" && href.charAt(1) !== "/") return href;
    if (/^[a-z0-9._~!$&'()*+,;=:@/?#%\-]+$/i.test(href) && href.indexOf(":") === -1) return href;
    if (/^https?:\/\//i.test(href)) return href;
    return "#";
  }

  function buildAction(action) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "dh-action" + (action.secondary ? " secondary" : "");
    button.textContent = action.label || "Continue";
    button.addEventListener("click", function () {
      if (action.type === "confirm_handover") {
        sendMessage("Yes, request a human handover", { confirmHandover: true });
      } else if (action.message) {
        sendMessage(action.message);
      }
    });
    return button;
  }

  function buildHandoverNote(handover) {
    var box = document.createElement("div");
    box.className = "dh-handover";
    box.innerHTML =
      '<span class="dh-handover-label">Human handover · ' + esc(handover.status || "pending") + '</span>' +
      '<div class="dh-handover-title">' + esc(handover.assigned_name ? handover.assigned_name + " · " + (handover.assigned_role || "") : "Waiting for an available specialist") + '</div>' +
      '<p class="dh-handover-text">Reference ' + esc(handover.ref || "") + '. A staff member must accept before the conversation is connected. I will never claim a human has joined before that happens.</p>';
    return box;
  }

  function renderChips(items) {
    el.chips.innerHTML = "";
    var list = (items || []).slice(0, 5);
    if (state.formContextAvailable && !list.some(function (item) { return /check my form/i.test(item); })) {
      list = list.concat(["Check my form"]);
    }
    list.forEach(function (text) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "dh-chip";
      button.textContent = text;
      button.addEventListener("click", function () { sendMessage(text); });
      el.chips.appendChild(button);
    });
  }

  function showThinking() {
    state.thinking = true;
    var wrap = document.createElement("div");
    wrap.className = "dh-msg dh-msg-assistant";
    wrap.id = "dhThinking";
    var who = document.createElement("span");
    who.className = "dh-msg-who";
    who.innerHTML = '<i aria-hidden="true"></i>' + esc((state.persona && state.persona.name) || "Bliss Assistant");
    wrap.appendChild(who);
    var bubble = document.createElement("div");
    bubble.className = "dh-bubble";
    bubble.innerHTML = '<span class="dh-thinking" aria-label="Thinking"><span></span><span></span><span></span></span>';
    wrap.appendChild(bubble);
    el.thread.appendChild(wrap);
    el.avatar.classList.add("is-thinking");
    setStatus("Thinking…", "muted");
    scrollThread();
  }

  function hideThinking() {
    state.thinking = false;
    var node = document.getElementById("dhThinking");
    if (node) node.parentNode.removeChild(node);
    el.avatar.classList.remove("is-thinking");
  }

  /* -------------------------------------------------------------------------
     Voice — free browser APIs only
     ---------------------------------------------------------------------- */
  var FEMALE_HINTS = ["female", "woman", "samantha", "victoria", "karen", "moira", "tessa", "fiona", "zira", "aria", "jenny", "sonia", "natasha", "joanna", "salli", "amelie", "google uk english female", "microsoft zira", "microsoft aria"];
  var MALE_HINTS = ["male", "man", "daniel", "alex", "fred", "david", "mark", "george", "ryan", "guy", "oliver", "thomas", "matthew", "google uk english male", "joey", "brian", "ravi", "microsoft david"];

  function loadVoices() {
    if (!state.synth) return;
    try { state.voices = state.synth.getVoices() || []; } catch (error) { state.voices = []; }
  }

  function voiceScore(voice, gender) {
    var name = String(voice.name || "").toLowerCase();
    var lang = String(voice.lang || "").toLowerCase();
    var score = 0;
    var hints = gender === "male" ? MALE_HINTS : FEMALE_HINTS;
    for (var i = 0; i < hints.length; i++) {
      if (name.indexOf(hints[i]) !== -1) { score += 40; break; }
    }
    if (lang.indexOf("en-ng") === 0) score += 30;
    else if (lang.indexOf("en-gb") === 0) score += 22;
    else if (lang.indexOf("en-za") === 0) score += 18;
    else if (lang.indexOf("en-us") === 0) score += 14;
    else if (lang.indexOf("en") === 0) score += 8;
    if (voice.localService) score += 4;
    if (voice.default) score += 2;
    return score;
  }

  function chooseVoice(persona) {
    loadVoices();
    if (!state.voices.length) return null;
    var gender = String((persona && persona.voice && persona.voice.gender) || persona.gender || "female").toLowerCase();
    var english = state.voices.filter(function (voice) { return /^en/i.test(voice.lang || ""); });
    var pool = english.length ? english : state.voices;
    var sorted = pool.slice().sort(function (a, b) { return voiceScore(b, gender) - voiceScore(a, gender); });
    var best = sorted[0] || null;
    if (!best) return null;
    var bestName = String(best.name || "").toLowerCase();
    var hints = gender === "male" ? MALE_HINTS : FEMALE_HINTS;
    var opposite = gender === "male" ? FEMALE_HINTS : MALE_HINTS;
    var matchesGender = hints.some(function (hint) { return bestName.indexOf(hint) !== -1; });
    var matchesOpposite = opposite.some(function (hint) { return bestName.indexOf(hint) !== -1; });
    state.voiceFallback = !matchesGender && matchesOpposite;
    return best;
  }

  function splitForSpeech(text) {
    var clean = String(text || "").replace(/\s+/g, " ").trim();
    if (clean.length <= 220) return [clean];
    var sentences = clean.match(/[^.!?]+[.!?]?/g) || [clean];
    var chunks = [];
    var current = "";
    sentences.forEach(function (sentence) {
      if ((current + " " + sentence).trim().length > 210 && current) {
        chunks.push(current.trim());
        current = "";
      }
      current += " " + sentence;
    });
    if (current.trim()) chunks.push(current.trim());
    return chunks.slice(0, 8);
  }

  function speak(text) {
    if (!text) return;
    state.lastSpeech = String(text);
    if (!state.voiceEnabled) {
      setStatus("Voice off", "muted");
      return;
    }
    if (!state.synth || typeof window.SpeechSynthesisUtterance === "undefined") {
      el.voiceNote.textContent = "Voice unavailable · text only";
      setStatus("Text only", "muted");
      return;
    }
    try { state.synth.cancel(); } catch (error) { /* ignore */ }
    var persona = state.persona || { voice: {}, gender: "female" };
    var voice = chooseVoice(persona);
    var chunks = splitForSpeech(text);
    if (!chunks.length) return;
    var rate = clamp(((persona.voice && persona.voice.rate) || 1) * state.rate, 0.6, 1.7, 1);
    var pitch = clamp(((persona.voice && persona.voice.pitch) || 1) * state.pitch, 0.6, 1.7, 1);
    var volume = clamp(state.volume, 0, 1, 1);
    state.speaking = true;
    el.avatar.classList.add("is-speaking");
    el.root.classList.add("is-speaking");
    setStatus("Speaking…", "ok");
    el.voiceNote.textContent = state.voiceFallback ? "Nearest available voice" : "Free browser voice";

    chunks.forEach(function (chunk, index) {
      var utterance = new SpeechSynthesisUtterance(chunk);
      if (voice) {
        utterance.voice = voice;
        utterance.lang = voice.lang || "en-NG";
      }
      utterance.rate = rate;
      utterance.pitch = pitch;
      utterance.volume = volume;
      if (index === chunks.length - 1) {
        utterance.onend = function () {
          state.speaking = false;
          el.avatar.classList.remove("is-speaking");
          el.root.classList.remove("is-speaking");
          setStatus("Online", "ok");
        };
      }
      utterance.onerror = function () {
        state.speaking = false;
        el.avatar.classList.remove("is-speaking");
        el.root.classList.remove("is-speaking");
        setStatus("Text only", "muted");
      };
      try { state.synth.speak(utterance); } catch (error) {
        state.speaking = false;
        el.avatar.classList.remove("is-speaking");
        el.root.classList.remove("is-speaking");
      }
    });
  }

  function stopSpeaking() {
    if (state.synth) {
      try { state.synth.cancel(); } catch (error) { /* ignore */ }
    }
    state.speaking = false;
    el.avatar.classList.remove("is-speaking");
    el.root.classList.remove("is-speaking");
    setStatus("Online", "ok");
  }

  function renderAvailability(status) {
    if (!el.avail) return;
    state.availability = status || "available";
    var label = state.availability.charAt(0).toUpperCase() + state.availability.slice(1);
    el.avail.textContent = label;
    el.avail.setAttribute("aria-label", "Handover availability: " + label + ". Click to change.");
    el.avail.style.color = state.availability === "available" ? "#3BE06B" : (state.availability === "busy" ? "#E5C15B" : "#9CB0A2");
  }

  function cycleAvailability() {
    if (!state.boot || !state.boot.authenticated || state.boot.role === "Client") return;
    var order = ["available", "busy", "away"];
    var next = order[(order.indexOf(state.availability || "available") + 1) % order.length];
    renderAvailability(next);
    api("/availability", { method: "POST", body: JSON.stringify({ status: next }) }).then(function () {
      toast("Availability updated", "You are now " + next + " for human handovers.", "");
    }).catch(function () {
      toast("Availability not saved", "Please try again later.", "");
    });
  }

  function toggleMute() {
    state.voiceEnabled = !state.voiceEnabled;
    el.mute.setAttribute("aria-pressed", state.voiceEnabled ? "true" : "false");
    el.mute.textContent = state.voiceEnabled ? "🔊" : "🔇";
    el.mute.setAttribute("aria-label", state.voiceEnabled ? "Turn assistant voice off" : "Turn assistant voice on");
    el.mute.title = state.voiceEnabled ? "Voice on" : "Voice off";
    el.voiceNote.textContent = state.voiceEnabled ? "Free browser voice" : "Voice muted · text only";
    if (!state.voiceEnabled) stopSpeaking();
    writeStore({ voiceEnabled: state.voiceEnabled });
    if (state.boot && state.boot.authenticated) {
      api("/preferences", {
        method: "POST",
        body: JSON.stringify({
          voice_enabled: state.voiceEnabled,
          muted: !state.voiceEnabled,
          rate: state.rate,
          pitch: state.pitch,
          volume: state.volume,
          preferred_persona: state.persona ? state.persona.key : null
        })
      }).catch(function () { /* preference sync is optional */ });
    }
  }

  function setListeningUi(on) {
    state.listening = on;
    el.mic.classList.toggle("is-listening", on);
    el.mic.setAttribute("aria-pressed", on ? "true" : "false");
    el.mic.textContent = on ? "■" : "🎙";
    el.mic.setAttribute("aria-label", on ? "Stop listening" : "Speak to the assistant");
    if (!on && !state.thinking) setStatus("Online", "ok");
  }

  function setupRecognition() {
    var Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      state.recognitionSupported = false;
      el.mic.disabled = true;
      el.mic.title = "Voice input is not supported in this browser. Type instead.";
      el.voiceNote.textContent = "Voice input unavailable · text only";
      return;
    }
    state.recognitionSupported = true;
    var recognition = new Recognition();
    recognition.lang = (navigator.language && /^en/i.test(navigator.language)) ? navigator.language : "en-NG";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = function () {
      setListeningUi(true);
      el.avatar.classList.add("is-listening");
      state.hasInteracted = true;
      if (state.synth) { try { state.synth.cancel(); } catch (error) { /* ignore */ } }
      el.caption.textContent = "Listening…";
      setStatus("Listening…", "warn");
    };
    recognition.onresult = function (event) {
      var interim = "";
      var finalText = "";
      for (var i = event.resultIndex; i < event.results.length; i++) {
        var transcript = event.results[i][0].transcript || "";
        if (event.results[i].isFinal) finalText += transcript;
        else interim += transcript;
      }
      if (interim) {
        el.caption.textContent = "Listening: " + interim;
        el.input.value = interim;
      }
      if (finalText.trim()) {
        el.caption.textContent = "Heard: " + finalText.trim();
        el.input.value = "";
        sendMessage(finalText.trim());
      }
    };
    recognition.onerror = function (event) {
      setListeningUi(false);
      var code = event && event.error;
      if (code === "not-allowed" || code === "service-not-allowed") {
        el.mic.disabled = true;
        el.mic.title = "Microphone permission was denied. Type instead.";
        el.caption.textContent = "Microphone permission was denied. You can type your message.";
      } else if (code === "no-speech") {
        el.caption.textContent = "I did not hear speech. Try again or type.";
      } else if (code === "network") {
        el.caption.textContent = "Speech recognition needs a network connection in this browser. Type instead.";
      } else {
        el.caption.textContent = "Voice input is unavailable right now. Type instead.";
      }
    };
    recognition.onend = function () {
      setListeningUi(false);
      el.avatar.classList.remove("is-listening");
      setTimeout(function () { if (!state.thinking && !state.speaking) setStatus("Online", "ok"); }, 400);
    };
    state.recognition = recognition;
  }

  function toggleListening() {
    if (!state.recognition) {
      toast("Voice input unavailable", "This browser does not support speech recognition. Type your message instead.", "");
      return;
    }
    state.hasInteracted = true;
    if (state.listening) {
      try { state.recognition.stop(); } catch (error) { /* ignore */ }
      setListeningUi(false);
      return;
    }
    if (state.synth) { try { state.synth.cancel(); } catch (error) { /* ignore */ } }
    try {
      state.recognition.start();
    } catch (error) {
      try { state.recognition.stop(); } catch (stopError) { /* ignore */ }
      setTimeout(function () {
        try { state.recognition.start(); } catch (retryError) {
          el.caption.textContent = "Could not start the microphone. Please type instead.";
        }
      }, 250);
    }
  }

  /* -------------------------------------------------------------------------
     Form awareness
     ---------------------------------------------------------------------- */
  function labelFor(control) {
    if (!control) return "";
    var id = control.id;
    if (id) {
      var explicit = document.querySelector('label[for="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]');
      if (explicit) return explicit.textContent.trim();
    }
    var parent = control.closest("label");
    if (parent) return parent.textContent.trim();
    var aria = control.getAttribute("aria-label");
    if (aria) return aria.trim();
    var placeholder = control.getAttribute("placeholder");
    if (placeholder) return placeholder.trim();
    var prev = control.previousElementSibling;
    if (prev && /label/i.test(prev.tagName)) return prev.textContent.trim();
    return control.name || control.id || "Field";
  }

  function collectFormContext() {
    var forms = Array.prototype.slice.call(document.querySelectorAll("form")).filter(function (form) {
      try { return form.offsetParent !== null; } catch (error) { return false; }
    });
    if (!forms.length) return null;
    var fields = [];
    forms.slice(0, 3).forEach(function (form) {
      var controls = form.querySelectorAll("input, select, textarea");
      Array.prototype.forEach.call(controls, function (control) {
        if (fields.length >= 40) return;
        if (control.disabled) return;
        var type = String(control.type || control.tagName).toLowerCase();
        if (["hidden", "submit", "button", "reset", "image"].indexOf(type) !== -1) return;
        var name = String(control.name || control.id || "").trim();
        if (!name) return;
        var filled = type === "checkbox" || type === "radio"
          ? Boolean(control.checked)
          : Boolean(String(control.value || "").trim());
        var valid = true;
        if (filled && typeof control.checkValidity === "function") valid = control.checkValidity();
        fields.push({
          name: name.slice(0, 60),
          label: labelFor(control).slice(0, 60),
          type: type.slice(0, 30),
          required: Boolean(control.required || control.getAttribute("aria-required") === "true"),
          filled: filled,
          valid: valid
        });
      });
    });
    state.formContextAvailable = fields.length > 0;
    if (!fields.length) return null;
    return { page: location.pathname, step: document.title.slice(0, 80), fields: fields };
  }

  /* -------------------------------------------------------------------------
     Messaging
     ---------------------------------------------------------------------- */
  function sendMessage(text, options) {
    options = options || {};
    text = String(text || "").trim();
    if (!text || state.thinking) return;
    if (!state.boot) {
      toast("Assistant is starting", "Please wait a moment and try again.", "");
      return;
    }
    state.hasInteracted = true;
    stopSpeaking();
    addMessage("user", text, { time: nowTime() });
    showThinking();
    el.send.disabled = true;
    renderChips([]);

    var payload = {
      conversation_ref: state.conversationRef,
      visitor_id: visitorId(),
      message: text,
      page: location.pathname,
      confirm_handover: Boolean(options.confirmHandover),
      form_context: collectFormContext()
    };

    api("/message", { method: "POST", body: JSON.stringify(payload) }).then(function (data) {
      hideThinking();
      state.conversationRef = data.conversation_ref || state.conversationRef;
      if (data.persona) applyPersona(data.persona, true);
      addMessage("assistant", data.reply, {
        persona: data.persona || state.persona,
        cards: data.cards || [],
        handover: data.handover || null,
        action: data.action || null,
        time: nowTime()
      });
      if (data.handover) {
        state.handoverStatus[data.handover.ref] = data.handover.status;
        toast("Human handover requested", "Reference " + data.handover.ref + ". Waiting for staff acceptance.", "handover");
      }
      renderChips((data.suggestions && data.suggestions.length) ? data.suggestions : ((state.boot && state.boot.quick_prompts) || []));
      setStatus("Online", "ok");
      speak(data.speech || data.reply);
      scrollThread();
    }).catch(function (error) {
      hideThinking();
      var message = error && error.message ? error.message : "I could not complete that request safely. No data was changed.";
      addMessage("assistant", message, { persona: state.persona, time: nowTime() });
      setStatus("Online", "ok");
    }).then(function () {
      el.send.disabled = false;
      try { el.input.focus(); } catch (error) { /* ignore */ }
    });
  }

  /* -------------------------------------------------------------------------
     Events, toasts and handovers
     ---------------------------------------------------------------------- */
  function toast(title, text, kind) {
    if (!el.toasts) return;
    var node = document.createElement("div");
    node.className = "dh-toast";
    node.innerHTML =
      '<span class="dh-toast-icon" aria-hidden="true">' + (kind === "handover" ? "🤝" : (kind === "payment" ? "✓" : "●")) + '</span>' +
      '<span class="dh-toast-main"><span class="dh-toast-title">' + esc(title) + '</span><span class="dh-toast-text">' + esc(text) + '</span></span>';
    node.addEventListener("click", function () {
      openPanel();
      removeToast(node);
    });
    el.toasts.appendChild(node);
    setTimeout(function () { removeToast(node); }, 11000);
  }

  function removeToast(node) {
    if (!node || !node.parentNode) return;
    node.classList.add("is-out");
    setTimeout(function () { if (node.parentNode) node.parentNode.removeChild(node); }, 260);
  }

  function updateBadge(count) {
    if (!el.launcherBadge) return;
    var n = Math.max(0, Number(count) || 0);
    el.launcherBadge.textContent = n > 9 ? "9+" : String(n);
    el.launcherBadge.classList.toggle("is-visible", n > 0);
  }

  function eventIsImportant(event) {
    var type = String((event && event.type) || "").toLowerCase();
    return type.indexOf("payment") !== -1 || type.indexOf("commission") !== -1 ||
      type.indexOf("handover") !== -1 || type.indexOf("property.added") !== -1 ||
      type.indexOf("installment") !== -1 || type.indexOf("onboarding") !== -1;
  }

  function pollEvents() {
    if (!state.boot || !state.boot.authenticated) return;
    api("/events").then(function (data) {
      var events = (data.events || []).filter(function (event) {
        return state.seenEvents.indexOf(event.key) === -1;
      });
      if (!events.length) return;
      var fresh = [];
      events.forEach(function (event) {
        state.seenEvents.push(event.key);
        state.seenEvents = state.seenEvents.slice(-MAX_STORED_EVENTS);
        fresh.push(event.key);
        var kind = String(event.type || "").toLowerCase().indexOf("payment") !== -1 ? "payment" : (String(event.type || "").toLowerCase().indexOf("handover") !== -1 ? "handover" : "");
        toast(event.title || "Bliss Legacy update", event.message || "", kind);
        if (state.open) {
          addMessage("system", "🔔 " + (event.title || "Update") + " — " + (event.message || ""));
        }
        if (state.voiceEnabled && state.openedOnce && eventIsImportant(event) && !state.listening && document.activeElement !== el.input) {
          speak((event.title || "Bliss Legacy update") + ". " + (event.message || ""));
        }
      });
      writeStore({ seenEvents: state.seenEvents });
      if (fresh.length) {
        updateBadge(fresh.length);
        api("/events/ack", { method: "POST", body: JSON.stringify({ keys: fresh }) }).catch(function () { /* optional */ });
        setTimeout(function () { updateBadge(0); }, 6000);
      }
    }).catch(function () { /* polling is best-effort */ });
  }

  function loadPendingHandovers() {
    if (!state.boot || !state.boot.authenticated || state.boot.role === "Client") return;
    api("/handovers").then(function (data) {
      state.pendingHandovers = data.handovers || [];
      if (state.pendingHandovers.length) {
        updateBadge(state.pendingHandovers.length);
        if (state.open) renderHandoverRequests();
        var fresh = state.pendingHandovers.filter(function (h) { return state.seenHandovers.indexOf(h.id) === -1; });
        if (fresh.length && state.hasInteracted) {
          toast("Handover request waiting", fresh[0].client_name ? fresh[0].client_name + " is waiting for a human agent." : "A customer is waiting for a human agent.", "handover");
          if (state.voiceEnabled && state.openedOnce && !state.listening && document.activeElement !== el.input) speak("A customer is waiting for a human handover. Open the assistant to accept or decline.");
        }
        fresh.forEach(function (h) { state.seenHandovers.push(h.id); });
        writeStore({ seenHandovers: state.seenHandovers.slice(-40) });
      }
    }).catch(function () { /* optional */ });
  }

  function renderHandoverRequests() {
    (state.pendingHandovers || []).forEach(function (handover) {
      if (state.shownHandoverCards[handover.id]) return;
      state.shownHandoverCards[handover.id] = true;
      var box = document.createElement("div");
      box.className = "dh-handover";
      box.innerHTML =
        '<span class="dh-handover-label">Human handover request</span>' +
        '<div class="dh-handover-title">' + esc(handover.client_name || handover.requested_by_name || "A customer") + '</div>' +
        '<p class="dh-handover-text">' + esc(handover.summary || "A customer requested a human staff member.") + '<br>Reference ' + esc(handover.handover_ref || "") + ' · ' + esc(handover.department || "") + '</p>' +
        '<div class="dh-handover-actions">' +
          '<button type="button" class="dh-action" data-handover-accept="' + esc(handover.id) + '">Accept handover</button>' +
          '<button type="button" class="dh-action secondary" data-handover-decline="' + esc(handover.id) + '">Decline</button>' +
        '</div>';
      box.querySelector("[data-handover-accept]").addEventListener("click", function () { actOnHandover(handover.id, "accept", box); });
      box.querySelector("[data-handover-decline]").addEventListener("click", function () { actOnHandover(handover.id, "decline", box); });
      el.thread.appendChild(box);
      scrollThread();
    });
  }

  function actOnHandover(id, action, box) {
    var buttons = box.querySelectorAll("button");
    Array.prototype.forEach.call(buttons, function (button) { button.disabled = true; });
    api("/handovers/" + encodeURIComponent(id) + "/" + action, { method: "POST", body: JSON.stringify({}) }).then(function (data) {
      var status = action === "accept" ? "accepted" : "declined";
      addMessage("system", status === "accepted"
        ? "You accepted handover " + (data.handover && data.handover.handover_ref ? data.handover.handover_ref : "") + ". The customer has been notified. The transcript is available below."
        : "You declined the handover. It has returned to the unassigned queue.");
      state.pendingHandovers = state.pendingHandovers.filter(function (h) { return Number(h.id) !== Number(id); });
      if (box && box.parentNode) box.parentNode.removeChild(box);
      if (status === "accepted") {
        api("/handovers/" + encodeURIComponent(id)).then(function (detail) {
          var messages = (detail.messages || []).slice(-12);
          messages.forEach(function (message) {
            addMessage(message.role === "user" ? "user" : "assistant", message.content, {
              persona: personaByKey(message.persona_key) || state.persona,
              time: String(message.created_at || "").slice(11, 16)
            });
          });
        }).catch(function () { /* transcript is optional */ });
      }
      loadPendingHandovers();
    }).catch(function (error) {
      addMessage("system", error && error.message ? error.message : "The handover could not be updated.");
      Array.prototype.forEach.call(buttons, function (button) { button.disabled = false; });
    });
  }

  function pollHandoverStatus() {
    if (!state.boot || !state.boot.authenticated) return;
    api("/handover-status").then(function (data) {
      var handover = data.handover;
      if (!handover) return;
      var previous = state.handoverStatus[handover.handover_ref];
      state.handoverStatus[handover.handover_ref] = handover.status;
      if (handover.status === "accepted" && previous !== "accepted") {
        var text = (handover.accepted_by_name || "A staff member") + " accepted your handover request" + (handover.accepted_by_role ? " (" + handover.accepted_by_role + ")" : "") + ". You can now continue with a real Bliss Legacy staff member.";
        toast("Staff member joined", text, "handover");
        if (state.open) addMessage("system", text);
        if (state.voiceEnabled && state.openedOnce) speak(text);
      }
    }).catch(function () { /* optional */ });
  }

  /* -------------------------------------------------------------------------
     Boot and panel lifecycle
     ---------------------------------------------------------------------- */
  function boot() {
    var stored = readStore();
    state.voiceEnabled = stored.voiceEnabled !== false;
    state.seenEvents = Array.isArray(stored.seenEvents) ? stored.seenEvents : [];
    state.seenHandovers = Array.isArray(stored.seenHandovers) ? stored.seenHandovers : [];
    el.mute.setAttribute("aria-pressed", state.voiceEnabled ? "true" : "false");
    el.mute.textContent = state.voiceEnabled ? "🔊" : "🔇";
    if (!state.voiceEnabled) el.voiceNote.textContent = "Voice muted · text only";

    var page = location.pathname + (location.pathname === "/" ? "" : "");
    api("/bootstrap?page=" + encodeURIComponent(page) + "&visitor=" + encodeURIComponent(visitorId())).then(function (data) {
      state.boot = data;
      state.conversationRef = data.conversation_ref || null;
      state.rate = data.preferences.rate || 1;
      state.pitch = data.preferences.pitch || 1;
      state.volume = data.preferences.volume || 1;
      state.messages = (data.messages || []).slice(-MAX_MESSAGES);
      applyPersona(data.persona, false);
      if (data.authenticated && data.role !== "Client" && data.staff_availability) {
        el.avail.hidden = false;
        renderAvailability(data.staff_availability);
      }
      state.formContextAvailable = Boolean(collectFormContext());

      if (state.messages.length) {
        state.messages.forEach(function (message) {
          addMessage(message.role === "user" ? "user" : "assistant", message.content, {
            persona: personaByKey(message.persona) || data.persona,
            cards: message.cards || [],
            time: String(message.created_at || "").slice(11, 16)
          });
        });
        state.greeted = true;
      }

      renderChips(data.quick_prompts || []);
      state.pendingHandovers = data.pending_handovers || [];
      if (state.pendingHandovers.length) updateBadge(state.pendingHandovers.length);

      setTimeout(function () {
        state.formContextAvailable = Boolean(collectFormContext());
        renderChips(data.quick_prompts || []);
      }, 1800);

      setInterval(function () { loadVoices(); }, 3000);
      if (state.synth) {
        state.synth.onvoiceschanged = loadVoices;
        loadVoices();
      }
      setupRecognition();
      pollEvents();
      pollHandoverStatus();
      loadPendingHandovers();
      state.eventTimer = setInterval(pollEvents, 45000);
      state.handoverTimer = setInterval(function () {
        loadPendingHandovers();
        pollHandoverStatus();
      }, 60000);
    }).catch(function () {
      state.boot = {
        authenticated: false, role: "Visitor", quick_prompts: ["Find a property", "How do I register?", "Talk to a human"],
        persona: {
          key: "adaora", name: "Adaora", gender: "female", title: "Main Concierge", department: "Client Experience",
          accent: "#00B522", hairStyle: "updo", voice: { gender: "female", rate: 0.98, pitch: 1.04 },
          avatar: { skin: "#8A5A3B", hair: "#1B1713", outfit: "#0B3D2E", shirt: "#F4EFE4", earrings: true, beard: false }
        }
      };
      applyPersona(state.boot.persona, false);
      renderChips(state.boot.quick_prompts);
      el.caption.textContent = "The assistant is temporarily unavailable. You can still use the website normally.";
    });
  }

  function greetingText() {
    if (state.boot && state.boot.greeting) return state.boot.greeting;
    return "Welcome to Bliss Legacy Limited. I am Adaora. I can help you find a real published property, create an account, reset a password by phone or connect you with our team.";
  }

  function openPanel() {
    if (state.open) return;
    state.open = true;
    state.hasInteracted = true;
    state.openedOnce = true;
    el.root.classList.add("is-open");
    el.panel.setAttribute("aria-hidden", "false");
    el.launcher.setAttribute("aria-expanded", "true");
    if (window.innerWidth <= 520) document.body.classList.add("dh-lock-scroll");

    if (!el.thread.children.length) {
      var greeting = greetingText();
      addMessage("assistant", greeting, { persona: state.persona, time: nowTime() });
      var stored = readStore();
      var lastGreeting = Number(stored.greetingAt || 0);
      var shouldSpeak = state.voiceEnabled && (Date.now() - lastGreeting > 6 * 60 * 60 * 1000);
      if (shouldSpeak) {
        speak(greeting);
        writeStore({ greetingAt: Date.now() });
      }
      state.greeted = true;
    }
    var pending = collectFormContext();
    if (pending && pending.fields.some(function (field) { return field.required && !field.filled; })) {
      el.caption.textContent = "I can check this form for missing fields when you are ready.";
    }
    if (state.pendingHandovers.length) renderHandoverRequests();
    setTimeout(function () {
      try { el.input.focus({ preventScroll: true }); } catch (error) { try { el.input.focus(); } catch (e) {} }
      scrollThread();
    }, 260);
  }

  function closePanel() {
    if (!state.open) return;
    state.open = false;
    el.root.classList.remove("is-open");
    el.panel.setAttribute("aria-hidden", "true");
    el.launcher.setAttribute("aria-expanded", "false");
    document.body.classList.remove("dh-lock-scroll");
    if (state.listening && state.recognition) { try { state.recognition.stop(); } catch (error) {} }
    stopSpeaking();
    try { el.launcher.focus({ preventScroll: true }); } catch (error) {}
  }

  /* -------------------------------------------------------------------------
     Start
     ---------------------------------------------------------------------- */
  function init() {
    if (!document.body) return;
    injectCss();
    buildRoot();
    bindEvents();
    boot();
    window.BlissDigitalHuman = {
      open: openPanel,
      close: closePanel,
      ask: function (text) { openPanel(); sendMessage(text); },
      speak: function (text) { speak(text); },
      persona: function () { return state.persona; },
      refresh: pollEvents
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
