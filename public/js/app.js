// public/js/app.js (replace your existing file)
const API_ROOT = '/api';
const GALLERY_IMAGES = ['/images/img1.jpg','/images/img2.jpg','/images/img3.jpg','/images/img4.jpg'];
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

// NAV
function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
  document.querySelectorAll('.nav-link').forEach(a => a.classList.remove('active'));
  const link = document.querySelector(`.nav-link[data-page="${name}"]`);
  if (link) link.classList.add('active');
  const page = document.getElementById('page-' + name);
  if (page) page.classList.remove('hidden');

  // Weather visible only on home
  const isHome = (name === 'home');
  const weatherWrap = el('weather-tile')?.parentElement?.parentElement;
  const adviceWrap = el('advice-tile')?.parentElement?.parentElement;
  if (weatherWrap) weatherWrap.style.display = isHome ? 'flex' : 'none';
  if (adviceWrap) adviceWrap.style.display = isHome ? 'flex' : 'none';
  if (isHome) loadWeatherAndAdvice();
}

// AUTH UI + behavior
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
    btn.onclick = openAuthModal; // opens login by default
    area.appendChild(btn);
  }
}

function openAuthModal() {
  const m = el('auth-modal');
  m.classList.remove('hidden');
  // open in login mode by default
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
    el('auth-contact-row').classList.add('hidden');
    el('auth-role-row').classList.add('hidden');
    el('switch-auth-mode').textContent = 'Register';
  } else {
    el('auth-name-row').classList.remove('hidden');
    el('auth-contact-row').classList.remove('hidden');
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
  const messageEl = el('auth-message');
  messageEl.textContent = 'Processing...';

  try {
    if (mode === 'login') {
      const res = await apiFetch('/auth/login', { method: 'POST', body: { email, password } });
      setAuth(res.token, res.user);
      messageEl.textContent = 'Login successful.';
      // close after a short delay so user sees message
      setTimeout(() => { closeAuthModal(); renderAuthArea(); applyAuthVisibility(); }, 500);
    } else {
      // register: do NOT auto-close modal. Show verification message instead.
      const name = el('auth-name').value.trim();
      const contact = el('auth-contact').value.trim();
      const role = el('auth-role').value;
      const res = await apiFetch('/auth/register', { method: 'POST', body: { name, email, password, contact, role } });
      messageEl.textContent = 'Verification link sent to your email. Please verify before logging in.';
      // keep modal open (user closes manually)
    }
  } catch (err) {
    console.error('auth err', err);
    messageEl.textContent = err.body?.error || 'Auth failed';
  }
}

// VISIBILITY rules
function applyAuthVisibility() {
  const user = authUser();

  // Buyer
  if (user && user.role === 'buyer') {
    if (el('buyer-form')) el('buyer-form').classList.remove('hidden');
    if (el('buyer-notice')) el('buyer-notice').classList.add('hidden');
    loadMyRequests();
  } else {
    if (el('buyer-form')) el('buyer-form').classList.add('hidden');
    if (el('buyer-notice')) el('buyer-notice').classList.remove('hidden');
    clearBuyerLists();
  }

  // Farmer/Admin controls
  const farmerAllowed = user && (user.role === 'farmer' || user.role === 'admin');
  const farmerControls = el('farmer-controls');
  if (farmerControls) farmerControls.classList.toggle('hidden', !farmerAllowed);

  // hide buyer-notice for other roles
  if (user && user.role !== 'buyer') {
    if (el('buyer-notice')) el('buyer-notice').style.display = 'none';
  } else {
    if (el('buyer-notice')) el('buyer-notice').style.display = '';
  }
}

function clearBuyerLists() {
  ['pending-list','accepted-list','awaiting-list','completed-list','cancelled-list','disputed-list'].forEach(id => {
    if (el(id)) el(id).innerHTML = el(id) ? '<p class="muted">Please login to view your orders.</p>' : '';
  });
}

