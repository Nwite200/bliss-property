// Bliss Legacy Limited — single global logo-intro animation.
// Replays on every navigation/render of a page, Back/Forward restores, direct
// URLs and refreshes. Front-end only: no auth, API or form behaviour is changed.
(function () {
  "use strict";

  var LOGO_SRC = "assets/images/bliss-legacy-logo.png";
  var TIMINGS = {
    fadeIn: 600,
    hold: 1400,
    fadeOut: 600,
    failsafe: 3400,
    reducedFadeIn: 120,
    reducedHold: 280,
    reducedFadeOut: 120,
    reducedFailsafe: 900,
    skipFadeOut: 220
  };

  var reduceMotion = false;
  try {
    reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch (error) {
    reduceMotion = false;
  }

  var root = document.documentElement;
  var activeRun = null;
  var runCounter = 0;
  var lastStartAt = 0;
  var startedOnThisDocument = false;

  function timing() {
    return reduceMotion
      ? {
          fadeIn: TIMINGS.reducedFadeIn,
          hold: TIMINGS.reducedHold,
          fadeOut: TIMINGS.reducedFadeOut,
          failsafe: TIMINGS.reducedFailsafe
        }
      : TIMINGS;
  }

  function clearRun(run, removeNow) {
    if (!run) return;
    run.timers.forEach(function (timer) { window.clearTimeout(timer); });
    run.timers = [];
    run.interactions.forEach(function (entry) {
      document.removeEventListener(entry.name, entry.handler, { capture: true });
    });
    run.interactions = [];
    if (run.overlay && run.overlay.parentNode) {
      if (removeNow) {
        run.overlay.parentNode.removeChild(run.overlay);
      } else {
        run.overlay.classList.remove("is-visible");
        run.overlay.classList.add("is-leaving");
      }
    }
  }

  function finishRun(run, immediate) {
    if (!run || run.finished) return;
    run.finished = true;
    var t = timing();
    clearRun(run, false);
    var delay = reduceMotion ? 1 : (immediate ? TIMINGS.skipFadeOut : t.fadeOut);
    var timer = window.setTimeout(function () {
      if (run.overlay && run.overlay.parentNode) run.overlay.parentNode.removeChild(run.overlay);
      run.overlay = null;
    }, delay);
    run.timers.push(timer);
    if (activeRun === run) activeRun = null;
  }

  function createOverlay() {
    var overlay = document.createElement("div");
    overlay.className = "bliss-intro";
    overlay.setAttribute("aria-hidden", "true");
    overlay.setAttribute("role", "presentation");

    var stage = document.createElement("div");
    stage.className = "bliss-intro__stage";

    var image = document.createElement("img");
    image.className = "bliss-intro__logo";
    image.src = LOGO_SRC;
    image.alt = "";
    image.width = 1536;
    image.height = 1024;
    image.decoding = "async";
    image.onerror = function () {
      overlay.classList.add("has-logo-error");
    };

    var fallback = document.createElement("div");
    fallback.className = "bliss-intro__fallback";
    fallback.textContent = "BLISS LEGACY LIMITED";

    stage.appendChild(image);
    stage.appendChild(fallback);
    overlay.appendChild(stage);
    return overlay;
  }

  function skipOnInteraction(event) {
    if (event && event.type === "keydown") {
      if (event.key !== "Escape" && event.key !== "Enter") return;
    }
    if (activeRun) finishRun(activeRun, true);
  }

  function addInteractionSkips(run) {
    ["pointerdown", "touchstart", "keydown"].forEach(function (name) {
      var handler = function (event) { skipOnInteraction(event); };
      document.addEventListener(name, handler, { capture: true, passive: true });
      run.interactions.push({ name: name, handler: handler });
    });
  }

  function runIntro(options) {
    var opts = options || {};
    var now = Date.now();

    // Router-level dedupe: pageshow + popstate can both fire for one Back
    // navigation. If an intro just started, do not stack a second one.
    if (opts.dedupe && activeRun && now - lastStartAt < 350) return;

    // A newer navigation always wins. Cancel the previous run immediately.
    if (activeRun) {
      var previous = activeRun;
      activeRun = null;
      clearRun(previous, true);
    }

    var token = ++runCounter;
    lastStartAt = now;
    var t = timing();
    var overlay = createOverlay();
    var run = {
      token: token,
      overlay: overlay,
      timers: [],
      interactions: [],
      finished: false
    };
    activeRun = run;
    startedOnThisDocument = true;

    root.appendChild(overlay);
    run.interactions = [];

    window.requestAnimationFrame(function () {
      if (run.token !== runCounter || !run.overlay) return;
      window.requestAnimationFrame(function () {
        if (run.token === runCounter && run.overlay) run.overlay.classList.add("is-visible");
      });
    });

    addInteractionSkips(run);

    function schedule(fn, delay) {
      var timer = window.setTimeout(function () {
        if (run.token !== runCounter || run.finished) return;
        fn();
      }, delay);
      run.timers.push(timer);
    }

    schedule(function () {
      if (run.overlay) run.overlay.classList.add("is-leaving");
    }, t.fadeIn + t.hold);

    schedule(function () {
      if (run.overlay && run.overlay.parentNode) run.overlay.parentNode.removeChild(run.overlay);
      run.overlay = null;
      if (activeRun === run) activeRun = null;
    }, t.fadeIn + t.hold + t.fadeOut);

    schedule(function () {
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

  function onDocumentClick(event) {
    // Real pointer clicks already skip via pointerdown; this also covers
    // keyboard-activated clicks and programmatic activation.
    if (activeRun) finishRun(activeRun, true);
    if (isNonViewClick(event.target)) return;

    var tab = event.target.closest("[role='tab'], .tab, .tab-btn, .tab-link, [data-tab], [data-view], [data-section]");
    var pageControl = event.target.closest(".pagination a, .pagination button, #pagination a, #pagination button, [data-page]");
    var hashLink = event.target.closest("a[href]");
    var isHashView = false;
    if (hashLink) {
      var href = hashLink.getAttribute("href") || "";
      isHashView = href.charAt(0) === "#" && href.length > 1;
    }

    if (tab || pageControl || isHashView) {
      // One animation for the click that changed the visible view.
      window.setTimeout(function () { runIntro({ source: "view-change" }); }, 0);
    }
  }

  function onPageshow(event) {
    if (event.persisted) {
      // Back/Forward from the bfcache: the document scripts do not re-run.
      runIntro({ source: "bfcache", dedupe: true });
      return;
    }
    if (!startedOnThisDocument) runIntro({ source: "pageshow", dedupe: true });
  }

  function onPopstate() {
    window.setTimeout(function () {
      runIntro({ source: "popstate", dedupe: true });
    }, 0);
  }

  document.addEventListener("click", onDocumentClick, true);
  window.addEventListener("pageshow", onPageshow);
  window.addEventListener("popstate", onPopstate);

  // First render, refresh or direct URL: one immediate run. Content is parsed
  // underneath the fixed overlay and data loading is never blocked.
  runIntro({ source: "initial" });

  window.BlissMotion = {
    replay: function () { runIntro({ source: "manual" }); },
    timings: TIMINGS
  };
})();
