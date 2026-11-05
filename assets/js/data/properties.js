// Bliss Legacy Limited — Sample Property Data (DEMONSTRATION CONTENT).
// Structured for seamless future API and administrative backend integration.

window.BLIS_BRANCHES = [
  {
    name: "Head Office",
    city: "Lagos",
    state: "Lagos State",
    type: "Corporate Headquarters",
    address: "Central Business District, Lagos",
    phone: "+234 800 000 0000",
    isHeadOffice: true
  },
  {
    name: "Ikeja",
    city: "Ikeja",
    state: "Lagos State",
    type: "Mainland Branch",
    address: "Commercial Avenue, Ikeja, Lagos",
    phone: "+234 800 000 0001",
    isHeadOffice: false
  },
  {
    name: "Ajah",
    city: "Ajah",
    state: "Lagos State",
    type: "Island & Lekki Corridor Branch",
    address: "Lekki-Epe Expressway, Ajah, Lagos",
    phone: "+234 800 000 0002",
    isHeadOffice: false
  },
  {
    name: "Asaba",
    city: "Asaba",
    state: "Delta State",
    type: "Delta State Regional Office",
    address: "Nnebisi Road, Asaba, Delta State",
    phone: "+234 800 000 0003",
    isHeadOffice: false
  },
  {
    name: "Ihama",
    city: "Benin City",
    state: "Edo State",
    type: "GRA Branch",
    address: "Ihama Road, GRA, Benin City, Edo State",
    phone: "+234 800 000 0004",
    isHeadOffice: false
  },
  {
    name: "Obakhavba",
    city: "Benin City",
    state: "Edo State",
    type: "Commercial Office",
    address: "Obakhavba Axis, Benin City, Edo State",
    phone: "+234 800 000 0005",
    isHeadOffice: false
  }
];