// BUYER: actions and list rendering
async function handleBuyerSubmit(e) {
  e.preventDefault();
  const crop = el('buyer-crop').value.trim();
  const quantity = Number(el('buyer-quantity').value);
  const contact = el('buyer-contact').value.trim();
  if (!crop || !quantity) return alert('Fill crop and quantity');
  try {
    const res = await apiFetch('/buyers/connect', { method: 'POST', body: { crop, quantity, contact } });
    alert('Request created (id: ' + res.id + ')');
    el('buyer-form').reset();
    await loadMyRequests();
  } catch (err) {
    alert(err.body?.error || 'Failed to send request.');
  }
}

async function loadMyRequests() {
  const user = authUser();
  if (!user) {
    // not logged in: show please login messages in each buyer section
    ['pending-list','accepted-list','awaiting-list','completed-list','cancelled-list','disputed-list'].forEach(id => {
      if (el(id)) el(id).innerHTML = '<p class="muted">Please login to view your orders.</p>';
    });
    return;
  }

  try {
    const res = await apiFetch('/buyers/my-requests');
    const lists = { pending: el('pending-list'), accepted: el('accepted-list'), awaiting: el('awaiting-list'), completed: el('completed-list'), cancelled: el('cancelled-list'), disputed: el('disputed-list') };
    Object.values(lists).forEach(v => v && (v.innerHTML = ''));
    (res.requests || []).forEach(r => {
      const row = renderRequestCardForBuyer(r);
      if (r.status === 'pending') lists.pending.appendChild(row);
      else if (r.status === 'accepted') lists.accepted.appendChild(row);
      else if (r.status === 'completed_pending_buyer_confirmation') lists.awaiting.appendChild(row);
      else if (r.status === 'completed') lists.completed.appendChild(row);
      else if (r.status === 'cancelled') lists.cancelled.appendChild(row);
      else if (r.status === 'disputed') lists.disputed.appendChild(row);
    });
    // empty states
    Object.entries(lists).forEach(([k, node]) => { if (node && node.children.length === 0) node.innerHTML = `<p class="muted">No ${k} orders.</p>`; });
    // wire actions (reactivate/confirm/deny/cancel)
    document.querySelectorAll('button[data-reactivate-id]').forEach(btn => {
      btn.onclick = async () => {
        if (!confirm('Reactivate this cancelled request?')) return;
        try {
          await apiFetch(`/buyers/my-requests/${btn.dataset.reactivateId}/reactivate`, { method: 'POST' });
          await loadMyRequests();
          alert('Reactivated');
        } catch (err) { alert(err.body?.error || 'Failed'); }
      };
    });
    document.querySelectorAll('button[data-confirm-id]').forEach(btn => btn.onclick = async () => {
      const id = btn.dataset.confirmId;
      if (!confirm('Confirm completion?')) return;
      try {
        await apiFetch(`/buyers/my-requests/${id}/confirm`, { method: 'POST' });
        await loadMyRequests();
        alert('Confirmed.');
      } catch (err) { alert(err.body?.error || 'Failed'); }
    });
    document.querySelectorAll('button[data-deny-id]').forEach(btn => btn.onclick = async () => {
      const id = btn.dataset.denyId;
      const reason = prompt('Enter reason for denying completion (short):') || '';
      try {
        await apiFetch(`/buyers/my-requests/${id}/deny`, { method: 'POST', body: { reason } });
        await loadMyRequests();
        alert('Marked as disputed.');
      } catch (err) { alert(err.body?.error || 'Failed'); }
    });
    document.querySelectorAll('button[data-cancel-id]').forEach(btn => btn.onclick = async () => {
      const id = btn.dataset.cancelId;
      if (!confirm('Cancel this pending request?')) return;
      try {
        await apiFetch(`/buyers/my-requests/${id}`, { method: 'PATCH', body: { action: 'cancel' } });
        await loadMyRequests();
        alert('Cancelled');
      } catch (err) { alert(err.body?.error || 'Failed'); }
    });

  } catch (err) {
    console.error('loadMyRequests err', err);
    clearBuyerLists();
  }
}

