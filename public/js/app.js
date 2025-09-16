// public/js/app.js
const API_ROOT = '/api';
const GALLERY_IMAGES = [
  'https://res.cloudinary.com/dp55vvd7j/image/upload/v1752517674/userFiles/bsrww3j7ay37ffojvluu.jpg',
  'https://res.cloudinary.com/dp55vvd7j/image/upload/v1752846509/fakeauthenticator/xwxmbs9dzbkvpehdnkhy.jpg',
  'https://res.cloudinary.com/dp55vvd7j/image/upload/v1741255926/cld-sample-5.jpg',
  'https://res.cloudinary.com/dp55vvd7j/image/upload/v1741255924/samples/coffee.jpg'
];
const FALLBACK_IMAGE = '/images/fallback.png';

const el = id => document.getElementById(id);
const authToken = () => localStorage.getItem('am_token');
const authUser = () => JSON.parse(localStorage.getItem('am_user') || 'null');
const setAuth = (t, u) => { localStorage.setItem('am_token', t); localStorage.setItem('am_user', JSON.stringify(u)); };
const clearAuth = () => { localStorage.removeItem('am_token'); localStorage.removeItem('am_user'); };

async function apiFetch(path, opts = {}) {
  opts.headers = opts.headers || {};
  opts.headers['Content-Type'] = 'application/json';
  const token = authToken();
  if (token) opts.headers['Authorization'] = `Bearer ${token}`;
  if (opts.body && typeof opts.body === 'object') opts.body = JSON.stringify(opts.body);
  const res = await fetch(`${API_ROOT}${path}`, opts);
  let body = {};
  try { body = await res.json(); } catch (e) {}
  if (!res.ok) throw { status: res.status, body };
  return body;
}

// ---------------- Navigation / Page system ----------------
function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
  document.querySelectorAll('.nav-link').forEach(a => a.classList.remove('active'));
  const link = document.querySelector(`.nav-link[data-page="${name}"]`);
  if (link) link.classList.add('active');
  const page = document.getElementById('page-' + name);
  if (page) page.classList.remove('hidden');

  // Weather only on home
  const isHome = (name === 'home');
  const weatherTile = el('weather-tile');
  const adviceTile = el('advice-tile');
  if (weatherTile) weatherTile.parentElement.parentElement.style.display = isHome ? 'flex' : 'none';
  if (adviceTile) adviceTile.parentElement.parentElement.style.display = isHome ? 'flex' : 'none';

  if (isHome) loadWeatherAndAdvice();
}

// ---------------- Auth UI & flow ----------------
function renderAuthArea() {
  const area = el('auth-area');
  area.innerHTML = '';
  const user = authUser();
  if (user) {
    const span = document.createElement('span');
    span.className = 'muted';
    span.textContent = `${user.name || user.email} (${user.role})`;
    area.appendChild(span);

    const logout = document.createElement('button');
    logout.className = 'btn small ml-sm';
    logout.textContent = 'Logout';
    logout.onclick = () => { clearAuth(); renderAuthArea(); applyAuthVisibility(); };
    area.appendChild(logout);
  } else {
    const btn = document.createElement('button');
    btn.className = 'btn small';
    btn.id = 'btn-show-login';
    btn.textContent = 'Login / Register';
    btn.onclick = openAuthModal;
    area.appendChild(btn);
  }
}

function openAuthModal() {
  const m = el('auth-modal');
  m.classList.remove('hidden');
  setAuthMode('login');
  el('auth-message').textContent = '';
}

function closeAuthModal() { el('auth-modal').classList.add('hidden'); }

function setAuthMode(mode) {
  const form = el('auth-form');
  form.dataset.mode = mode;
  el('auth-title').textContent = mode === 'login' ? 'Login' : 'Register';
  el('auth-submit').textContent = mode === 'login' ? 'Login' : 'Create Account';
  if (mode === 'login') {
    el('auth-name-row').classList.add('hidden');
    el('auth-role-row').classList.add('hidden');
    el('switch-auth-mode').textContent = 'Register';
  } else {
    el('auth-name-row').classList.remove('hidden');
    el('auth-role-row').classList.remove('hidden');
    el('switch-auth-mode').textContent = 'Login';
  }
}

