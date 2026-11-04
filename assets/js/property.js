document.addEventListener('DOMContentLoaded', () => {
  const headerSlot = document.getElementById('header-slot');
  const footerSlot = document.getElementById('footer-slot');
  if (headerSlot) headerSlot.innerHTML = Bliss.renderHeader('properties');
  if (footerSlot) footerSlot.innerHTML = Bliss.renderFooter();
  Bliss.initNav();

  const container = document.getElementById('propertyContainer');
  const params = new URLSearchParams(window.location.search);
  const id = params.get('id');
  const p = id ? Bliss.findProperty(id) : null;

  if (!p) {
    container.innerHTML = '<h2>Property not found</h2><p><a class="details-link" href="index.html#properties">Back to listings</a></p>';
    return;
  }
  document.title = p.name + ' | Bliss Legacy Limited';

  const galleryMain = p.images[0];
  container.innerHTML = `
    <a class="details-link" href="index.html#properties">← Back to listings</a>
    <h1 style="margin-top:16px">${p.name}</h1>
    <p style="color:var(--muted)">${p.location} · ${p.branch} Branch · ${p.category}</p>
    <div class="gallery" style="margin-top:20px">
      <div class="gallery-main"><img id="mainImg" src="${galleryMain}" alt="${p.name}"></div>
      <div class="gallery-thumbs">
        ${p.images.map((img,i) => `<img src="${img}" alt="${p.name} ${i+1}" data-src="${img}" class="${i===0?'active':''}">`).join('')}
      </div>
    </div>
    <div class="detail-grid">
      <div class="detail-info">
        <h2>About this property</h2>
        <p>${p.description}</p>
        <div class="meta">
          <div class="meta-item"><span>Price</span><strong>${Bliss.money(p.price)}</strong></div>
          <div class="meta-item"><span>Status</span><strong>${p.status}</strong></div>
          <div class="meta-item"><span>Available Units</span><strong>${p.units}</strong></div>
          <div class="meta-item"><span>Category</span><strong>${p.category}</strong></div>
          <div class="meta-item"><span>Location</span><strong>${p.location}</strong></div>
          <div class="meta-item"><span>Branch</span><strong>${p.branch}</strong></div>
        </div>
        <h3>Features</h3>
        <div class="features-list">${p.features.map(f => '<span>' + f + '</span>').join('')}</div>
        <h3 style="margin-top:24px">Enquiry Form</h3>
        <form class="contact-form" id="enqForm">
          <input type="text" placeholder="Full name" required>
          <input type="email" placeholder="Email address" required>
          <input type="tel" placeholder="Phone number">
          <textarea placeholder="Your message"></textarea>
          <button class="btn btn-green" type="submit">Send Enquiry</button>
        </form>
      </div>
      <aside class="sidebar-card">
        <h3>${Bliss.money(p.price)}</h3>
        <p style="font-size:13px">${p.status} · ${p.units} units</p>
        <button class="btn btn-green" style="width:100%;margin-top:12px" id="waEnq">Enquire on WhatsApp</button>
        <button class="btn btn-outline" style="width:100%;margin-top:10px" id="callBtn">Request a Call</button>
        <p style="font-size:12px;margin-top:14px;color:var(--muted)">Company contact details are configurable placeholders until confirmed.</p>
      </aside>
    </div>
  `;

  container.querySelectorAll('.gallery-thumbs img').forEach(th => {
    th.addEventListener('click', () => {
      document.getElementById('mainImg').src = th.dataset.src;
      container.querySelectorAll('.gallery-thumbs img').forEach(x => x.classList.remove('active'));
      th.classList.add('active');
    });
  });

  const waEnq = document.getElementById('waEnq');
  if (waEnq) waEnq.addEventListener('click', () => Bliss.enquireWhatsApp(`Hello Bliss Legacy, I am interested in ${p.name} in ${p.location}, listed at ${Bliss.money(p.price)}. Please share more details.`));

  const enqForm = document.getElementById('enqForm');
  if (enqForm) enqForm.addEventListener('submit', (e) => { e.preventDefault(); alert('Thank you. Your enquiry has been noted. (Demo form — connect to backend later.)'); });

  const callBtn = document.getElementById('callBtn');
  if (callBtn) callBtn.addEventListener('click', () => alert('Request a call — connect to backend/agent assignment later.'));

  Bliss.observeFade();
});