// always show farmer details to buyer when present (even after completed/disputed)
function renderRequestCardForBuyer(r) {
  const div = document.createElement('div');
  div.className = 'request-card';
  const farmerInfo = r.farmer ? `${r.farmer.name || r.farmer.email} (${r.farmer.contact || 'no contact'})` : '';
  const created = r.createdAt ? new Date(r.createdAt).toLocaleString() : '';
  let content = `<div><strong>${r.crop}</strong> — ${r.quantity} kg</div>
    <div class="muted small">Created: ${created}</div>`;
  if (r.farmer) content += `<div class="muted small">Farmer: ${farmerInfo}</div>`;
  if (r.status === 'accepted') {
    content += `<div class="muted small">Accepted at: ${r.acceptedAt ? new Date(r.acceptedAt).toLocaleString() : ''}</div>`;
  } else if (r.status === 'completed_pending_buyer_confirmation') {
    content += `<div class="muted small">Farmer marked complete at: ${r.completedAt ? new Date(r.completedAt).toLocaleString() : ''}</div>`;
    content += `<div class="mt-sm"><button class="btn small" data-confirm-id="${r._id}">Confirm</button> <button class="btn small ghost" data-deny-id="${r._id}">Deny</button></div>`;
  } else if (r.status === 'completed') {
    content += `<div class="muted small">Completed at: ${r.buyerConfirmedAt ? new Date(r.buyerConfirmedAt).toLocaleString() : ''}</div>`;
  } else if (r.status === 'cancelled') {
    content += `<div class="muted small">Cancelled at: ${r.cancelledAt ? new Date(r.cancelledAt).toLocaleString() : ''}</div>`;
    if (r.cancelledBy === 'farmer') content += `<div class="mt-sm"><button class="btn small" data-reactivate-id="${r._id}">Reactivate</button></div>`;
  } else if (r.status === 'disputed') {
    content += `<div class="muted small">Disputed at: ${r.disputedAt ? new Date(r.disputedAt).toLocaleString() : ''}</div><div class="muted small">Reason: ${r.disputeReason || 'N/A'}</div>`;
  } else if (r.status === 'pending') {
    content += `<div class="mt-sm"><button class="btn small" data-cancel-id="${r._id}">Cancel</button></div>`;
  }
  div.innerHTML = content;
  return div;
}