function switchAuthMode() {
  const cur = el('auth-form').dataset.mode || 'login';
  setAuthMode(cur === 'login' ? 'register' : 'login');
}

async function handleAuthSubmit(e) {
  e.preventDefault();
  const mode = el('auth-form').dataset.mode || 'login';
  const email = el('auth-email').value.trim();
  const password = el('auth-password').value;
  try {
    if (mode === 'login') {
      const res = await apiFetch('/auth/login', { method: 'POST', body: { email, password } });
      setAuth(res.token, res.user);
    } else {
      const name = el('auth-name').value.trim();
      const role = el('auth-role').value; // admin option was removed in UI
      const res = await apiFetch('/auth/register', { method: 'POST', body: { name, email, password, role } });
      setAuth(res.token, res.user);
    }
    closeAuthModal();
    renderAuthArea();
    applyAuthVisibility();
  } catch (err) {
    el('auth-message').textContent = err.body?.error || 'Auth failed';
  }
}

// ---------------- Visibility rules ----------------
function applyAuthVisibility() {
  const user = authUser();

  // Buyer form visibility
  if (user && user.role === 'buyer') {
    el('buyer-form').classList.remove('hidden');
    el('buyer-notice').classList.add('hidden');
    loadMyRequests();
  } else {
    el('buyer-form').classList.add('hidden');
    el('buyer-notice').classList.remove('hidden');
    el('my-requests').innerHTML = '';
  }

  // Farmer/Admin controls: show the block only if farmer or admin
  const farmerAllowed = user && (user.role === 'farmer' || user.role === 'admin');
  const farmerControls = el('farmer-controls');
  if (farmerControls) {
    farmerControls.classList.toggle('hidden', !farmerAllowed);
  }
}

// ---------------- Buyer actions ----------------
async function handleBuyerSubmit(e) {
  e.preventDefault();
  const crop = el('buyer-crop').value.trim();
  const quantity = Number(el('buyer-quantity').value);
  const price = Number(el('buyer-price').value);
  const contact = el('buyer-contact').value.trim();
  try {
    const res = await apiFetch('/buyers/connect', { method: 'POST', body: { crop, quantity, price, contact } });
    alert('Request created (id: ' + res.id + ')');
    el('buyer-form').reset();
    loadMyRequests();
  } catch (err) {
    alert(err.body?.error || 'Failed to send request.');
  }
}

async function loadMyRequests() {
  try {
    const res = await apiFetch('/buyers/my-requests');
    const out = el('my-requests');
    if (!res.requests || res.requests.length === 0) {
      out.innerHTML = '<p class="muted">No requests yet.</p>';
      return;
    }
    out.innerHTML = '';
    res.requests.forEach(r => {
      const d = document.createElement('div');
      d.className = 'request-card';
      const farmerInfo = r.farmer ? `${r.farmer.name || r.farmer.email}` : '';
      const contactInfo = r.contact ? `<div class="muted small">Contact: ${r.contact}</div>` : '';
      const statusInfo = `<div class="muted small">status: ${r.status}${r.acceptedAt ? ' • accepted at ' + new Date(r.acceptedAt).toLocaleString() : ''}</div>`;
      let actions = '';
      if (r.status === 'pending') {
        actions = `<button class="btn small" data-cancel-id="${r._id}">Cancel</button>`;
      }
      d.innerHTML = `<strong>${r.crop}</strong> — ${r.quantity} kg ${statusInfo}${contactInfo}<div class="mt-sm">${actions}</div>`;
      out.appendChild(d);
    });

    // wire cancel buttons (buyer)
    out.querySelectorAll('button[data-cancel-id]').forEach(btn => {
      btn.onclick = async () => {
        const id = btn.dataset.cancelId;
        if (!confirm('Cancel this pending request?')) return;
        try {
          await apiFetch(`/buyers/my-requests/${id}`, { method: 'PATCH', body: { action: 'cancel' } });
          await loadMyRequests();
          alert('Request cancelled.');
        } catch (err) {
          alert(err.body?.error || 'Failed to cancel.');
        }
      };
    });
  } catch (err) {
    el('my-requests').innerHTML = '<p class="muted">Could not load requests.</p>';
  }
}

