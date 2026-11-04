document.addEventListener('DOMContentLoaded', async () => {
  const headerSlot = document.getElementById('header-slot');
  const footerSlot = document.getElementById('footer-slot');
  if (headerSlot) headerSlot.innerHTML = Bliss.renderHeader('home');
  if (footerSlot) footerSlot.innerHTML = Bliss.renderFooter();
  Bliss.initNav();

  const c = Bliss.config();
  const phoneEl = document.getElementById('contactPhone');
  const emailEl = document.getElementById('contactEmail');
  const addrEl = document.getElementById('contactAddress');
  if (phoneEl) phoneEl.textContent = c.phone || '(configure)';
  if (emailEl) emailEl.textContent = c.email || '(configure)';
  if (addrEl) addrEl.textContent = c.address || '(configure)';

  const waBtn = document.getElementById('waBtn');
  if (waBtn) waBtn.addEventListener('click', () => Bliss.enquireWhatsApp('Hello Bliss Legacy, I would like to make an enquiry.'));

  const branchesGrid = document.getElementById('branchesGrid');
  if (branchesGrid) {
    branchesGrid.innerHTML = (window.BLIS_BRANCHES || []).map(b => `
      <div class="branch fade-in"><div class="pin">⌖</div><strong>${b}</strong><small>${b === 'Head Office' ? 'Central admin' : 'Branch office'}</small></div>`).join('');
  }

  const grid = document.getElementById('propertyGrid');
  const searchInput = document.getElementById('searchInput');
  const locFilter = document.getElementById('locationFilter');
  const catFilter = document.getElementById('categoryFilter');
  const priceFilter = document.getElementById('priceFilter');
  const sortSelect = document.getElementById('sortSelect');

  let allProps = [];
  try {
    const res = await fetch('/api/properties?limit=100');
    if (res.ok) {
      const data = await res.json();
      allProps = (data.properties || []).map(p => ({
        id: p.reference,
        slug: p.reference.toLowerCase(),
        name: p.title,
        location: p.city || p.state,
        branch: p.branch_name || '-',
        category: p.category_name || '-',
        price: p.sale_price,
        units: p.bedrooms ? p.bedrooms + ' bed' : 'N/A',
        features: p.features ? JSON.parse(p.features) : [],
        status: p.status,
        featured: p.is_featured === 1,
        images: []
      }));
    }
  } catch (e) { /* fall back to static data */ }
  if (!allProps.length) allProps = Bliss.properties();

  const locations = [...new Set(allProps.map(p => p.location))];
  const categories = [...new Set(allProps.map(p => p.category))];
  if (locFilter) locations.forEach(l => { const o = document.createElement('option'); o.value = l; o.textContent = l; locFilter.appendChild(o); });
  if (catFilter) categories.forEach(ct => { const o = document.createElement('option'); o.value = ct; o.textContent = ct; catFilter.appendChild(o); });

  function render() {
    const q = (searchInput?.value || '').toLowerCase();
    const loc = locFilter?.value || '';
    const cat = catFilter?.value || '';
    const price = priceFilter?.value || '';
    const sort = sortSelect?.value || '';
    let items = allProps.filter(p => {
      const matchQ = (p.name + ' ' + p.location).toLowerCase().includes(q);
      const matchLoc = !loc || p.location === loc;
      const matchCat = !cat || p.category === cat;
      let matchPrice = true;
      if (price) {
        const [min, max] = price.split('-').map(Number);
        matchPrice = p.price >= min && p.price <= max;
      }
      return matchQ && matchLoc && matchCat && matchPrice;
    });
    if (sort === 'asc') items.sort((a,b) => a.price - b.price);
    if (sort === 'desc') items.sort((a,b) => b.price - a.price);

    if (!grid) return;
    grid.innerHTML = items.length ? items.map(p => `
      <article class="property-card card fade-in">
        <div class="property-image">
          <img src="${p.images && p.images[0] ? p.images[0] : ''}" alt="${p.name}" loading="lazy">
          ${p.featured ? '<span class="tag tag-featured">Featured</span>' : '<span class="tag">' + p.status + '</span>'}
        </div>
        <div class="property-body">
          <div class="location">⌖ ${p.location} · ${p.branch} Branch</div>
          <h3>${p.name}</h3>
          <div class="detail">${p.category} · ${p.units} units available</div>
          <div class="price">${Bliss.money(p.price)}</div>
          <div class="features">${p.features.slice(0,3).map(f => '<span>' + f + '</span>').join('')}</div>
          <div class="card-bottom">
            <a class="details-link" href="property.html?id=${p.id}">View Details →</a>
            <a class="details-link wa-link" href="#" data-message="Hello Bliss Legacy, I am interested in ${p.name} in ${p.location}, listed at ${Bliss.money(p.price)}. Please share more details.">Enquire</a>
          </div>
        </div>
      </article>`).join('') : '<div class="empty">No properties match your search. Try another location or property type.</div>';

    grid.querySelectorAll('.wa-link').forEach(a => {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        Bliss.enquireWhatsApp(a.dataset.message || 'Hello Bliss Legacy.');
      });
    });
    Bliss.observeFade();
  }

  ['input','change'].forEach(ev => {
    searchInput?.addEventListener(ev === 'input' ? 'input' : 'change', render);
  });
  locFilter?.addEventListener('change', render);
  catFilter?.addEventListener('change', render);
  priceFilter?.addEventListener('change', render);
  sortSelect?.addEventListener('change', render);
  render();

  Bliss.observeFade();
});