// FARMER: load orders and split them into sections
async function loadAllRequests() {
  const user = authUser();
  if (!user) {
    // not logged in
    const ids = ['farmer-available-list','farmer-accepted-list','farmer-awaiting-list','farmer-completed-list','farmer-cancelled-list','farmer-disputed-list'];
    ids.forEach(id => { if (el(id)) el(id).innerHTML = '<p class="muted">Please login to view orders.</p>'; });
    return;
  }

  try {
    const res = await apiFetch('/buyers/requests');
    const buckets = {
      available: el('farmer-available-list'),
      accepted: el('farmer-accepted-list'),
      awaiting: el('farmer-awaiting-list'),
      completed: el('farmer-completed-list'),
      cancelled: el('farmer-cancelled-list'),
      disputed: el('farmer-disputed-list')
    };
    Object.values(buckets).forEach(b => b && (b.innerHTML = ''));

    (res.requests || []).forEach(r => {
      // decide which farmer bucket for this user:
      // available = pending
      // accepted = status accepted and farmer assigned to anyone (show if assigned to this farmer OR show all accepted? We'll separate:
      // - accepted: accepted and assigned to current farmer OR if admin show all accepted
      // - awaiting: completed_pending_buyer_confirmation (if assigned to current farmer or admin)
      // - completed: completed
      // - cancelled: cancelled
      // - disputed: disputed
      const status = r.status;
      if (status === 'pending') {
        // available to all farmers
        const node = renderRequestCardForFarmer(r);
        buckets.available.appendChild(node);
      } else if (status === 'accepted') {
        // only show if assigned to me or admin; admin sees all accepted
        const assigned = r.farmer ? r.farmer._id : null;
        if (user.role === 'admin' || (assigned && assigned === user.id)) buckets.accepted.appendChild(renderRequestCardForFarmer(r));
      } else if (status === 'completed_pending_buyer_confirmation') {
        const assigned = r.farmer ? r.farmer._id : null;
        if (user.role === 'admin' || (assigned && assigned === user.id)) buckets.awaiting.appendChild(renderRequestCardForFarmer(r));
      } else if (status === 'completed') {
        const assigned = r.farmer ? r.farmer._id : null;
        if (user.role === 'admin' || (assigned && assigned === user.id)) buckets.completed.appendChild(renderRequestCardForFarmer(r));
      } else if (status === 'cancelled') {
        const assigned = r.farmer ? r.farmer._id : null;
        // show cancelled to assigned farmer and admin; also show cancelled where cancelledBy = farmer for the buyer reactivation case
        if (user.role === 'admin' || (assigned && assigned === user.id)) buckets.cancelled.appendChild(renderRequestCardForFarmer(r));
      } else if (status === 'disputed') {
        if (user.role === 'admin' || (r.farmer && r.farmer._id === user.id)) buckets.disputed.appendChild(renderRequestCardForFarmer(r));
      }
    });

    // Empty-state messages per section
    Object.entries(buckets).forEach(([k, node]) => {
      if (!node) return;
      if (node.children.length === 0) {
        node.innerHTML = `<p class="muted">No ${k} orders.</p>`;
      }
    });

    // Wire farmer action buttons by delegating events
    document.querySelectorAll('#farmer-available-list button[data-action], #farmer-accepted-list button[data-action], #farmer-awaiting-list button[data-action], #farmer-completed-list button[data-action], #farmer-disputed-list button[data-action]').forEach(btn => {
      btn.onclick = async () => {
        const id = btn.dataset.id; const action = btn.dataset.action;
        if (!confirm(`${action.toUpperCase()} this request?`)) return;
        try {
          if (action === 'reassign') {
            const farmerId = prompt('Enter farmer id to assign (ObjectId):');
            if (!farmerId) return;
            await apiFetch(`/buyers/requests/${id}/reassign`, { method: 'POST', body: { farmerId } });
          } else {
            await apiFetch(`/buyers/requests/${id}`, { method: 'PATCH', body: { action } });
          }
          await loadAllRequests(); await loadMyRequests();
        } catch (err) {
          alert(err.body?.error || 'Action failed.');
        }
      };
    });

  } catch (err) {
    console.error('loadAllRequests err', err);
    // set friendly messages when error
    ['farmer-available-list','farmer-accepted-list','farmer-awaiting-list','farmer-completed-list','farmer-cancelled-list','farmer-disputed-list'].forEach(id => {
      if (el(id)) el(id).innerHTML = '<p class="muted">Failed to load orders.</p>';
    });
  }
}

// farmer card renderer (shows buyer & timestamps & action buttons appropriate to status)
function renderRequestCardForFarmer(r) {
  const div = document.createElement('div');
  div.className = 'request-card';
  const created = r.createdAt ? new Date(r.createdAt).toLocaleString() : '';
  const buyerInfo = r.buyer ? `${r.buyer.name || r.buyer.email} (${r.buyer.contact || 'no contact'})` : 'Unknown buyer';
  const farmerAssigned = r.farmer ? `${r.farmer.name || r.farmer.email}` : '';
  let html = `<div><strong>${r.crop}</strong> — ${r.quantity} kg</div>
    <div class="muted small">Buyer: ${buyerInfo}</div>
    <div class="muted small">Created: ${created}</div>`;
  if (r.farmer) html += `<div class="muted small">Assigned: ${farmerAssigned}</div>`;
  // status + timestamps
  if (r.status === 'pending') {
    html += `<div class="muted small">Status: pending</div>`;
    html += `<div class="mt-sm"><button class="btn small" data-action="accept" data-id="${r._id}">Accept</button></div>`;
  } else if (r.status === 'accepted') {
    html += `<div class="muted small">Status: accepted • Accepted at: ${r.acceptedAt ? new Date(r.acceptedAt).toLocaleString() : ''}</div>`;
    html += `<div class="mt-sm"><button class="btn small" data-action="complete" data-id="${r._id}">Mark Completed</button> <button class="btn small ghost" data-action="cancel" data-id="${r._id}">Cancel</button></div>`;
  } else if (r.status === 'completed_pending_buyer_confirmation') {
    html += `<div class="muted small">Status: awaiting buyer confirmation • Farmer completed at: ${r.completedAt ? new Date(r.completedAt).toLocaleString() : ''}</div>`;
    html += `<div class="mt-sm"><button class="btn small ghost" data-action="cancel" data-id="${r._id}">Cancel</button></div>`;
  } else if (r.status === 'completed') {
    html += `<div class="muted small">Status: completed • Completed at: ${r.completedAt ? new Date(r.completedAt).toLocaleString() : ''} • Buyer confirmed at: ${r.buyerConfirmedAt ? new Date(r.buyerConfirmedAt).toLocaleString() : ''}</div>`;
  } else if (r.status === 'cancelled') {
    html += `<div class="muted small">Status: cancelled • Cancelled at: ${r.cancelledAt ? new Date(r.cancelledAt).toLocaleString() : ''} • By: ${r.cancelledBy || 'N/A'}</div>`;
  } else if (r.status === 'disputed') {
    html += `<div class="muted small">Status: disputed • Disputed at: ${r.disputedAt ? new Date(r.disputedAt).toLocaleString() : ''}</div><div class="muted small">Reason: ${r.disputeReason || 'N/A'}</div>`;
    html += `<div class="mt-sm"><button class="btn small" data-action="resolve-complete" data-id="${r._id}">Resolve: Complete</button> <button class="btn small ghost" data-action="resolve-cancel" data-id="${r._id}">Resolve: Cancel</button> <button class="btn small ghost" data-action="reassign" data-id="${r._id}">Reassign</button></div>`;
  }
  div.innerHTML = html;
  return div;
}

