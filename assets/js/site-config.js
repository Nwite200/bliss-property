// Single public-site configuration. Values may be overridden by the
// Super Admin settings API at runtime; these are safe fallbacks.
window.BLIS_CONFIG = {
  companyName: "Bliss Legacy Limited",
  tagline: "Your Future Begins With the Right Property.",
  whatsappNumber: "2349168630710",
  phone: "0805 289 9920",
  email: "hrblisslegacy@gmail.com",
  address: "102, Ihama Road, GRA, Benin City, close to Living Faith Church (Winners Church)",
  social: {
    facebook: "https://blisslegacy.com",
    instagram: "",
    twitter: "",
    linkedin: ""
  },
  branches: [
    {
      name: "Head Office",
      city: "Benin City",
      state: "Edo State",
      type: "Corporate Headquarters",
      address: "102, Ihama Road, GRA, Benin City, close to Living Faith Church (Winners Church)",
      phone: "0805 289 9920",
      isHeadOffice: true
    },
    {
      name: "Ikeja Branch",
      city: "Ikeja",
      state: "Lagos State",
      type: "Mainland Branch",
      address: "Plot 40, Adegbola Street, Anifowose, close to the Local Government",
      phone: "0805 289 9920",
      isHeadOffice: false
    },
    {
      name: "Ajah Branch",
      city: "Ajah",
      state: "Lagos State",
      type: "Island & Lekki Corridor Branch",
      address: "Fladek Plaza, opposite Pump and Sell Bus Stop, Ado Road, Ajah",
      phone: "0805 289 9920",
      isHeadOffice: false
    },
    {
      name: "Asaba Branch",
      city: "Asaba",
      state: "Delta State",
      type: "Delta State Regional Office",
      address: "Plot 2, Ikukaiwe Street, close to Christian Association of Nigeria (CAN) Building",
      phone: "0807 389 1911",
      isHeadOffice: false
    },
    {
      name: "Ihama Branch",
      city: "Benin City",
      state: "Edo State",
      type: "GRA Branch",
      address: "102, Ihama Road, GRA, Benin City, close to Living Faith Church (Winners Church)",
      phone: "0807 389 3946",
      isHeadOffice: false
    },
    {
      name: "Obakhavbaye Branch",
      city: "Benin City",
      state: "Edo State",
      type: "Commercial Office",
      address: "13, Obakhavbaye Street, off Oba Market Road, Benin City",
      phone: "0805 289 9920",
      isHeadOffice: false
    }
  ]
};

window.BLISS_CONFIG_READY = fetch("/api/site-config", { credentials: "same-origin" })
  .then(function (res) { return res.ok ? res.json() : null; })
  .then(function (payload) {
    if (payload && payload.config) {
      var c = payload.config;
      window.BLIS_CONFIG.companyName = c.companyName || window.BLIS_CONFIG.companyName;
      window.BLIS_CONFIG.tagline = c.tagline || window.BLIS_CONFIG.tagline;
      window.BLIS_CONFIG.whatsappNumber = c.whatsappNumber || window.BLIS_CONFIG.whatsappNumber;
      window.BLIS_CONFIG.phone = c.phone || window.BLIS_CONFIG.phone;
      window.BLIS_CONFIG.email = c.email || window.BLIS_CONFIG.email;
      window.BLIS_CONFIG.address = c.address || window.BLIS_CONFIG.address;
      window.BLIS_CONFIG.social = {
        facebook: (c.social && c.social.facebook) || window.BLIS_CONFIG.social.facebook,
        instagram: (c.social && c.social.instagram) || window.BLIS_CONFIG.social.instagram,
        twitter: (c.social && c.social.twitter) || window.BLIS_CONFIG.social.twitter,
        linkedin: (c.social && c.social.linkedin) || window.BLIS_CONFIG.social.linkedin
      };
      if (Array.isArray(c.branches) && c.branches.length) {
        window.BLIS_CONFIG.branches = c.branches;
      }
    }
    return window.BLIS_CONFIG;
  })
  .catch(function () { return window.BLIS_CONFIG; });