// ---------------- Farmer/Admin: load & manage requests ----------------
async function loadAllRequests() {
  try {
    const res = await apiFetch('/buyers/requests');
    const out = el('all-requests');
    if (!res.requests || res.requests.length === 0) {
      out.innerHTML = '<p class="muted">No pending requests.</p>';
      return;
    }
    out.innerHTML = '';
    const user = authUser();
    res.requests.forEach(r => {
      const d = document.createElement('div');
      d.className = 'request-card';
      const buyerInfo = r.buyer ? `${r.buyer.name || r.buyer.email}` : 'Unknown buyer';
      const contactInfo = r.contact ? `<div class="muted small">Contact: ${r.contact}</div>` : '';
      const farmerInfo = r.farmer ? `<div class="muted small">Assigned Farmer: ${r.farmer.name || r.farmer.email}</div>` : '';
      let actionsHtml = '';

      if (r.status === 'pending') {
        if (user && (user.role === 'farmer' || user.role === 'admin')) {
          actionsHtml += `<button class="btn small" data-action="accept" data-id="${r._id}">Accept</button>`;
          // Admins can cancel any pending
          if (user.role === 'admin') actionsHtml += `<button class="btn small ghost" data-action="cancel" data-id="${r._id}">Cancel</button>`;
        }
      } else if (r.status === 'accepted') {
        const assigned = r.farmer ? String(r.farmer._id) : null;
        if (user && (user.role === 'admin' || (user.role === 'farmer' && assigned === user.id))) {
          actionsHtml += `<button class="btn small" data-action="complete" data-id="${r._id}">Mark Completed</button>`;
          actionsHtml += `<button class="btn small ghost" data-action="cancel" data-id="${r._id}">Cancel</button>`;
        }
      } else if (r.status === 'completed') {
        actionsHtml += `<div class="muted small">Completed at ${r.completedAt ? new Date(r.completedAt).toLocaleString() : ''}</div>`;
      } else if (r.status === 'cancelled') {
        actionsHtml += `<div class="muted small">Cancelled</div>`;
      }

      d.innerHTML = `
        <div><strong>${r.crop}</strong> — ${r.quantity} kg</div>
        <div class="muted small">Buyer: ${buyerInfo} • Created: ${new Date(r.createdAt).toLocaleString()}</div>
        ${contactInfo}
        ${farmerInfo}
        <div class="mt-sm">${actionsHtml}</div>
      `;
      out.appendChild(d);
    });

    // wire action buttons
    out.querySelectorAll('button[data-action]').forEach(btn => {
      btn.onclick = async () => {
        const id = btn.dataset.id;
        const action = btn.dataset.action;
        if (!confirm(`${action.toUpperCase()} this request?`)) return;
        try {
          await apiFetch(`/buyers/requests/${id}`, { method: 'PATCH', body: { action } });
          await loadAllRequests();
          await loadMyRequests();
          alert('Action completed.');
        } catch (err) {
          alert(err.body?.error || 'Action failed.');
        }
      };
    });

  } catch (err) {
    console.error('loadAllRequests', err);
    el('all-requests').innerHTML = '<p class="muted">Failed to load requests.</p>';
  }
}