// CAROUSEL (unchanged)
function buildCarousel(images) {
  const track = document.getElementById('carousel-track');
  track.innerHTML = '';
  images.forEach((src, idx) => {
    const item = document.createElement('div'); item.className = 'carousel-item';
    const img = document.createElement('img'); img.className = 'carousel-img'; img.src = src; img.loading = 'lazy';
    img.onerror = () => { if (img.src !== FALLBACK_IMAGE) img.src = FALLBACK_IMAGE; };
    item.appendChild(img); track.appendChild(item);
  });
  let current = 0; const items = [...track.children];
  function show(i) { items.forEach((it, idx) => it.classList.toggle('active', idx === i)); current = i; }
  if (items.length) show(0);
  if (el('prev-btn')) el('prev-btn').onclick = () => show((current - 1 + items.length) % items.length);
  if (el('next-btn')) el('next-btn').onclick = () => show((current + 1) % items.length);
}

// MANDI & COMMODITIES (keeps earlier behavior)
async function loadMandiPrices(state = '', crop = '') {
  const out = el('mandi-list');
  out.innerHTML = 'Loading mandi prices…';
  try {
    const url = new URL('/api/mandi/prices', location.origin);
    if (state) url.searchParams.set('state', state);
    const r = await fetch(url.toString());
    if (!r.ok) throw new Error('mandi fetch failed');
    const json = await r.json();
    let rows = json.prices || [];
    if (crop) rows = rows.filter(r => (r.crop || '').toLowerCase() === crop.toLowerCase());
    if (!rows.length) { out.innerHTML = '<p class="muted">No mandi data for selection.</p>'; return; }
    out.innerHTML = rows.map(p => `
      <div class="mandi-row">
        <strong>${p.crop}</strong>
        <div class="muted small">${p.district || ''}, ${p.state || ''}</div>
        <div>Today: ₹${p.todayPrice ?? 'N/A'} • Yesterday: ₹${p.yesterdayPrice ?? 'N/A'}</div>
      </div>
    `).join('');
  } catch (err) {
    console.error('loadMandiPrices err', err);
    out.innerHTML = '<p class="muted">Failed to load mandi prices.</p>';
  }
}

async function loadCommodities() {
  const list = el('commodities-list');
  list.innerHTML = 'Loading commodities…';
  try {
    const res = await apiFetch('/commodities');
    if (!res.commodities || res.commodities.length === 0) {
      list.innerHTML = '<p class="muted">No commodities found.</p>'; return;
    }
    list.innerHTML = '';
    res.commodities.forEach(c => {
      const elc = document.createElement('div');
      elc.className = 'commodity';
      elc.id = 'comm-' + (c._id ?? c.commodity);
      elc.innerHTML = `<strong>${c.commodity}</strong> — ₹${c.price ?? 'N/A'} <span class="muted small">(${c.change >= 0 ? '+' : ''}${c.change ?? 0})</span>`;
      list.appendChild(elc);
    });
  } catch (err) {
    console.error('loadCommodities err', err);
    list.innerHTML = '<p class="muted">Failed to load commodities.</p>';
  }
}

