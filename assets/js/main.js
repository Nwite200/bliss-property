// Bliss Legacy Limited — Main Landing Page Logic
document.addEventListener('DOMContentLoaded', async () => {
  if (window.BLISS_CONFIG_READY) await window.BLISS_CONFIG_READY;
  // Render persistent site header and footer
  const headerSlot = document.getElementById('header-slot');
  const footerSlot = document.getElementById('footer-slot');
  if (headerSlot) headerSlot.innerHTML = Bliss.renderHeader('home');
  if (footerSlot) footerSlot.innerHTML = Bliss.renderFooter();
  Bliss.initNav();

  // Populate configurable contact placeholders
  const c = Bliss.config();
  const phoneEl = document.getElementById('contactPhone');
  const emailEl = document.getElementById('contactEmail');
  const addrEl = document.getElementById('contactAddress');
  if (phoneEl) phoneEl.textContent = c.phone || 'Contact phone not configured';
  if (emailEl) emailEl.textContent = c.email || 'Contact email not configured';
  if (addrEl) addrEl.textContent = c.address || 'Head office address not configured';

  // Dedicated WhatsApp action button in Contact section
  const waBtn = document.getElementById('waBtn');
  if (waBtn) {
    waBtn.addEventListener('click', (e) => {
      e.preventDefault();
      Bliss.enquireWhatsApp('Hello Bliss Legacy Limited, I would like to speak with a property consultant regarding available opportunities.');
    });
  }

  // Render 6 Branches Section
  const branchesGrid = document.getElementById('branchesGrid');
  if (branchesGrid) {
    const branches = (c.branches && c.branches.length) ? c.branches : [];
    if (!branches.length) {
      branchesGrid.innerHTML = '<div class="branch-card"><div class="branch-badge">Configuration required</div><h3 class="branch-title">Branch offices</h3><p class="branch-address">Branch contact details are not configured yet. Add them in System Administration.</p></div>';
    } else {
      branchesGrid.innerHTML = branches.map(b => `
      <div class="branch-card fade-in ${b.isHeadOffice ? 'branch-head-office' : ''}">
        <div class="branch-badge">${b.type}</div>
        <div class="branch-icon">⌖</div>
        <h3 class="branch-title">${b.name}</h3>
        <p class="branch-location">${b.city}, ${b.state}</p>
        <p class="branch-address">${b.address}</p>
        <div class="branch-footer">
          <a class="branch-action wa-link" href="#" data-message="Hello Bliss Legacy, I would like to visit or speak with an agent at the ${b.name} office.">Contact Office →</a>
        </div>
      </div>
    `).join('');
    }
  }

  // Load properties (structured to fetch from /api/properties if online, or fall back to sample data)
  let allProperties = [];
  try {
    const res = await fetch('/api/properties?limit=50');
    if (res.ok) {
      const data = await res.json();
      if (data && data.properties && data.properties.length > 0) {
        allProperties = data.properties.map(p => ({
          id: String(p.id),
          slug: p.slug || (p.reference ? p.reference.toLowerCase() : String(p.id)),
          name: p.title || p.name,
          location: p.city ? `${p.city}, ${p.state || 'Lagos'}` : (p.state || 'Lagos'),
          branch: p.branch_name || 'Head Office',
          category: p.category_name || 'Residential',
          price: Number(p.sale_price || p.price || 0),
          units: p.available_units || 1,
          totalUnits: p.total_units || 10,
          bedrooms: p.bedrooms || 0,
          bathrooms: p.bathrooms || 0,
          size: p.size || '350 sqm',
          description: p.description || '',
          features: p.features ? (typeof p.features === 'string' ? JSON.parse(p.features) : p.features) : [],
          status: p.status === 'published' ? 'Available' : (p.status || 'Available'),
          featured: Boolean(p.is_featured),
          images: p.images && p.images.length ? p.images : [
            'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=1200&q=80'
          ],
          isDemo: false
        }));
      }
    }
  } catch (err) {
    // API not accessible; seamlessly fallback to static sample data
  }

  // Blend live D1 records with the curated demonstration catalogue and cap the
  // homepage at ten listings. Land opportunities are always represented.
  // Curated demo listings are only used when no live property is available.
  // Once a real listing exists, demonstration content is never merged into the
  // public catalogue.
  const showDemo = !window.BLIS_CONFIG || window.BLIS_CONFIG.showDemoProperties === true;
  const staticProperties = allProperties.length === 0 && showDemo
    ? Bliss.properties().map(p => ({ ...p, isDemo: true }))
    : [];
  const seen = new Set(allProperties.map(p => `${String(p.name).toLowerCase()}|${String(p.location).toLowerCase()}`));
  for (const item of staticProperties) {
    const key = `${String(item.name).toLowerCase()}|${String(item.location).toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      allProperties.push(item);
    }
  }
  allProperties = allProperties.slice(0, 10);
  if (!allProperties.some(p => String(p.category).toLowerCase() === 'land')) {
    const land = staticProperties.find(p => String(p.category).toLowerCase() === 'land');
    if (land && !allProperties.some(p => p.name === land.name)) {
      allProperties[allProperties.length - 1] = land;
    }
  }

  // Populate dynamic filter options
  const grid = document.getElementById('propertyGrid');
  const resultsCounter = document.getElementById('resultsCounter');
  const searchInput = document.getElementById('searchInput');
  const locFilter = document.getElementById('locationFilter');
  const catFilter = document.getElementById('categoryFilter');
  const priceFilter = document.getElementById('priceFilter');
  const sortSelect = document.getElementById('sortSelect');
  const resetFiltersBtn = document.getElementById('resetFiltersBtn');

  // Extract unique locations and categories
  const locations = [...new Set(allProperties.map(p => p.branch || p.location.split(',')[0].trim()))].sort();
  const categories = [...new Set(allProperties.map(p => p.category))].sort();

  if (locFilter) {
    locations.forEach(loc => {
      const opt = document.createElement('option');
      opt.value = loc;
      opt.textContent = `${loc} Branch`;
      locFilter.appendChild(opt);
    });
  }

  if (catFilter) {
    categories.forEach(cat => {
      const opt = document.createElement('option');
      opt.value = cat;
      opt.textContent = cat;
      catFilter.appendChild(opt);
    });
  }

  function renderProperties() {
    const q = (searchInput?.value || '').trim().toLowerCase();
    const loc = locFilter?.value || '';
    const cat = catFilter?.value || '';
    const priceRange = priceFilter?.value || '';
    const sort = sortSelect?.value || '';

    let items = allProperties.filter(p => {
      const textMatch = !q || (p.name + ' ' + p.location + ' ' + p.branch + ' ' + (p.description || '')).toLowerCase().includes(q);
      const locMatch = !loc || p.branch === loc || p.location.toLowerCase().includes(loc.toLowerCase());
      const catMatch = !cat || p.category.toLowerCase() === cat.toLowerCase();

      let priceMatch = true;
      if (priceRange) {
        const [min, max] = priceRange.split('-').map(Number);
        if (max) {
          priceMatch = p.price >= min && p.price <= max;
        } else {
          priceMatch = p.price >= min;
        }
      }

      return textMatch && locMatch && catMatch && priceMatch;
    });

    if (sort === 'price-asc') {
      items.sort((a, b) => a.price - b.price);
    } else if (sort === 'price-desc') {
      items.sort((a, b) => b.price - a.price);
    }

    if (resultsCounter) {
      resultsCounter.textContent = `Showing ${items.length} of ${allProperties.length} ${items.length === 1 ? 'property' : 'properties'}`;
    }

    if (!grid) return;

    if (!items.length) {
      grid.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">⌂</div>
          <h3>No properties match your search</h3>
          <p>Try modifying your search term, clearing location filters, or broadening the price range.</p>
          <button class="btn btn-outline" id="clearFiltersBtn" style="margin-top:14px">Reset All Filters</button>
        </div>
      `;
      const clrBtn = document.getElementById('clearFiltersBtn');
      if (clrBtn) {
        clrBtn.addEventListener('click', resetAllFilters);
      }
      return;
    }

    grid.innerHTML = items.map(p => {
      const coverImg = (p.images && p.images[0]) || 'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=1200&q=80';
      const featureTags = (p.features || []).slice(0, 3).map(f => `<span class="feat-tag">${f}</span>`).join('');
      const moreCount = (p.features && p.features.length > 3) ? `<span class="feat-tag feat-more">+${p.features.length - 3} more</span>` : '';
      const statusClass = p.status ? p.status.toLowerCase().replace(/\s+/g, '-') : 'available';

      return `
        <article class="property-card fade-in">
          <div class="property-image-wrap">
            <img src="${coverImg}" alt="${p.name}" loading="lazy" class="property-img" onerror="this.onerror=null;this.src='https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1200&q=80'">
            <div class="card-badges-top">
              <span class="status-badge status-${statusClass}">${p.status || 'Available'}</span>
              ${p.featured ? '<span class="status-badge badge-featured">Featured</span>' : ''}
              ${p.isDemo ? '<span class="status-badge badge-gray" title="Demonstration listing">Sample</span>' : ''}
            </div>
            <div class="card-badges-bottom">
              <span class="category-pill">${p.category}</span>
            </div>
          </div>

          <div class="property-card-body">
            <div class="prop-location">
              <span class="loc-pin">⌖</span> ${p.location} · <strong class="prop-branch">${p.branch} Branch</strong>
            </div>

            <h3 class="prop-title"><a href="property.html?id=${p.id}">${p.name}</a></h3>
            <p class="prop-desc">${p.description ? p.description.slice(0, 115) + '...' : ''}</p>

            <div class="prop-features-list">
              ${featureTags}
              ${moreCount}
            </div>

            <div class="prop-pricing-row">
              <div class="price-box">
                <span class="price-lbl">Outright Price</span>
                <span class="price-amt">${Bliss.money(p.price)}</span>
              </div>
              <div class="units-box">
                <span class="units-val">${p.units} Available</span>
                <span class="units-lbl">of ${p.totalUnits || 10} Units</span>
              </div>
            </div>

            <div class="prop-actions-row">
              <a href="property.html?id=${p.id}" class="btn btn-card-details">View Details</a>
              <a href="#" class="btn btn-card-enquire wa-link" data-message="Hello Bliss Legacy Limited, I am interested in ${p.name} located at ${p.location}, listed at ${Bliss.money(p.price)}. Please provide more details.">
                Enquire Now
              </a>
            </div>
          </div>
        </article>
      `;
    }).join('');

    // Re-bind WhatsApp action triggers for newly created elements
    grid.querySelectorAll('.wa-link').forEach(a => {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        const msg = a.getAttribute('data-message') || 'Hello Bliss Legacy Limited, I would like to make an enquiry.';
        Bliss.enquireWhatsApp(msg);
      });
    });

    Bliss.observeFade();
  }

  function resetAllFilters() {
    if (searchInput) searchInput.value = '';
    if (locFilter) locFilter.value = '';
    if (catFilter) catFilter.value = '';
    if (priceFilter) priceFilter.value = '';
    if (sortSelect) sortSelect.value = '';
    renderProperties();
  }

  // Bind filter input events
  if (searchInput) searchInput.addEventListener('input', renderProperties);
  if (locFilter) locFilter.addEventListener('change', renderProperties);
  if (catFilter) catFilter.addEventListener('change', renderProperties);
  if (priceFilter) priceFilter.addEventListener('change', renderProperties);
  if (sortSelect) sortSelect.addEventListener('change', renderProperties);
  if (resetFiltersBtn) resetFiltersBtn.addEventListener('click', resetAllFilters);

  // Initial property render
  renderProperties();

  // Contact Form Submission Handler — creates a real lead through the worker.
  const contactForm = document.getElementById('contactForm');
  const formSuccess = document.getElementById('formSuccess');
  if (contactForm) {
    contactForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = contactForm.querySelector('button[type="submit"]');
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
            full_name: document.getElementById('contactFullName').value.trim(),
            phone_number: document.getElementById('contactPhoneInput').value.trim(),
            email_address: document.getElementById('contactEmailInput').value.trim(),
            branch_name: document.getElementById('contactBranchSelect').value,
            message: document.getElementById('contactMessage').value.trim(),
            source: 'Homepage contact form'
          })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Unable to submit your enquiry.');
        contactForm.style.display = 'none';
        if (formSuccess) formSuccess.style.display = 'block';
      } catch (error) {
        alert(error.message || 'Unable to submit your enquiry. Please try again.');
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = originalLabel;
        }
      }
    });
  }

  // Smooth scroll for in-page anchors
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
      const targetId = this.getAttribute('href');
      if (targetId === '#' || targetId === '#home') {
        e.preventDefault();
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      const targetEl = document.querySelector(targetId);
      if (targetEl) {
        e.preventDefault();
        const headerHeight = document.getElementById('siteHeader')?.offsetHeight || 72;
        const targetPos = targetEl.getBoundingClientRect().top + window.scrollY - headerHeight;
        window.scrollTo({ top: targetPos, behavior: 'smooth' });
      }
    });
  });

  Bliss.observeFade();
});