// ---------------- Carousel ----------------
function buildCarousel(images) {
  const track = document.getElementById('carousel-track');
  track.innerHTML = '';
  images.forEach((src, idx) => {
    const item = document.createElement('div');
    item.className = 'carousel-item';
    const img = document.createElement('img');
    img.className = 'carousel-img';
    img.src = src;
    img.alt = `Image ${idx+1}`;
    img.loading = 'lazy';
    img.onerror = () => { if (img.src !== FALLBACK_IMAGE) img.src = FALLBACK_IMAGE; };
    item.appendChild(img);
    track.appendChild(item);
  });
  let current = 0;
  const items = [...track.children];
  function show(i) { items.forEach((it, idx) => it.classList.toggle('active', idx === i)); current = i; }
  if (items.length) show(0);
  const prev = el('prev-btn'); const next = el('next-btn');
  if (prev) prev.onclick = () => show((current - 1 + items.length) % items.length);
  if (next) next.onclick = () => show((current + 1) % items.length);
}

// ---------------- Mandi ----------------
async function loadMandiPrices(state = '', crop = '') {
  try {
    const url = new URL('/api/mandi/prices', location.origin);
    if (state) url.searchParams.set('state', state);
    const res = await fetch(url.toString());
    const json = await res.json();
    const out = el('mandi-list');
    let rows = json.prices || [];
    if (crop) rows = rows.filter(r => (r.crop || '').toLowerCase() === crop.toLowerCase());
    if (!rows.length) { out.innerHTML = '<p class="muted">No mandi data for selection.</p>'; return; }
    out.innerHTML = rows.map(p => `
      <div class="mandi-row">
        <strong>${p.crop}</strong>
        <div class="muted small">${p.district}, ${p.state}</div>
        <div>Today: ₹${p.todayPrice} • Yesterday: ₹${p.yesterdayPrice}</div>
      </div>
    `).join('');
  } catch (err) {
    el('mandi-list').innerHTML = '<p class="muted">Failed to load mandi prices.</p>';
  }
}

// ---------------- Commodities SSE ----------------
async function loadCommodities() {
  try {
    const json = await apiFetch('/commodities');
    const list = el('commodities-list');
    list.innerHTML = '';
    (json.commodities || []).forEach(c => {
      const elc = document.createElement('div');
      elc.className = 'commodity';
      elc.id = 'comm-' + (c._id ?? c.commodity);
      elc.innerHTML = `<strong>${c.commodity}</strong> — ₹${c.price} <span class="muted small">(${c.change >= 0 ? '+' : ''}${c.change || 0})</span>`;
      list.appendChild(elc);
    });
  } catch (err) {
    el('commodities-list').innerHTML = '<p class="muted">Failed to load commodities.</p>';
  }
}
function subscribeSse() {
  try {
    const es = new EventSource('/api/commodities/sse');
    es.onmessage = ev => {
      try {
        const payload = JSON.parse(ev.data);
        if (payload.type === 'update') {
          const c = payload.data;
          const id = 'comm-' + (c._id ?? c.commodity);
          const target = document.getElementById(id);
          if (target) target.innerHTML = `<strong>${c.commodity}</strong> — ₹${c.price} <span class="muted small">(${c.change >= 0 ? '+' : ''}${c.change || 0})</span>`;
          else loadCommodities();
        }
      } catch (e) { console.error(e); }
    };
  } catch (e) { /* SSE not supported */ }
}

// ---------------- Weather (only called on home page) ----------------
async function loadWeatherAndAdvice() {
  const defaultCoords = { lat: 18.5204, lon: 73.8567 }; // Pune
  let coords = defaultCoords;
  try {
    const pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { timeout: 6000 }));
    coords = { lat: pos.coords.latitude, lon: pos.coords.longitude };
  } catch (_) { /* fallback */ }

  try {
    const r = await fetch(`/api/external-weather?lat=${coords.lat}&lon=${coords.lon}`);
    if (!r.ok) throw new Error('weather proxy failed');
    const data = await r.json();
    renderWeatherTile(data);
    renderAdviceTile(data);
  } catch (err) {
    el('weather-tile').innerHTML = '<p class="muted">Weather unavailable.</p>';
    el('advice-tile').innerHTML = '<p class="muted">Advice unavailable.</p>';
  }
}

