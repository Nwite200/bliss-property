// Bliss Legacy Limited — premium logo intro and subtle view transitions.
// Front-end only. This file does not touch auth, API calls, forms or data.
(function () {
  "use strict";

  var INTRO_KEY = "bliss_intro_played_v1";
  var LOGO_SRC = "assets/images/bliss-legacy-logo.png";
  var INTRO_LEAVE_AT = 1500;
  var INTRO_REMOVE_AT = 2010;
  var INTRO_FAILSAFE_AT = 2900;

  var root = document.documentElement;
  var reduceMotion = false;
  try {
    reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch (error) {
    reduceMotion = false;
  }

  var path = String(window.location.pathname || "/").replace(/\/+$/, "") || "/";
  var authPage = /(?:^|\/)(login|client-login|signup|forgot-password|client-register)(?:\.html)?$/i.test(path);
  var introEligible = !authPage;

  var intro = null;
  var introStarted = false;
  var introFinished = false;
  var introTimers = [];
  var transitionTimer = null;
  var interactionEvents = ["pointerdown", "touchstart", "keydown", "wheel"];

  function storageGet() {
    try {
      return window.sessionStorage.getItem(INTRO_KEY) === "1";
    } catch (error) {
      return false;
    }
  }

  function storageSet() {
    try {
      window.sessionStorage.setItem(INTRO_KEY, "1");
    } catch (error) {
      /* Private mode or blocked storage: intro may repeat; never break the page. */
    }
  }

  function clearIntroTimers() {
    introTimers.forEach(function (timer) { window.clearTimeout(timer); });
    introTimers = [];
  }

  function removeInteractionListeners() {
    interactionEvents.forEach(function (name) {
      document.removeEventListener(name, onInteraction, true);
    });
  }

  function schedule(fn, delay) {
    var timer = window.setTimeout(fn, delay);
    introTimers.push(timer);
    return timer;
  }

  function finishIntro(immediate) {
    if (!intro || introFinished) return;
    introFinished = true;
    clearIntroTimers();
    removeInteractionListeners();
    intro.classList.remove("is-visible");
    intro.classList.add("is-leaving");
    var delay = immediate ? 180 : 500;
    schedule(function () {
      if (intro && intro.parentNode) intro.parentNode.removeChild(intro);
      intro = null;
    }, reduceMotion ? 1 : delay);
  }

  function onInteraction() {
    finishIntro(true);
  }

  function buildIntro() {
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
      finishIntro(true);
    };

    stage.appendChild(image);
    overlay.appendChild(stage);
    return overlay;
  }

  function startIntro() {
    if (introStarted) return;
    introStarted = true;
    storageSet();

    intro = buildIntro();
    root.appendChild(intro);

    // One frame after insertion so the opacity/scale transition starts cleanly.
    window.requestAnimationFrame(function () {
      if (!intro) return;
      window.requestAnimationFrame(function () {
        if (intro) intro.classList.add("is-visible");
      });
    });

    interactionEvents.forEach(function (name) {
      document.addEventListener(name, onInteraction, { capture: true, passive: true });
    });

    schedule(function () {
      if (intro) intro.classList.add("is-leaving");
    }, INTRO_LEAVE_AT);

    schedule(function () {
      if (intro && intro.parentNode) intro.parentNode.removeChild(intro);
      intro = null;
      removeInteractionListeners();
    }, INTRO_REMOVE_AT);

    // Failsafe: the overlay always disappears even if an asset or animation fails.
    schedule(function () {
      finishIntro(true);
    }, INTRO_FAILSAFE_AT);
  }

  function transitionTarget() {
    return document.querySelector("main.dash-main") ||
      document.querySelector("main.portal-main") ||
      document.querySelector("main");
  }

  function runViewTransition() {
    if (reduceMotion) return;
    var target = transitionTarget();
    if (!target) return;

    if (transitionTimer) {
      window.clearTimeout(transitionTimer);
      transitionTimer = null;
    }

    target.classList.remove("bliss-view-enter");
    // Force a style flush so rapid clicks restart the same short transition
    // instead of queuing animations.
    void target.offsetWidth;
    target.classList.add("bliss-view-enter");

    transitionTimer = window.setTimeout(function () {
      target.classList.remove("bliss-view-enter");
      transitionTimer = null;
    }, 340);
  }

  function isNonViewClick(target) {
    if (!target || !target.closest) return false;
    if (target.closest(".modal, .modal-backdrop, [role='dialog'], [data-close-modal]")) return true;
    if (target.closest("input, select, textarea, label")) return true;
    var button = target.closest("button");
    if (button && (button.type === "submit" || button.getAttribute("data-no-transition") !== null)) return true;
    return false;
  }

  function onDocumentClick(event) {
    if (introStarted) finishIntro(true);
    if (isNonViewClick(event.target)) return;

    var tab = event.target.closest("[role='tab'], .tab, .tab-btn, .tab-link, [data-tab], [data-view]");
    var pageControl = event.target.closest(".pagination a, .pagination button, #pagination a, #pagination button, [data-page]");
    if (tab || pageControl) {
      window.setTimeout(runViewTransition, 0);
    }
  }

  function onDocumentKeydown(event) {
    if (introStarted) finishIntro(true);
  }

  function onAnchorClick(event) {
    var anchor = event.target.closest ? event.target.closest("a[href]") : null;
    if (!anchor) return;
    var href = anchor.getAttribute("href") || "";
    if (href.charAt(0) === "#" && href.length > 1) {
      window.setTimeout(runViewTransition, 0);
    }
  }

  if (introEligible && !reduceMotion && !storageGet()) {
    startIntro();
  }

  document.addEventListener("click", onDocumentClick, true);
  document.addEventListener("keydown", onDocumentKeydown, true);
  document.addEventListener("click", onAnchorClick, true);

  if (!introStarted) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", runViewTransition, { once: true });
    } else {
      runViewTransition();
    }
  }

  window.BlissMotion = {
    transition: runViewTransition,
    finishIntro: finishIntro
  };
})();
