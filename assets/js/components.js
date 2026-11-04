window.Bliss = window.Bliss || {};
Bliss.money = n => "₦" + Number(n).toLocaleString("en-NG");
Bliss.config = () => window.BLIS_CONFIG || {};
Bliss.properties = () => window.BLIS_PROPERTIES || [];
Bliss.findProperty = id => Bliss.properties().find(p => p.id === id || p.slug === id);

Bliss.whatsappLink = (msg) => {
  const num = (Bliss.config().whatsappNumber || "").trim();
  if (!num) return null;
  return `https://wa.me/${num}?text=${encodeURIComponent(msg)}`;
};

Bliss.enquireWhatsApp = (msg) => {
  const url = Bliss.whatsappLink(msg);
  if (!url) { alert("WhatsApp number is not configured yet. Add the official company number in assets/js/data/properties.js (BLIS_CONFIG.whatsappNumber)."); return; }
  window.open(url, "_blank", "noopener");
};

Bliss.renderHeader = (active) => {
  const c = Bliss.config();
  return `
  <div class="topline"><div class="container"><span>Thoughtful property. Lasting value.</span><span>Serving you across six locations in Nigeria</span></div></div>
  <header><div class="container nav">
    <a class="brand" href="index.html" aria-label="${c.companyName} home"><img src="assets/images/bliss-legacy-logo.png" alt="${c.companyName} logo"></a>
    <button class="menu-btn" id="menuBtn" aria-label="Open navigation">☰</button>
    <nav class="links" id="navLinks">
      <a href="index.html" class="${active==='home'?'active':''}">Home</a>
      <a href="index.html#properties" class="${active==='properties'?'active':''}">Properties</a>
      <a href="index.html#about" class="${active==='about'?'active':''}">About Us</a>
      <a href="index.html#branches" class="${active==='branches'?'active':''}">Our Branches</a>
      <a href="index.html#contact" class="${active==='contact'?'active':''}">Contact</a>
    </nav>
    <div class="nav-actions"><a class="btn btn-green wa-link" href="#" data-message="Hello Bliss Legacy, I would like to make a property enquiry.">Talk to an Agent ↗</a></div>
  </div></header>`;
};

Bliss.renderFooter = () => {
  const c = Bliss.config();
  const socials = Object.entries(c.social||{}).filter(([,v])=>v).map(([k,v])=>`<a href="${v}" target="_blank" rel="noopener">${k}</a>`).join(" · ") || "Social links (configure)";
  return `
  <footer><div class="container">
    <div class="footer-grid">
      <div class="footer-about"><img class="footer-logo" src="assets/images/bliss-legacy-logo.png" alt="${c.companyName}"><p>Discover property opportunities with confidence. Bliss Legacy Limited is here to help you take your next step.</p></div>
      <div class="footer-col"><strong>Company</strong><a href="index.html#about">About Us</a><a href="index.html#branches">Our Branches</a><a href="index.html#contact">Contact</a></div>
      <div class="footer-col"><strong>Properties</strong><a href="index.html#properties">All Listings</a><a href="index.html#properties">Featured</a><a href="#" onclick="return false;">Client Login</a></div>
      <div class="footer-col"><strong>Contact</strong><span>${c.phone||"Phone: (configure)"}</span><span>${c.email||"Email: (configure)"}</span><span>${c.address||"Address: (configure)"}</span><span style="margin-top:8px">${socials}</span></div>
    </div>
    <div class="copyright"><span>© <span id="year"></span> ${c.companyName}. All rights reserved.</span><span>Sample listings are demonstration content.</span></div>
  </div></footer>`;
};

Bliss.initNav = () => {
  const btn = document.getElementById("menuBtn");
  const links = document.getElementById("navLinks");
  if (btn && links) btn.addEventListener("click", () => links.classList.toggle("open"));
  document.querySelectorAll("#navLinks a").forEach(a => a.addEventListener("click", () => links && links.classList.remove("open")));
  const y = document.getElementById("year"); if (y) y.textContent = new Date().getFullYear();
};

Bliss.observeFade = () => {
  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => { if (e.isIntersecting) e.target.classList.add("visible"); });
  }, { threshold: 0.12 });
  document.querySelectorAll(".fade-in").forEach(el => io.observe(el));
};