window.BLIS_PROPERTIES = [
  {
    id: "prop-001",
    name: "Greenfield Estate Phase 1",
    slug: "greenfield-estate-phase-1",
    images: [
      "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1600566753086-00f18fb6b3ea?auto=format&fit=crop&w=1200&q=80"
    ],
    description: "A serene, master-planned residential community in the prime axis of Ikeja. Greenfield Estate Phase 1 offers modern 4-bedroom semi-detached duplexes built to the highest architectural standards with 24-hour security, paved road networks, constant water supply, and uninterrupted estate power. Perfect for families seeking safety, tranquility, and capital appreciation.",
    location: "Ikeja, Lagos",
    branch: "Ikeja",
    category: "Residential",
    price: 85000000,
    units: 6,
    totalUnits: 20,
    bedrooms: 4,
    bathrooms: 4,
    size: "380 sqm",
    features: [
      "4 All En-Suite Bedrooms",
      "Fully Fitted Kitchen",
      "Attached BQ",
      "24/7 Monitored Security",
      "Interlocked Paved Roads",
      "Central Water Treatment",
      "Dedicated Transformer",
      "Perimeter Fencing & CCTV"
    ],
    status: "Available",
    featured: true,
    isDemo: true
  },
  {
    id: "prop-002",
    name: "Lakeview Courts",
    slug: "lakeview-courts",
    images: [
      "https://images.unsplash.com/photo-1570129477492-45c003edd2be?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1613977257363-707ba9348227?auto=format&fit=crop&w=1200&q=80"
    ],
    description: "Architecturally refined 3-bedroom luxury terrace duplexes nestled in a secure gated community in Ajah. Designed with open-concept living rooms, floor-to-ceiling windows, and private parking. Close proximity to shopping centers, reputable schools, and business districts along the Lekki corridor.",
    location: "Ajah, Lagos",
    branch: "Ajah",
    category: "Residential",
    price: 65000000,
    units: 4,
    totalUnits: 14,
    bedrooms: 3,
    bathrooms: 3,
    size: "240 sqm",
    features: [
      "3 En-Suite Bedrooms",
      "Contemporary Open Living",
      "Dedicated Parking (2 cars)",
      "Solar Street Lighting",
      "Estate Generator Backup",
      "Kids Play Area",
      "Fibre-Optic Internet Ready",
      "Drainage Infrastructure"
    ],
    status: "Available",
    featured: true,
    isDemo: true
  },
  {
    id: "prop-003",
    name: "Delta Prime Plots",
    slug: "delta-prime-plots",
    images: [
      "https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=1200&q=80"
    ],
    description: "100% dry, surveyed, and ready-to-build residential and commercial plots situated in the rapidly expanding capital corridor of Asaba, Delta State. Features clean title documentation, government-approved layouts, and excellent proximity to the Asaba International Airport and central business areas.",
    location: "Asaba, Delta",
    branch: "Asaba",
    category: "Land",
    price: 14500000,
    units: 18,
    totalUnits: 50,
    bedrooms: 0,
    bathrooms: 0,
    size: "500 sqm / Plot",
    features: [
      "Instant Allocation",
      "100% Dry Land",
      "Registered Survey Plan",
      "Deed of Assignment Ready",
      "Electricity Connection Available",
      "Wide Access Roads",
      "High Investment Yield Potential",
      "Free from Encumbrances"
    ],
    status: "Available",
    featured: true,
    isDemo: true
  },
  {
    id: "prop-004",
    name: "Benin Heights Apartments",
    slug: "benin-heights-apartments",
    images: [
      "https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=1200&q=80"
    ],
    description: "Premium 2 and 3-bedroom city apartments situated in the prestigious GRA neighborhood of Ihama, Benin City. Built to international standards with Spanish porcelain tiling, fitted granite kitchen tops, elevator access, and secure multi-level parking.",
    location: "Ihama, Benin City",
    branch: "Ihama",
    category: "Residential",
    price: 36000000,
    units: 7,
    totalUnits: 24,
    bedrooms: 3,
    bathrooms: 2,
    size: "160 sqm",
    features: [
      "Master Bedroom En-Suite",
      "Private Viewing Balcony",
      "Elevator Access",
      "Covered Ground Parking",
      "Soundproof Generator Plant",
      "Intercom Security System",
      "Clean Borehole Water Supply",
      "Access Control Gate"
    ],
    status: "Available",
    featured: false,
    isDemo: true
  },
  {
    id: "prop-005",
    name: "Commercial Hub Obakhavba",
    slug: "commercial-hub-obakhavba",
    images: [
      "https://images.unsplash.com/photo-1486325212027-8081e485255e?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=1200&q=80"
    ],
    description: "Purpose-engineered commercial plazas and office suites situated in a high-footfall business corridor in Obakhavba, Benin City. Designed with customizable shell-and-core units, modern glass facades, dedicated loading bays, and expansive customer parking.",
    location: "Obakhavba, Benin City",
    branch: "Obakhavba",
    category: "Commercial",
    price: 52000000,
    units: 5,
    totalUnits: 12,
    bedrooms: 0,
    bathrooms: 2,
    size: "220 sqm",
    features: [
      "Prime Road Frontage",
      "High Footfall Corridor",
      "Double-Glazed Facade",
      "Dedicated Loading Bay",
      "Customer Parking Lot",
      "Industrial Power Backup",
      "Fire Detection & Suppression",
      "Flexible Floor Plan"
    ],
    status: "Available",
    featured: false,
    isDemo: true
  },
  {
    id: "prop-006",
    name: "Royal Palms Estate",
    slug: "royal-palms-estate",
    images: [
      "https://images.unsplash.com/photo-1600047509807-ba8f99d2cdde?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1600585154526-990dced4db0d?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1600607687920-4e2a09cf159d?auto=format&fit=crop&w=1200&q=80"
    ],
    description: "The pinnacle of luxury living in Ajah, Lagos. Royal Palms Estate presents fully detached 5-bedroom smart homes featuring private swimming pools, rooftop lounge terraces, integrated automated security, and lush landscaped gardens.",
    location: "Ajah, Lagos",
    branch: "Ajah",
    category: "Residential",
    price: 145000000,
    units: 2,
    totalUnits: 8,
    bedrooms: 5,
    bathrooms: 6,
    size: "550 sqm",
    features: [
      "5 All En-Suite Bedrooms",
      "Private Swimming Pool",
      "Integrated Smart Home System",
      "Solar Inverter Backup",
      "Rooftop Terrace Lounge",
      "Chef's Kitchen + Pantry",
      "2-Room Boys Quarters",
      "Perimeter Infrared Security"
    ],
    status: "Available",
    featured: true,
    isDemo: true
  },
  {
    id: "prop-007",
    name: "Victory Park Commercial Suites",
    slug: "victory-park-commercial-suites",
    images: [
      "https://images.unsplash.com/photo-1497215728101-856f4ea42174?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1497366811353-6870744d04b2?auto=format&fit=crop&w=1200&q=80"
    ],
    description: "Versatile commercial suites in Ikeja suitable for corporate headquarters, professional clinics, and creative agencies. Features ample parking, dual elevators, high-speed fiber internet infrastructure, and 24-hour estate management.",
    location: "Ikeja, Lagos",
    branch: "Ikeja",
    category: "Commercial",
    price: 78000000,
    units: 3,
    totalUnits: 10,
    bedrooms: 0,
    bathrooms: 3,
    size: "300 sqm",
    features: [
      "Central Air Conditioning Ready",
      "High Visibility Signage Space",
      "Dual Passenger Elevators",
      "3-Phase Power Connection",
      "Professional Facility Management",
      "Secured Under-Building Parking",
      "CCTV Surveillance",
      "Fire Safety Certification"
    ],
    status: "Available",
    featured: false,
    isDemo: true
  },
  {
    id: "prop-008",
    name: "Sunrise Meadows Scheme 2",
    slug: "sunrise-meadows-scheme-2",
    images: [
      "https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1500076656116-558758c991c1?auto=format&fit=crop&w=1200&q=80"
    ],
    description: "A fast-appreciating land investment opportunity along the vibrant Asaba expansion corridor. Perfectly dry topography, immediate physical allocation, and completely free from any customary encumbrances. Excellent for long-term banking or early residential construction.",
    location: "Asaba, Delta",
    branch: "Asaba",
    category: "Land",
    price: 9500000,
    units: 25,
    totalUnits: 60,
    bedrooms: 0,
    bathrooms: 0,
    size: "450 sqm / Plot",
    features: [
      "Registered Global C of O",
      "Immediate Survey & Pegging",
      "Well-Drained Sandy Soil",
      "Gated Perimeter Security",
      "Planned Green Parks",
      "Direct Link to Express Route",
      "Flexible Installment Options",
      "Documented Ownership Transfer"
    ],
    status: "Available",
    featured: false,
    isDemo: true
  },
  {
    id: "prop-009",
    name: "Emerald Ridge Terraces",
    slug: "emerald-ridge-terraces",
    images: [
      "https://images.unsplash.com/photo-1580587771525-78b9dba3b914?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=1200&q=80"
    ],
    description: "A limited collection of contemporary 4-bedroom terrace homes in a secure, professionally managed estate along the Lekki-Epe corridor. Each home features premium finishes, private parking, solar-ready wiring, and access to landscaped communal gardens, a residents' clubhouse and a children's play area.",
    location: "Lekki, Lagos",
    branch: "Ajah",
    category: "Residential",
    price: 72000000,
    units: 8,
    totalUnits: 18,
    bedrooms: 4,
    bathrooms: 4,
    size: "310 sqm",
    features: [
      "4 En-Suite Bedrooms",
      "Private Garden & Patio",
      "Solar-Ready Wiring",
      "Residents' Clubhouse",
      "24/7 Estate Security",
      "Paved Internal Roads",
      "Water Treatment Plant",
      "Flexible Payment Plan"
    ],
    status: "Available",
    featured: true,
    isDemo: true
  },
  {
    id: "prop-010",
    name: "Riverside Garden Plots",
    slug: "riverside-garden-plots",
    images: [
      "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1441974231531-c6227db76b6e?auto=format&fit=crop&w=1200&q=80"
    ],
    description: "Prime riverside land in a fast-growing residential belt, ideal for holiday homes, retirement builds or long-term land banking. The scheme offers dry, surveyed plots with registered survey plans, deed of assignment, graded access roads and a planned riverside green corridor.",
    location: "Ihama, Benin City",
    branch: "Ihama",
    category: "Land",
    price: 12000000,
    units: 20,
    totalUnits: 40,
    bedrooms: 0,
    bathrooms: 0,
    size: "550 sqm / Plot",
    features: [
      "Registered Survey Plan",
      "Deed of Assignment",
      "100% Dry Buildable Land",
      "Graded Access Roads",
      "Riverside Green Corridor",
      "Immediate Allocation",
      "Flexible Installments",
      "Free from Encumbrances"
    ],
    status: "Available",
    featured: false,
    isDemo: true
  }
];
