/* Bliss Legacy Limited — security UI helpers.
   Loaded early in <head> on every page.
   - Image fallback for data-fallback-src (replaces inline onerror)
   - Delegated actions (replaces inline onclick)
   - Per-session CSRF double-submit header on fetch
   No inline handlers are required, so a nonce-based CSP can block script injection. */
(function () {
  "use strict";

  document.addEventListener("error", function (event) {
    var img = event.target;
    if (!img || String(img.tagName || "").toUpperCase() !== "IMG") return;
    if (img.getAttribute("data-fallback-applied") === "1") return;
    var fallback = img.getAttribute("data-fallback-src");
    if (!fallback) return;
    img.setAttribute("data-fallback-applied", "1");
    img.src = fallback;
  }, true);

  document.addEventListener("click", function (event) {
    var target = event.target;
    if (!target || !target.closest) return;
    var close = target.closest("[data-close-modal]");
    if (close) {
      var id = close.getAttribute("data-close-modal");
      if (typeof window.closeModal === "function") window.closeModal(id);
      return;
    }
    var action = target.closest("[data-action]");
    if (action) {
      var kind = action.getAttribute("data-action");
      if (kind === "print") { event.preventDefault(); window.print(); return; }
      if (kind === "reload") { event.preventDefault(); window.location.reload(); return; }
    }
    var receipt = target.closest("[data-receipt-index]");
    if (receipt && typeof window.openReceiptModal === "function") {
      event.preventDefault();
      window.openReceiptModal(Number(receipt.getAttribute("data-receipt-index")));
      return;
    }
    var sched = target.closest("[data-schedule-action]");
    if (sched) {
      var scheduleId = Number(sched.getAttribute("data-schedule-id"));
      var scheduleAction = sched.getAttribute("data-schedule-action");
      if (scheduleAction === "edit" && typeof window.editSchedule === "function") window.editSchedule(scheduleId);
      if (scheduleAction === "history" && typeof window.scheduleHistory === "function") window.scheduleHistory(scheduleId);
      if (scheduleAction === "cancel" && typeof window.cancelSchedule === "function") window.cancelSchedule(scheduleId);
    }
  }, false);

  function readCookie(name) {
    var parts = String(document.cookie || "").split(";");
    for (var i = 0; i < parts.length; i++) {
      var part = parts[i].trim();
      var index = part.indexOf("=");
      if (index === -1) continue;
      if (part.slice(0, index) === name) {
        try { return decodeURIComponent(part.slice(index + 1)); } catch (e) { return part.slice(index + 1); }
      }
    }
    return "";
  }

  var csrfToken = readCookie("bliss_csrf");
  if (csrfToken && typeof window.fetch === "function") {
    var originalFetch = window.fetch;
    window.fetch = function (input, init) {
      try {
        var url = typeof input === "string" ? input : (input && input.url ? input.url : "");
        var absolute = new URL(url || window.location.href, window.location.href);
        var method = String((init && init.method) || (input && input.method) || "GET").toUpperCase();
        if (absolute.origin === window.location.origin && !/^(GET|HEAD|OPTIONS)$/.test(method)) {
          var headers = new Headers((init && init.headers) || (input instanceof Request ? input.headers : undefined));
          if (!headers.has("X-CSRF-Token")) headers.set("X-CSRF-Token", csrfToken);
          if (input instanceof Request) return originalFetch(new Request(input, { headers: headers }));
          init = Object.assign({}, init || {}, { headers: headers });
        }
      } catch (error) { /* fall through to the original fetch */ }
      return originalFetch(input, init);
    };
  }
})();
