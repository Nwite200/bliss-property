// Single public-site configuration. Values may be overridden by the
// Super Admin settings API at runtime; these are safe fallbacks.
window.BLIS_CONFIG = {
  companyName: "Bliss Legacy Limited",
  tagline: "Your Future Begins With the Right Property.",
  whatsappNumber: "",
  phone: "",
  email: "",
  address: "",
  social: {
    facebook: "",
    instagram: "",
    twitter: "",
    linkedin: ""
  }
};

window.BLISS_CONFIG_READY = fetch("/api/site-config", { credentials: "same-origin" })
  .then(function (res) { return res.ok ? res.json() : null; })
  .then(function (payload) {
    if (payload && payload.config) {
      var c = payload.config;
      window.BLIS_CONFIG.companyName = c.companyName || window.BLIS_CONFIG.companyName;
      window.BLIS_CONFIG.tagline = c.tagline || window.BLIS_CONFIG.tagline;
      window.BLIS_CONFIG.whatsappNumber = c.whatsappNumber || "";
      window.BLIS_CONFIG.phone = c.phone || "";
      window.BLIS_CONFIG.email = c.email || "";
      window.BLIS_CONFIG.address = c.address || "";
      window.BLIS_CONFIG.social = c.social || window.BLIS_CONFIG.social;
      window.BLIS_CONFIG.branches = c.branches || [];
    }
    return window.BLIS_CONFIG;
  })
  .catch(function () { return window.BLIS_CONFIG; });