function renderWeatherTile(data) {
  if (!data) return;
  const t = el('weather-tile');
  const temp = data.main?.temp;
  const desc = data.weather?.[0]?.description || '';
  const icon = data.weather?.[0]?.icon;
  t.innerHTML = `
    <div class="wtop">
      <img class="weather-icon" src="https://openweathermap.org/img/wn/${icon}@2x.png" alt="${desc}" />
      <div>
        <div class="large">${temp !== undefined ? Math.round(temp) + '°C' : '--'}</div>
        <div class="muted">${desc}</div>
      </div>
    </div>
    <div class="muted small">Location: ${data.name || 'local'}</div>
  `;
}

function renderAdviceTile(weather) {
  const adv = el('advice-tile');
  if (!weather) { adv.innerHTML = '<p class="muted">No advice.</p>'; return; }
  const temp = weather.main?.temp ?? 25;
  const rain = weather.rain?.['1h'] ?? 0;
  const desc = (weather.weather?.[0]?.main || '').toLowerCase();

  const suggestions = [];
  const tips = [];
  if (desc.includes('rain') || rain > 0) {
    suggestions.push('Rice', 'Sugarcane', 'Maize');
    tips.push('Expect wet fields — delay harvesting and ensure drainage.');
  } else if (temp >= 30) {
    suggestions.push('Groundnut', 'Sorghum', 'Cotton');
    tips.push('High temps — irrigate early morning & late evening.');
  } else if (temp >= 20 && temp < 30) {
    suggestions.push('Wheat', 'Chickpea', 'Mustard');
    tips.push('Good conditions — consider short-duration pulses.');
  } else {
    suggestions.push('Leafy vegetables', 'Potatoes');
    tips.push('Cool — protect seedlings from cold snaps.');
  }
  if (rain > 5) tips.push(`Recent rain ${rain}mm — reduce irrigation.`);
  if (temp > 35) tips.push('Heat stress likely — consider shade nets.');

  adv.innerHTML = `
    <h4 class="mt-0">Advice</h4>
    <div class="chip-row">${suggestions.slice(0,4).map(s => `<span class="chip">${s}</span>`).join('')}</div>
    <div class="mt-sm"><strong>Tips:</strong><ul>${tips.map(t => `<li>${t}</li>`).join('')}</ul></div>
  `;
}

// ---------------- Wiring ----------------
function wireEvents() {
  document.querySelectorAll('.nav-link').forEach(a => {
    a.onclick = (ev) => { ev.preventDefault(); showPage(a.dataset.page); };
  });

  document.addEventListener('click', (ev) => {
    if (ev.target.id === 'btn-show-login') openAuthModal();
  });

  el('switch-auth-mode').onclick = switchAuthMode;
  el('close-auth').onclick = closeAuthModal;
  el('auth-form').onsubmit = handleAuthSubmit;

  el('buyer-form').addEventListener('submit', handleBuyerSubmit);
  el('mandi-filter-btn').onclick = () => {
    const state = el('filter-state').value;
    const crop = el('filter-crop').value;
    loadMandiPrices(state, crop);
    showPage('mandi');
  };

  el('load-all-requests').onclick = loadAllRequests;
  el('prev-btn').onclick = () => {}; // set by buildCarousel
  el('next-btn').onclick = () => {};
}

async function init() {
  wireEvents();
  renderAuthArea();
  applyAuthVisibility();

  buildCarousel(GALLERY_IMAGES);
  await loadCommodities();
  subscribeSse();
  await loadMandiPrices(); // load all initially

  // Start at home page (shows weather)
  showPage('home');
}

document.addEventListener('DOMContentLoaded', init);
