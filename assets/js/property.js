// Bliss Legacy Limited — Dedicated Public Property Details Logic
document.addEventListener('DOMContentLoaded', async () => {
  if (window.BLISS_CONFIG_READY) await window.BLISS_CONFIG_READY;
  // Render persistent site header and footer
  const headerSlot = document.getElementById('header-slot');
  const footerSlot = document.getElementById('footer-slot');
  if (headerSlot) headerSlot.innerHTML = Bliss.renderHeader('property-detail');
  if (footerSlot) footerSlot.innerHTML = Bliss.renderFooter();
  Bliss.initNav();

  const container = document.getElementById('propertyContainer');
  const params = new URLSearchParams(window.location.search);
  const propertyId = params.get('id');
  let p = Bliss.findProperty(propertyId);

  // Live D1 listings use numeric IDs. Load them from the public API so the
  // homepage never links a live property to a "Property Not Found" page.
  if (!p && /^\d+$/.test(String(propertyId || ''))) {
    try {
      const response = await fetch(`/api/properties/${propertyId}`);
      if (response.ok) {
        const payload = await response.json();
        const d = payload.property;
        p = {
          id: d.id,
          name: d.title,
          slug: d.reference,
          images: (payload.images || []).map(img => `/api/files/${encodeURIComponent(img.r2_key)}`),
          description: d.description || '',
          location: [d.city, d.state].filter(Boolean).join(', '),
          branch: (d.branch_name || 'Head Office').replace(/\s*Branch$/i, ''),
          category: d.category_name || 'Residential',
          price: Number(d.sale_price || 0),
          units: d.available_units || 1,
          totalUnits: d.total_units || 10,
          bedrooms: d.bedrooms || 0,
          bathrooms: d.bathrooms || 0,
          size: d.land_size || '350 sqm',
          features: (() => { try { return d.features ? JSON.parse(d.features) : []; } catch { return []; } })(),
          status: d.status || 'Available',
          featured: Boolean(d.is_featured),
          isDemo: false
        };
      }
    } catch { /* fall through to not found */ }
  }

  if (!p) {
    container.innerHTML = `
      <div class="empty-state not-found-state">
        <div class="empty-icon">⚠️</div>
        <h2>Property Not Found</h2>
        <p>The requested property could not be found or has been moved from our active listings.</p>
        <a class="btn btn-green" href="index.html#properties" style="margin-top:16px">← Return to All Properties</a>
      </div>
    `;
    return;
  }

  // Set document title
  document.title = `${p.name} | Bliss Legacy Limited`;

  const coverImage = (p.images && p.images[0]) || 'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=1200&q=80';
  const allImages = (p.images && p.images.length) ? p.images : [coverImage];

  // Pre-formatted WhatsApp message
  const waMessage = `Hello Bliss Legacy Limited, I am interested in ${p.name} located at ${p.location} (${p.branch} Branch), listed at ${Bliss.money(p.price)}. Please provide more details.`;

  container.innerHTML = `
    <!-- Breadcrumb & Back Link -->
    <div class="property-breadcrumbs">
      <a href="index.html#home">Home</a>
      <span class="crumb-sep">/</span>
      <a href="index.html#properties">Properties</a>
      <span class="crumb-sep">/</span>
      <span class="crumb-current">${p.name}</span>
    </div>

    <!-- Demo Content Alert -->
    <div class="demo-alert-bar">
      <span class="demo-pill">Demonstration Listing</span>
      <span class="demo-msg">This listing is demonstration content for Bliss Legacy Limited. Titles and pricing are verified sample parameters.</span>
    </div>

    <!-- Property Header Info -->
    <div class="property-main-header">
      <div class="header-left">
        <div class="prop-meta-tags">
          <span class="status-badge status-available">${p.status || 'Available'}</span>
          <span class="category-pill">${p.category}</span>
          ${p.featured ? '<span class="status-badge badge-featured">Featured Opportunity</span>' : ''}
        </div>
        <h1 class="prop-detail-title">${p.name}</h1>
        <p class="prop-detail-location">
          <span class="loc-pin">⌖</span> ${p.location} · <strong>${p.branch} Branch</strong>
        </p>
      </div>

      <div class="header-right">
        <div class="prop-price-card">
          <span class="price-type">Outright Investment Price</span>
          <span class="price-val">${Bliss.money(p.price)}</span>
          <span class="units-status">✓ ${p.units} of ${p.totalUnits || 10} Units Available</span>
        </div>
      </div>
    </div>

    <!-- Interactive Image Gallery -->
    <div class="gallery-wrapper">
      <div class="gallery-hero">
        <img id="mainGalleryImg" src="${coverImage}" alt="${p.name}" class="gallery-hero-img" onerror="this.src='https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1200&q=80'">
        <div class="gallery-counter" id="galleryCounter">1 / ${allImages.length} Photos</div>
      </div>

      ${allImages.length > 1 ? `
        <div class="gallery-thumbnails">
          ${allImages.map((img, idx) => `
            <button class="thumb-btn ${idx === 0 ? 'active' : ''}" data-index="${idx}" data-src="${img}" aria-label="View photo ${idx + 1}">
              <img src="${img}" alt="${p.name} thumbnail ${idx + 1}" onerror="this.src='https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=400&q=80'">
            </button>
          `).join('')}
        </div>
      ` : ''}
    </div>

    <!-- Main Content & Sidebar Grid -->
    <div class="property-layout-grid">
      <!-- Left Column: Narrative, Specifications, Features -->
      <div class="property-content-column">
        <!-- Quick Specs Overview Bar -->
        <div class="specs-grid">
          ${p.bedrooms ? `
            <div class="spec-card">
              <span class="spec-icon">🛏️</span>
              <span class="spec-num">${p.bedrooms}</span>
              <span class="spec-lbl">Bedrooms</span>
            </div>
          ` : ''}
          ${p.bathrooms ? `
            <div class="spec-card">
              <span class="spec-icon">🚿</span>
              <span class="spec-num">${p.bathrooms}</span>
              <span class="spec-lbl">Bathrooms</span>
            </div>
          ` : ''}
          ${p.size ? `
            <div class="spec-card">
              <span class="spec-icon">📐</span>
              <span class="spec-num">${p.size}</span>
              <span class="spec-lbl">Property Size</span>
            </div>
          ` : ''}
          <div class="spec-card">
            <span class="spec-icon">🏢</span>
            <span class="spec-num">${p.category}</span>
            <span class="spec-lbl">Category</span>
          </div>
          <div class="spec-card">
            <span class="spec-icon">📍</span>
            <span class="spec-num">${p.branch}</span>
            <span class="spec-lbl">Supervising Branch</span>
          </div>
        </div>

        <!-- Description Section -->
        <section class="prop-section">
          <h2 class="section-subtitle">Property Overview & Description</h2>
          <div class="prop-text-body">
            <p>${p.description}</p>
            <p>Every development under Bliss Legacy Limited undergoes rigorous title verification, architectural quality auditing, and clear legal boundary mapping. Clients enjoy transparent purchasing procedures without hidden agency commissions or dispute burdens.</p>
          </div>
        </section>

        <!-- Features & Amenities Checklist -->
        <section class="prop-section">
          <h2 class="section-subtitle">Features & Estate Infrastructure</h2>
          <div class="features-checklist-grid">
            ${(p.features || []).map(f => `
              <div class="feature-item">
                <span class="check-icon">✓</span>
                <span class="feature-label">${f}</span>
              </div>
            `).join('')}
          </div>
        </section>

        <!-- Transparency & Ownership Guarantee -->
        <section class="prop-section trust-box">
          <div class="trust-box-inner">
            <div class="trust-badge-icon">🛡️</div>
            <div>
              <h3 class="trust-box-title">Verified Title & Buyer Protection</h3>
              <p class="trust-box-desc">
                Bliss Legacy Limited guarantees complete documentation transparency on this property. Title verification documents, survey plans, and allocation protocols are provided upon inspection and formal inquiry.
              </p>
            </div>
          </div>
        </section>
      </div>

      <!-- Right Column: Sticky Enquiry & Direct Action Box -->
      <div class="property-sidebar-column">
        <div class="sticky-contact-box">
          <div class="sidebar-header">
            <h3>Schedule Viewing & Enquire</h3>
            <p>Speak directly with our dedicated property consultant for ${p.branch} branch.</p>
          </div>

          <!-- Instant WhatsApp Action -->
          <a href="#" class="btn btn-whatsapp-full" id="detailWaBtn">
            <span class="wa-icon">💬</span> Chat on WhatsApp Now
          </a>

          <div class="or-divider"><span>OR SUBMIT INQUIRY FORM</span></div>

          <!-- Interactive Enquiry Form -->
          <form class="detail-enquiry-form" id="detailEnquiryForm">
            <div class="form-group">
              <label for="enqName">Full Name *</label>
              <input type="text" id="enqName" placeholder="e.g. Adebayo Ogunlesi" required>
            </div>

            <div class="form-group">
              <label for="enqPhone">Phone / WhatsApp Number *</label>
              <input type="tel" id="enqPhone" placeholder="+234 800 000 0000" required>
            </div>

            <div class="form-group">
              <label for="enqEmail">Email Address *</label>
              <input type="email" id="enqEmail" placeholder="adebayo@example.com" required>
            </div>

            <div class="form-group">
              <label for="enqPlan">Preferred Acquisition Mode</label>
              <select id="enqPlan">
                <option value="outright">Outright Purchase</option>
                <option value="installment">Structured Installment Plan</option>
                <option value="inspection">Schedule Physical Site Inspection</option>
              </select>
            </div>

            <div class="form-group">
              <label for="enqMsg">Message / Specific Questions</label>
              <textarea id="enqMsg" rows="3" placeholder="Tell us your timeline or questions regarding ${p.name}..."></textarea>
            </div>

            <button type="submit" class="btn btn-green btn-block">
              Send Property Enquiry
            </button>
            <p class="form-privacy-note">🔒 Your information is confidential and will only be used to answer your inquiry.</p>
          </form>

          <!-- Form Success State (hidden initially) -->
          <div class="enquiry-success" id="detailFormSuccess" style="display:none">
            <div class="success-icon">✓</div>
            <h4>Enquiry Received!</h4>
            <p>Thank you for your interest in <strong>${p.name}</strong>. A dedicated Bliss Legacy consultant from the <strong>${p.branch} Branch</strong> will contact you promptly.</p>
            <button class="btn btn-outline btn-sm" id="resetEnqFormBtn" style="margin-top:12px">Send Another Inquiry</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Related Properties Strip -->
    <div class="related-properties-section">
      <div class="related-head">
        <h2>More Properties You Might Like</h2>
        <a href="index.html#properties" class="view-all-link">View All Opportunities →</a>
      </div>
      <div class="property-grid related-grid" id="relatedGrid"></div>
    </div>
  `;

  // Gallery Thumbnail Switcher Logic
  const mainImg = document.getElementById('mainGalleryImg');
  const counter = document.getElementById('galleryCounter');
  const thumbBtns = container.querySelectorAll('.thumb-btn');

  thumbBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      thumbBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const newSrc = btn.getAttribute('data-src');
      const idx = Number(btn.getAttribute('data-index')) + 1;
      if (mainImg) mainImg.src = newSrc;
      if (counter) counter.textContent = `${idx} / ${allImages.length} Photos`;
    });
  });

  // Attach WhatsApp Action
  const detailWa = document.getElementById('detailWaBtn');
  if (detailWa) {
    detailWa.addEventListener('click', (e) => {
      e.preventDefault();
      Bliss.enquireWhatsApp(waMessage);
    });
  }

  // Enquiry Form Submission Handler
  const enqForm = document.getElementById('detailEnquiryForm');
  const enqSuccess = document.getElementById('detailFormSuccess');
  const resetBtn = document.getElementById('resetEnqFormBtn');

  if (enqForm) {
    enqForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = enqForm.querySelector('button[type="submit"]');
      const originalLabel = submitBtn ? submitBtn.textContent : '';
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Submitting Enquiry...';
      }
      try {
        const res = await fetch('/api/public/enquiries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            full_name: document.getElementById('enqName').value.trim(),
            phone_number: document.getElementById('enqPhone').value.trim(),
            email_address: document.getElementById('enqEmail').value.trim(),
            acquisition_mode: document.getElementById('enqPlan').value,
            message: document.getElementById('enqMsg').value.trim() || `I would like to enquire about ${p.name}.`,
            property_reference: p.id,
            source: 'Public property enquiry'
          })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Unable to submit your enquiry.');
        enqForm.style.display = 'none';
        if (enqSuccess) enqSuccess.style.display = 'block';
      } catch (error) {
        alert(error.message || 'Unable to submit your enquiry. Please try again.');
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = originalLabel;
        }
      }
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      if (enqForm) {
        enqForm.reset();
        enqForm.style.display = 'block';
        const submitBtn = enqForm.querySelector('button[type="submit"]');
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Send Property Enquiry';
        }
      }
      if (enqSuccess) enqSuccess.style.display = 'none';
    });
  }

  // Render Related Properties (excluding current property)
  const relatedGrid = document.getElementById('relatedGrid');
  if (relatedGrid) {
    const related = Bliss.properties().filter(item => item.id !== p.id).slice(0, 3);
    relatedGrid.innerHTML = related.map(item => {
      const img = (item.images && item.images[0]) || 'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=800&q=80';
      return `
        <article class="property-card">
          <div class="property-image-wrap">
            <img src="${img}" alt="${item.name}" loading="lazy" class="property-img">
            <div class="card-badges-top">
              <span class="status-badge status-available">${item.status || 'Available'}</span>
            </div>
            <div class="card-badges-bottom">
              <span class="category-pill">${item.category}</span>
            </div>
          </div>
          <div class="property-card-body">
            <div class="prop-location">⌖ ${item.location} · <strong>${item.branch}</strong></div>
            <h3 class="prop-title"><a href="property.html?id=${item.id}">${item.name}</a></h3>
            <div class="prop-pricing-row">
              <div class="price-box">
                <span class="price-lbl">Price</span>
                <span class="price-amt">${Bliss.money(item.price)}</span>
              </div>
            </div>
            <div class="prop-actions-row">
              <a href="property.html?id=${item.id}" class="btn btn-card-details">View Details</a>
              <a href="#" class="btn btn-card-enquire wa-link" data-message="Hello Bliss Legacy, I am interested in ${item.name}.">Enquire</a>
            </div>
          </div>
        </article>
      `;
    }).join('');

    relatedGrid.querySelectorAll('.wa-link').forEach(a => {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        const msg = a.getAttribute('data-message') || 'Hello Bliss Legacy.';
        Bliss.enquireWhatsApp(msg);
      });
    });
  }

  Bliss.observeFade();
});