// WEATHER w/ update status text
let lastWeatherFetch = 0;
async function loadWeatherAndAdvice() {
  const statusEl = el('weather-status');
  if (statusEl) statusEl.textContent = 'Updating…';
  const updateBtn = el('weather-update-btn');
  if (updateBtn) { updateBtn.disabled = true; updateBtn.textContent = 'Updating…'; }

  const defaultCoords = { lat: 18.5204, lon: 73.8567 };
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
    if (statusEl) statusEl.textContent = 'Weather updated';
    lastWeatherFetch = Date.now();
  } catch (err) {
    console.error('weather err', err);
    if (el('weather-tile')) el('weather-tile').innerHTML = '<p class="muted">Weather unavailable.</p>';
    if (el('advice-tile')) el('advice-tile').innerHTML = '<p class="muted">Advice unavailable.</p>';
    if (statusEl) statusEl.textContent = 'Update failed';
  } finally {
    if (updateBtn) {
      updateBtn.disabled = false;
      setTimeout(() => { updateBtn.textContent = 'Update Weather'; if (statusEl && lastWeatherFetch) statusEl.textContent = 'Updated'; }, 900);
    }
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
  const suggestions = []; const tips = [];
  if (desc.includes('rain') || rain > 0) { suggestions.push('Rice','Sugarcane','Maize'); tips.push('Expect wet fields — delay harvesting.'); }
  else if (temp >= 30) { suggestions.push('Groundnut','Sorghum','Cotton'); tips.push('High temps — irrigate early morning & late evening.'); }
  else if (temp >= 20 && temp < 30) { suggestions.push('Wheat','Chickpea','Mustard'); tips.push('Good conditions — consider short-duration pulses.'); }
  else { suggestions.push('Leafy vegetables','Potatoes'); tips.push('Cool — protect seedlings.'); }
  if (rain > 5) tips.push(`Recent rain ${rain}mm — reduce irrigation.`); if (temp > 35) tips.push('Heat stress likely.');
  adv.innerHTML = `<h4 class="mt-0">Advice</h4><div class="chip-row">${suggestions.slice(0,4).map(s=>`<span class="chip">${s}</span>`).join('')}</div><div class="mt-sm"><strong>Tips:</strong><ul>${tips.map(t=>`<li>${t}</li>`).join('')}</ul></div>`;
}

// WIRING
function wireEvents() {
  document.querySelectorAll('.nav-link').forEach(a => a.onclick = (ev) => { ev.preventDefault(); showPage(a.dataset.page); });
  document.addEventListener('click', (ev) => { if (ev.target.id === 'btn-show-login') openAuthModal(); });
  if (el('switch-auth-mode')) el('switch-auth-mode').onclick = switchAuthMode;
  if (el('close-auth')) el('close-auth').onclick = closeAuthModal;
  if (el('auth-form')) el('auth-form').addEventListener('submit', handleAuthSubmit);
  if (el('buyer-form')) el('buyer-form').addEventListener('submit', handleBuyerSubmit);
  if (el('mandi-filter-btn')) el('mandi-filter-btn').onclick = () => { const state = el('filter-state').value; const crop = el('filter-crop').value; loadMandiPrices(state, crop); showPage('mandi'); };
  if (el('load-all-requests')) el('load-all-requests').onclick = loadAllRequests;
  if (el('weather-update-btn')) el('weather-update-btn').onclick = loadWeatherAndAdvice;
}

async function init() {
  wireEvents();
  renderAuthArea();
  applyAuthVisibility();
  buildCarousel(GALLERY_IMAGES);
  await loadCommodities();
  if (typeof subscribeSse === 'function') subscribeSse();
  await loadMandiPrices();
  showPage('home');
}

document.addEventListener('DOMContentLoaded', init);
