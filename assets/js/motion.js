// Bliss Legacy Limited — one global logo intro.
// Replays on every page load, refresh, direct URL, internal navigation,
// Back/Forward and dashboard view/tab changes. Hype or classic is selected by
// INTRO_STYLE in assets/js/intro-config.js. Front-end only.
(function () {
  "use strict";

  var CFG = window.BLISS_INTRO_CONFIG || {};
  var STYLE = CFG.INTRO_STYLE === "classic" ? "classic" : "hype";
  var LOGO_SRC = CFG.LOGO_SRC || "assets/images/bliss-legacy-logo.png";
  var BRAND_NAME = CFG.BRAND_NAME || "BLISS LEGACY LIMITED";
  var TAGLINE = CFG.TAGLINE || "Your Future Begins With the Right Property.";
  var NAV_MARKER = "bliss_internal_navigation";
  var NAV_MARKER_TTL = 5000;

  var reduceMotion = false;
  try {
    reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch (error) {
    reduceMotion = false;
  }

  var lowPower = false;
  try {
    var cores = Number(window.navigator.hardwareConcurrency || 8);
    var memory = Number(window.navigator.deviceMemory || 8);
    lowPower = cores <= 4 || memory <= 4;
  } catch (error) {
    lowPower = false;
  }

  var root = document.documentElement;
  var activeRun = null;
  var runCounter = 0;
  var lastStartAt = 0;
  var startedOnThisDocument = false;

  function navigationType() {
    try {
      var entry = performance.getEntriesByType("navigation")[0];
      return entry && entry.type ? entry.type : "navigate";
    } catch (error) {
      return "navigate";
    }
  }

  function clearMarker() {
    try { window.sessionStorage.removeItem(NAV_MARKER); } catch (error) {}
  }

  function consumeInternalMarker() {
    var raw = null;
    try {
      raw = window.sessionStorage.getItem(NAV_MARKER);
      window.sessionStorage.removeItem(NAV_MARKER);
    } catch (error) {
      raw = null;
    }
    if (!raw) return false;
    var timestamp = Number(raw);
    return Number.isFinite(timestamp) && Date.now() - timestamp < NAV_MARKER_TTL;
  }

  function markInternalNavigation() {
    try {
      window.sessionStorage.setItem(NAV_MARKER, String(Date.now()));
    } catch (error) {}
    window.setTimeout(function () {
      try {
        var raw = window.sessionStorage.getItem(NAV_MARKER);
        if (raw && Date.now() - Number(raw) >= NAV_MARKER_TTL) {
          window.sessionStorage.removeItem(NAV_MARKER);
        }
      } catch (error) {}
    }, NAV_MARKER_TTL + 50);
  }

  function initialMode() {
    var type = navigationType();
    if (type === "reload") {
      clearMarker();
      return "full";
    }
    if (type === "back_forward") return "short";
    if (consumeInternalMarker()) return "short";
    return "full";
  }

  function timingFor(mode) {
    if (mode === "reduced") return CFG.REDUCED || {
      total: 600, fadeIn: 250, hold: 100, fadeOut: 250, failsafe: 1100
    };
    var bucket = mode === "short" ? (CFG.SHORT || {}) : (CFG.FULL || {});
    return bucket[STYLE] || (STYLE === "classic"
      ? { total: 2700, fadeIn: 600, hold: 1500, fadeOut: 600, failsafe: 3500 }
      : {
          total: 3000,
          streak: { start: 0, duration: 300 },
          logo: { start: 300, duration: 500 },
          glitch: { start: 300, duration: 110 },
          impact: 800,
          shake: { start: 800, duration: 120 },
          ring: { start: 800, duration: 650 },
          speed: { start: 800, end: 1600 },
          sweep: { start: 800, duration: 1500 },
          lines: { start: 800, duration: 1000 },
          tagline: { start: 1600, duration: 300 },
          hold: { start: 1600, end: 2300 },
          exit: { start: 2300, duration: 700 },
          failsafe: 3800
        });
  }

  function make(tag, className) {
    var el = document.createElement(tag);
    if (className) el.className = className;
    return el;
  }

  function buildOverlay(mode) {
    var overlay = make("div", "bliss-intro style-" + STYLE + " mode-" + mode + (lowPower ? " low-power" : ""));
    overlay.setAttribute("aria-hidden", "true");
    overlay.setAttribute("role", "presentation");

    var halo = make("div", "bliss-intro__halo");
    var streak = make("div", "bliss-intro__streak");
    var sweep = make("div", "bliss-intro__sweep");
    var lines = make("div", "bliss-intro__lines");
    lines.appendChild(make("span"));
    lines.appendChild(make("span"));
    lines.appendChild(make("span"));
    var ring = make("div", "bliss-intro__ring");
    var flash = make("div", "bliss-intro__flash");

    var stage = make("div", "bliss-intro__stage");
    var camera = make("div", "bliss-intro__camera");
    var logoWrap = make("div", "bliss-intro__logo-wrap");
    var logo = make("img", "bliss-intro__logo");
    logo.src = LOGO_SRC;
    logo.alt = "";
    logo.width = 1536;
    logo.height = 1024;
    logo.decoding = "async";
    logo.onerror = function () { overlay.classList.add("has-logo-error"); };
    var fallback = make("div", "bliss-intro__fallback");
    fallback.textContent = BRAND_NAME;
    var tagline = make("div", "bliss-intro__tagline");
    tagline.textContent = TAGLINE;

    logoWrap.appendChild(logo);
    logoWrap.appendChild(fallback);
    camera.appendChild(logoWrap);
    stage.appendChild(camera);
    stage.appendChild(tagline);

    overlay.appendChild(halo);
    overlay.appendChild(streak);
    overlay.appendChild(sweep);
    overlay.appendChild(lines);
    overlay.appendChild(ring);
    overlay.appendChild(flash);
    overlay.appendChild(stage);

    return {
      overlay: overlay,
      streak: streak,
      sweep: sweep,
      lines: lines,
      ring: ring,
      flash: flash,
      camera: camera,
      logoWrap: logoWrap,
      logo: logo,
      tagline: tagline
    };
  }

  function animate(run, element, frames, options) {
    if (!element || !element.animate) return null;
    var animation = element.animate(frames, options);
    run.animations.push(animation);
    return animation;
  }

  function clearRun(run, removeNow) {
    if (!run) return;
    run.timers.forEach(function (timer) { window.clearTimeout(timer); });
    run.timers = [];
    run.interactions.forEach(function (entry) {
      document.removeEventListener(entry.name, entry.handler, { capture: true });
    });
    run.interactions = [];
    if (removeNow && run.parts.overlay.parentNode) {
      run.parts.overlay.parentNode.removeChild(run.parts.overlay);
    }
  }

  function removeRun(run) {
    if (!run) return;
    clearRun(run, true);
    if (activeRun === run) activeRun = null;
  }

  function finishRun(run, immediate) {
    if (!run || run.finished) return;
    run.finished = true;
    clearRun(run, false);
    var overlay = run.parts.overlay;
    var duration = reduceMotion ? 80 : (immediate ? 180 : 320);
    try {
      overlay.animate(
        [{ opacity: getComputedStyle(overlay).opacity || "1" }, { opacity: "0" }],
        { duration: duration, easing: "ease", fill: "both" }
      );
    } catch (error) {}
    var timer = window.setTimeout(function () {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      if (activeRun === run) activeRun = null;
    }, duration + 30);
    run.timers.push(timer);
    if (activeRun === run) activeRun = null;
  }

  function skipOnInteraction(event) {
    if (event && event.type === "keydown" && event.key !== "Escape" && event.key !== "Enter") return;
    if (activeRun) finishRun(activeRun, true);
  }

  function addSkipListeners(run) {
    ["pointerdown", "touchstart", "keydown"].forEach(function (name) {
      var handler = function (event) { skipOnInteraction(event); };
      document.addEventListener(name, handler, { capture: true, passive: true });
      run.interactions.push({ name: name, handler: handler });
    });
  }

  function schedule(run, fn, delay) {
    var timer = window.setTimeout(function () {
      if (run.token !== runCounter || run.finished) return;
      fn();
    }, delay);
    run.timers.push(timer);
  }

  function playHype(run, t) {
    var p = run.parts;
    var logoDelay = t.logo.start;
    var logoDuration = t.logo.duration;

    animate(run, p.streak, [
      { transform: "translate3d(-42vw,0,0) rotate(8deg)", opacity: 0 },
      { transform: "translate3d(0,0,0) rotate(8deg)", opacity: 1, offset: 0.45 },
      { transform: "translate3d(42vw,0,0) rotate(8deg)", opacity: 0 }
    ], { duration: t.streak.duration, delay: t.streak.start, easing: "cubic-bezier(.3,.8,.3,1)", fill: "both" });

    animate(run, p.logoWrap, [
      { opacity: 0, transform: "scale(1.15) translate3d(0,8px,0)" },
      { opacity: 1, transform: "scale(1.045)", offset: 0.55 },
      { opacity: 1, transform: "scale(0.985)", offset: 0.78 },
      { opacity: 1, transform: "scale(1)" }
    ], { duration: logoDuration, delay: logoDelay, easing: "cubic-bezier(.16,.84,.22,1)", fill: "both" });

    if (!lowPower && t.glitch && t.glitch.duration) {
      schedule(run, function () {
        p.logo.classList.add("is-glitching");
        schedule(run, function () { p.logo.classList.remove("is-glitching"); }, t.glitch.duration);
      }, t.glitch.start);
    }

    animate(run, p.ring, [
      { transform: "scale(0.2)", opacity: 0.9 },
      { transform: "scale(2.5)", opacity: 0 }
    ], { duration: t.ring.duration, delay: t.ring.start, easing: "cubic-bezier(.16,.84,.4,1)", fill: "both" });

    animate(run, p.flash, [
      { opacity: 0 },
      { opacity: 0.12, offset: 0.35 },
      { opacity: 0 }
    ], { duration: 150, delay: t.impact, easing: "ease-out", fill: "both" });

    animate(run, p.camera, [
      { transform: "translate3d(0,0,0)" },
      { transform: "translate3d(-3px,2px,0)" },
      { transform: "translate3d(3px,-2px,0)" },
      { transform: "translate3d(-2px,1px,0)" },
      { transform: "translate3d(0,0,0)" }
    ], { duration: t.shake.duration, delay: t.shake.start, easing: "linear", fill: "both" });

    animate(run, p.sweep, [
      { transform: "translate3d(-120%,0,0)", opacity: 0 },
      { transform: "translate3d(0,0,0)", opacity: 1, offset: 0.5 },
      { transform: "translate3d(120%,0,0)", opacity: 0 }
    ], { duration: t.sweep.duration, delay: t.sweep.start, easing: "ease-in-out", fill: "both" });

    animate(run, p.lines, [
      { opacity: 0 },
      { opacity: 0.65, offset: 0.35 },
      { opacity: 0.25, offset: 0.7 },
      { opacity: 0 }
    ], { duration: t.lines.duration, delay: t.lines.start, easing: "ease-out", fill: "both" });

    if (t.tagline && t.tagline.duration) {
      animate(run, p.tagline, [
        { opacity: 0, transform: "translate3d(0,6px,0)" },
        { opacity: 1, transform: "translate3d(0,0,0)" }
      ], { duration: t.tagline.duration, delay: t.tagline.start, easing: "ease-out", fill: "both" });
    }

    // Camera push-through and clip-path wipe reveal the live page underneath.
    animate(run, p.logoWrap, [
      { transform: "scale(1)" },
      { transform: "scale(1.5)" }
    ], { duration: t.exit.duration, delay: t.exit.start, easing: "cubic-bezier(.65,0,.2,1)", fill: "both" });

    animate(run, p.overlay, [
      { clipPath: "inset(0 0 0 0)" },
      { clipPath: "inset(0 0 100% 0)" }
    ], { duration: t.exit.duration, delay: t.exit.start, easing: "cubic-bezier(.75,0,.2,1)", fill: "both" });
  }

  function playClassic(run, t, reduced) {
    var p = run.parts;
    var scaleFrom = reduced ? "none" : "scale(0.96)";
    var scaleTo = reduced ? "none" : "scale(1)";
    animate(run, p.logoWrap, [
      { opacity: 0, transform: scaleFrom },
      { opacity: 1, transform: scaleTo }
    ], { duration: t.fadeIn, delay: 0, easing: "ease-out", fill: "both" });

    animate(run, p.overlay, [
      { opacity: 1 },
      { opacity: 0 }
    ], {
      duration: t.fadeOut,
      delay: t.fadeIn + t.hold,
      easing: "ease-in-out",
      fill: "both"
    });
  }

  function runIntro(mode, options) {
    var opts = options || {};
    var now = Date.now();
    if (opts.dedupe && activeRun && now - lastStartAt < 400) return;

    if (activeRun) {
      var previous = activeRun;
      activeRun = null;
      clearRun(previous, true);
    }

    var chosenMode = reduceMotion ? "reduced" : (mode === "short" ? "short" : "full");
    var t = timingFor(chosenMode);
    var token = ++runCounter;
    lastStartAt = now;
    startedOnThisDocument = true;

    var parts = buildOverlay(chosenMode);
    var run = {
      token: token,
      parts: parts,
      timers: [],
      interactions: [],
      animations: [],
      finished: false
    };
    activeRun = run;

    root.appendChild(parts.overlay);
    parts.overlay.classList.add("is-running");
    addSkipListeners(run);

    if (chosenMode === "reduced") {
      parts.overlay.classList.add("style-reduced");
      playClassic(run, t, true);
    } else if (STYLE === "classic") {
      playClassic(run, t, false);
    } else {
      playHype(run, t);
    }

    schedule(run, function () {
      if (parts.overlay && parts.overlay.parentNode) parts.overlay.parentNode.removeChild(parts.overlay);
      if (activeRun === run) activeRun = null;
    }, t.total + 80);

    schedule(run, function () {
      finishRun(run, true);
    }, t.failsafe);
  }

  function isNonViewClick(target) {
    if (!target || !target.closest) return true;
    if (target.closest(".modal, .modal-backdrop, [role='dialog'], [data-close-modal]")) return true;
    if (target.closest("input, select, textarea, label")) return true;
    var button = target.closest("button");
    if (button && (button.type === "submit" || button.hasAttribute("data-no-transition"))) return true;
    return false;
  }

  function isInternalPageLink(anchor) {
    if (!anchor) return false;
    if (anchor.target === "_blank" || anchor.hasAttribute("download")) return false;
    var href = anchor.getAttribute("href") || "";
    if (!href || href.charAt(0) === "#" || /^(?:javascript|mailto|tel):/i.test(href)) return false;
    try {
      var url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return false;
      return url.pathname !== window.location.pathname || url.search !== window.location.search;
    } catch (error) {
      return false;
    }
  }

  function onDocumentClick(event) {
    if (activeRun) finishRun(activeRun, true);
    if (isNonViewClick(event.target)) return;

    var tab = event.target.closest("[role='tab'], .tab, .tab-btn, .tab-link, [data-tab], [data-view], [data-section]");
    var pageControl = event.target.closest(".pagination a, .pagination button, #pagination a, #pagination button, .pagination [data-page], #pagination [data-page]");
    var anchor = event.target.closest("a[href]");
    var hashView = false;
    if (anchor) {
      var href = anchor.getAttribute("href") || "";
      hashView = href.charAt(0) === "#" && href.length > 1;
      if (isInternalPageLink(anchor)) markInternalNavigation();
    }

    if (tab || pageControl || hashView) {
      window.setTimeout(function () { runIntro("short"); }, 0);
    }
  }

  function onDocumentSubmit(event) {
    if (event.target && !event.target.hasAttribute("data-no-intro-nav")) markInternalNavigation();
  }

  function onPageshow(event) {
    if (event.persisted) {
      runIntro("short", { dedupe: true });
    } else if (!startedOnThisDocument) {
      runIntro(initialMode(), { dedupe: true });
    }
  }

  function onPopstate() {
    window.setTimeout(function () {
      runIntro("short", { dedupe: true });
    }, 0);
  }

  document.addEventListener("click", onDocumentClick, true);
  document.addEventListener("submit", onDocumentSubmit, true);
  window.addEventListener("pageshow", onPageshow);
  window.addEventListener("popstate", onPopstate);

  runIntro(initialMode());

  window.BlissMotion = {
    replay: function (mode) { runIntro(mode === "short" ? "short" : "full"); },
    timings: CFG,
    style: STYLE
  };
})();
