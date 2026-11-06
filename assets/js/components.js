// Bliss Legacy Limited — Reusable Frontend Components & Utilities
window.Bliss = window.Bliss || {};

Bliss.money = function(n) {
  if (n === undefined || n === null || isNaN(n)) return "₦0";
  return "₦" + Number(n).toLocaleString("en-NG");
};

Bliss.config = function() {
  return window.BLIS_CONFIG || {};
};

Bliss.properties = function() {
  return window.BLIS_PROPERTIES || [];
};

Bliss.branches = function() {
  return window.BLIS_BRANCHES || [];
};

Bliss.findProperty = function(idOrSlug) {
  if (!idOrSlug) return null;
  const list = Bliss.properties();
  return list.find(p => p.id === idOrSlug || p.slug === idOrSlug) || null;
};

Bliss.whatsappLink = function(msg) {
  const c = Bliss.config();
  const num = String(c.whatsappNumber || "").replace(/\D/g, "");
  if (!num) return null;
  const text = msg || "Hello Bliss Legacy Limited, I would like to make an enquiry regarding your properties.";
  return `https://wa.me/${num}?text=${encodeURIComponent(text)}`;
};

Bliss.enquireWhatsApp = function(msg) {
  const url = Bliss.whatsappLink(msg);
  if (!url) {
    alert("WhatsApp contact has not been configured yet. Please use the phone or email shown on the site.");
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
};

Bliss.renderHeader = function(activePage) {
  const c = Bliss.config();
  const isDetails = activePage === 'property-detail';
  const homePrefix = isDetails ? 'index.html' : '';

  return `
  <div class="topline">
    <div class="container topline-inner">
      <div class="topline-left">
        <span>Verified Property Ownership & Investment in Nigeria</span>
      </div>
      <div class="topline-right">
        <span>Serving Clients Across 6 Branches Nationwide</span>
        <span class="topline-sep">•</span>
        <a href="${c.phone ? 'tel:' + c.phone : '#contact'}" class="topline-contact">${c.phone || 'Phone not configured'}</a>
      </div>
    </div>
  </div>

  <header class="site-header" id="siteHeader">
    <div class="container nav-wrapper">
      <a class="brand" href="${homePrefix}#home" aria-label="${c.companyName} Home">
        <img src="assets/images/bliss-legacy-logo.png" alt="${c.companyName} Official Logo" class="brand-img" onerror="this.src='bliss-legacy-logo.png'">
      </a>

      <nav class="nav-links" id="navLinks">
        <a href="${homePrefix}#home" class="${activePage === 'home' ? 'active' : ''}">Home</a>
        <a href="${homePrefix}#properties" class="${activePage === 'properties' ? 'active' : ''}">Properties</a>
        <a href="${homePrefix}#about" class="${activePage === 'about' ? 'active' : ''}">About Us</a>
        <a href="${homePrefix}#branches" class="${activePage === 'branches' ? 'active' : ''}">Our Branches</a>
        <a href="${homePrefix}#contact" class="${activePage === 'contact' ? 'active' : ''}">Contact</a>
        <a href="client-login.html" class="nav-login-mobile">Client Login</a>
      </nav>

      <div class="nav-actions">
        <a href="client-login.html" class="btn btn-login" title="Client Portal">Client Login</a>
        <a href="${homePrefix}#properties" class="btn btn-green btn-nav-cta">Explore Properties</a>
        <button class="menu-btn" id="menuBtn" aria-label="Toggle navigation menu" aria-expanded="false">
          <span class="menu-bar"></span>
          <span class="menu-bar"></span>
          <span class="menu-bar"></span>
        </button>
      </div>
    </div>
  </header>`;
};

Bliss.renderFooter = function() {
  const c = Bliss.config();
  const currentYear = new Date().getFullYear();

  return `
  <footer class="site-footer">
    <div class="container footer-content">
      <div class="footer-grid">
        <div class="footer-col footer-col-brand">
          <a href="index.html#home" class="footer-brand-link">
            <img class="footer-logo" src="assets/images/bliss-legacy-logo.png" alt="${c.companyName}" onerror="this.src='bliss-legacy-logo.png'">
          </a>
          <p class="footer-bio">
            Discover exceptional property opportunities with Bliss Legacy Limited. We make property ownership and investment straightforward, transparent and rewarding across Nigeria.
          </p>
          <div class="footer-trust-badge">
            <span class="badge-dot"></span> Registered & Verified Properties
          </div>
        </div>

        <div class="footer-col">
          <h4 class="footer-heading">Quick Links</h4>
          <ul class="footer-links-list">
            <li><a href="index.html#home">Home</a></li>
            <li><a href="index.html#properties">Explore Properties</a></li>
            <li><a href="index.html#about">About Bliss Legacy</a></li>
            <li><a href="index.html#branches">Our Branches</a></li>
            <li><a href="index.html#why">Why Choose Us</a></li>
            <li><a href="index.html#contact">Contact & Enquiries</a></li>
          </ul>
        </div>

        <div class="footer-col">
          <h4 class="footer-heading">Our Branches</h4>
          <ul class="footer-links-list">
            <li><a href="index.html#branches">Head Office (Lagos)</a></li>
            <li><a href="index.html#branches">Ikeja Branch (Lagos)</a></li>
            <li><a href="index.html#branches">Ajah Branch (Lagos)</a></li>
            <li><a href="index.html#branches">Asaba Branch (Delta)</a></li>
            <li><a href="index.html#branches">Ihama Branch (Benin City)</a></li>
            <li><a href="index.html#branches">Obakhavba Branch (Benin City)</a></li>
          </ul>
        </div>

        <div class="footer-col">
          <h4 class="footer-heading">Connect With Us</h4>
          <div class="footer-contact-items">
            <div class="footer-contact-item">
              <span class="contact-lbl">Phone Support:</span>
              <span class="contact-val">${c.phone || 'Phone not configured'}</span>
            </div>
            <div class="footer-contact-item">
              <span class="contact-lbl">Email Address:</span>
              <span class="contact-val">${c.email || 'Email not configured'}</span>
            </div>
            <div class="footer-contact-item">
              <span class="contact-lbl">Headquarters:</span>
              <span class="contact-val">${c.address || 'Head office address not configured'}</span>
            </div>
          </div>
          <div class="footer-social-strip">
            <a href="${c.social?.facebook || '#'}" target="_blank" rel="noopener" aria-label="Facebook">FB</a>
            <a href="${c.social?.instagram || '#'}" target="_blank" rel="noopener" aria-label="Instagram">IG</a>
            <a href="${c.social?.twitter || '#'}" target="_blank" rel="noopener" aria-label="Twitter">X</a>
            <a href="${c.social?.linkedin || '#'}" target="_blank" rel="noopener" aria-label="LinkedIn">IN</a>
            <a href="#" class="footer-wa-pill" id="footerWaBtn">WhatsApp ↗</a>
          </div>
        </div>
      </div>

      <div class="footer-bottom">
        <div class="footer-bottom-left">
          <span>&copy; ${currentYear} ${c.companyName}. All rights reserved.</span>
          <span class="demo-tag">Demonstration property content shown for phase 1 public review.</span>
        </div>
        <div class="footer-bottom-right">
          <a href="login.html" class="client-portal-link">Client & Staff Portal →</a>
        </div>
      </div>
    </div>
  </footer>`;
};

Bliss.initNav = function() {
  const menuBtn = document.getElementById("menuBtn");
  const navLinks = document.getElementById("navLinks");
  const siteHeader = document.getElementById("siteHeader");

  if (menuBtn && navLinks) {
    menuBtn.addEventListener("click", () => {
      const isOpen = navLinks.classList.toggle("open");
      menuBtn.classList.toggle("open", isOpen);
      menuBtn.setAttribute("aria-expanded", isOpen ? "true" : "false");
    });

    document.querySelectorAll("#navLinks a").forEach(link => {
      link.addEventListener("click", () => {
        navLinks.classList.remove("open");
        menuBtn.classList.remove("open");
        menuBtn.setAttribute("aria-expanded", "false");
      });
    });
  }

  // Scroll listener for sticky header elevation
  window.addEventListener("scroll", () => {
    if (window.scrollY > 20) {
      siteHeader?.classList.add("scrolled");
    } else {
      siteHeader?.classList.remove("scrolled");
    }
  }, { passive: true });

  // Attach footer WhatsApp button
  const footerWa = document.getElementById("footerWaBtn");
  if (footerWa) {
    footerWa.addEventListener("click", (e) => {
      e.preventDefault();
      Bliss.enquireWhatsApp("Hello Bliss Legacy Limited, I would like to make an enquiry about your properties.");
    });
  }

  // Attach all general WhatsApp links with data-message
  document.querySelectorAll(".wa-link").forEach(a => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      const msg = a.getAttribute("data-message") || "Hello Bliss Legacy Limited, I would like to make a property enquiry.";
      Bliss.enquireWhatsApp(msg);
    });
  });
};

Bliss.observeFade = function() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add("visible");
        observer.unobserve(entry.target);
      }
    });
  }, {
    threshold: 0.1,
    rootMargin: "0px 0px -40px 0px"
  });

  document.querySelectorAll(".fade-in").forEach(el => observer.observe(el));
};
