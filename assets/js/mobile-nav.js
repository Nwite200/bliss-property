// Bliss Legacy Limited — shared mobile navigation fallback for static staff and
// client portal pages that do not use the role-aware staff shell.
(function () {
  function ready(fn) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }

  ready(function () {
    var sidebar = document.querySelector(".sidebar") || document.querySelector(".portal-sidebar");
    if (!sidebar) return;
    if (document.querySelector(".sidebar-toggle") || document.querySelector(".bliss-mobile-toggle")) return;

    var style = document.createElement("style");
    style.textContent = [
      "@media (max-width: 900px) {",
      ".portal-sidebar { display: flex !important; position: fixed; inset: 0 auto 0 0; width: 250px;",
      "  flex-direction: column; overflow-y: auto; transform: translateX(-100%);",
      "  transition: transform .25s ease; z-index: 56; }",
      ".portal-sidebar.open { transform: none; }",
      ".portal-main { padding: 22px 16px !important; max-width: 100% !important; }",
      ".bliss-mobile-toggle { display: inline-grid; place-items: center; position: fixed;",
      "  left: 12px; bottom: 16px; z-index: 60; width: 44px; height: 44px; border-radius: 50%;",
      "  border: 1px solid rgba(255,255,255,.2); background: #17231A; color: #FFFFFF;",
      "  font-size: 18px; box-shadow: 0 6px 18px rgba(0,0,0,.22); }",
      "}",
      "@media (min-width: 901px) { .bliss-mobile-toggle { display: none; } }"
    ].join("\n");
    document.head.appendChild(style);

    var toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "bliss-mobile-toggle sidebar-toggle";
    toggle.setAttribute("aria-label", "Toggle navigation");
    toggle.setAttribute("aria-expanded", "false");
    toggle.textContent = "☰";
    document.body.appendChild(toggle);

    function close() {
      sidebar.classList.remove("open");
      toggle.setAttribute("aria-expanded", "false");
    }
    toggle.addEventListener("click", function () {
      var open = sidebar.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
    sidebar.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", close);
    });
    document.addEventListener("click", function (event) {
      if (!sidebar.classList.contains("open")) return;
      if (sidebar.contains(event.target) || toggle.contains(event.target)) return;
      close();
    });
    window.addEventListener("resize", function () {
      if (window.innerWidth > 900) close();
    });
  });
})();
