/* app.js — Clean version for SwitchToIndia
   - Default: uses Netlify function at /.netlify/functions/getProducts
   - Renders product thumbnail, parent, country, stacked alternatives with Switch/Add
   - Basket persisted to localStorage under key 'stindiabasket_v1'
   - Renders pie chart using Chart.js on basket page
*/

/* ------------- Configuration ------------- */
// If you want to call Airtable directly from client (NOT recommended), set to false and fill AIRTABLE_TOKEN/BASE_ID.
const USE_NETLIFY_FUNCTION = true;
const AIRTABLE_TOKEN = "YOUR_PERSONAL_ACCESS_TOKEN"; // only if USE_NETLIFY_FUNCTION === false
const BASE_ID = "YOUR_BASE_ID";                     // only if USE_NETLIFY_FUNCTION === false
const TABLE_NAME = "Products";

/* ------------- Data fetch abstraction ------------- */
let _productsCache = null;

async function fetchProductsOnce() {
  if (_productsCache) return _productsCache;

  if (USE_NETLIFY_FUNCTION) {
    const endpoint = '/.netlify/functions/getProducts';
    const res = await fetch(endpoint);
    if (!res.ok) {
      const txt = await res.text();
      throw new Error('Function fetch failed: ' + res.status + ' ' + txt);
    }
    const json = await res.json();
    // Netlify function returns { records: [ ... ] } where each record is already normalized (fields)
    _productsCache = (json.records || []).map(r => r);
    return _productsCache;
  } else {
    // Direct client-side Airtable fetch (exposes token in browser; only for quick testing)
    const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_NAME)}?pageSize=100`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error('Airtable fetch failed: ' + res.status + ' ' + txt);
    }
    const json = await res.json();
    _productsCache = (json.records || []).map(r => r.fields || {});
    return _productsCache;
  }
}

/* ------------- Search + render ------------- */
async function searchAndShow(q) {
  const resultsList = document.getElementById('resultsList');
  if (!resultsList) return;
  resultsList.innerHTML = '<div class="small">Searching…</div>';

  try {
    const all = await fetchProductsOnce();
    const ql = (q || '').toString().toLowerCase().trim();

    const results = all.filter(p => {
      const item = p.fields ? p.fields : p;
      const name = (item.ProductName || item.ProductID || '').toString().toLowerCase();
      const brand = (item.Brand || '').toString().toLowerCase();
      const alt1 = (item.Alternative1 || '').toString().toLowerCase();
      const alt2 = (item.Alternative2 || '').toString().toLowerCase();
      const alt3 = (item.Alternative3 || '').toString().toLowerCase();

      if (!ql) return true; // show all when query empty (you can change to false if needed)
      return name.includes(ql) || brand.includes(ql) || alt1.includes(ql) || alt2.includes(ql) || alt3.includes(ql);
    });

    renderResults(results);
  } catch (err) {
    resultsList.innerHTML = `<div class="small">Error fetching data: ${escapeHtml(err.message || err)}</div>`;
    console.error(err);
  }
}

/* renderResults: creates result cards with stacked alternatives */
function renderResults(results) {
  const container = document.getElementById('resultsList');
  const no = document.getElementById('noResults');
  container.innerHTML = '';

  if (!results || results.length === 0) {
    if (no) no.style.display = 'block';
    return;
  } else if (no) {
    no.style.display = 'none';
  }

  results.forEach(p => {
    const item = p.fields ? p.fields : p;

    const name = item.ProductName || item.ProductID || 'Unnamed product';
    const brand = item.Brand || '';
    const parent = item.ParentCompany || 'Unknown';
    const country = item.ParentCountry || 'Unknown';
    const imageUrl = item.ImageURL || '';

    const alts = [];
    if (item.Alternative1) alts.push(item.Alternative1);
    if (item.Alternative2) alts.push(item.Alternative2);
    if (item.Alternative3) alts.push(item.Alternative3);

    // Build alternatives block with heading
    let altHtml = '';
    if (alts.length) {
      altHtml = '<div class="alt-list">';
      altHtml += '<div style="margin-bottom:8px;font-weight:700;color:#333">Alternatives:</div>';
      alts.forEach((a) => {
  const safeA = escapeJS(a);
  altHtml += `
    <div class="alt-item">
      <div class="alt-name">
        ${escapeHtml(a)} <span class="flag-badge indian">Indian</span>
      </div>
      <div class="alt-action">
        <button class="btn btn-ghost small-btn" onclick="addAlternativeToBasket('${safeA}')">Switch / Add</button>
      </div>
    </div>`;
});

      altHtml += '</div>';
    } else {
      altHtml = `<div style="margin-top:8px;color:#666">No alternatives listed</div>`;
    }

    const isIndian = (country || '').toString().toLowerCase().includes('india');
    const badgeHtml = isIndian
      ? '<span class="flag-badge indian">Indian</span>'
      : '<span class="flag-badge foreign">Foreign</span>';

    const safeName = escapeJS(name);
    const safeCountry = escapeJS(country);
    const imgHtml = imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(name)}" class="product-thumb">` : '';

    const html = `
      <div class="result-row" style="margin-bottom:12px;">
        <div class="result-left">
          <div style="display:flex;align-items:center;gap:12px;">
            ${imgHtml}
            <div style="flex:1">
              <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
                <h3 style="margin:0;">${escapeHtml(name)}</h3>
                ${badgeHtml}
                <button class="btn btn-ghost small-btn" style="margin-left:6px;" onclick="addToBasketFromResult('${safeName}', '${safeCountry}')">Add</button>
              </div>
              <div class="small" style="margin-top:8px;"><strong>Brand:</strong> ${escapeHtml(brand)} &nbsp; <strong>Parent:</strong> ${escapeHtml(parent)} — ${escapeHtml(country)}</div>
            </div>
          </div>

          ${altHtml}
        </div>
      </div>
    `;
    container.insertAdjacentHTML('beforeend', html);
  });
}

/* ---------- Basket: grouped items, qty, price, remove/confirm ---------- */

const BASKET_KEY = 'stindiabasket_v1';

/*
 Helper: read basket array from storage (array of {id,name,country,qty,price})
 */
function readBasket() {
  try {
    return JSON.parse(localStorage.getItem(BASKET_KEY) || '[]');
  } catch (e) {
    console.error('readBasket parse error', e);
    return [];
  }
}

/*
 Helper: write basket
 */
function writeBasket(arr) {
  localStorage.setItem(BASKET_KEY, JSON.stringify(arr));
  // keep legacy for compatibility
  localStorage.setItem('basket', JSON.stringify(arr));
}

/*
 Add to basket: merges into existing item by key (name|country)
 price is optional (number or null). qty defaults to 1.
 */
function addToBasket(name, country, price = null, qty = 1) {
  const key = `${(name||'').trim()}|${(country||'').trim()}`;
  const cur = readBasket();
  const idx = cur.findIndex(i => i.key === key);
  if (idx >= 0) {
    cur[idx].qty = (cur[idx].qty || 0) + qty;
    // if new price provided and existing price missing, set it
    if (price != null && (!cur[idx].price || cur[idx].price === null)) cur[idx].price = Number(price);
  } else {
    cur.push({
      id: Date.now() + Math.random().toString(16).slice(2,8),
      key,
      name,
      country,
      qty,
      price: price != null ? Number(price) : null
    });
  }
  writeBasket(cur);
  if (document.body.contains(document.getElementById('basketItems'))) loadBasket();
}

/*
 Called from results Add button (prompt user for price)
 */
function addToBasketFromResult(name, country) {
  // ask user for price (optional)
  const p = prompt(`Enter price for "${name}" (leave blank if unknown):`, '');
  let price = null;
  if (p !== null && p.trim() !== '') {
    const parsed = Number(p.replace(/[^0-9.]/g, ''));
    if (!isNaN(parsed)) price = parsed;
  }
  addToBasket(name, country, price, 1);
  if (typeof showToast === 'function') showToast(`${name} added to basket`);
}

/*
 Called when user clicks "Switch / Add" on an alternative (we assume it's Indian)
 */
function addAlternativeToBasket(altName) {
  // prompt for price optionally
  const p = prompt(`Enter price for "${altName}" (leave blank if unknown):`, '');
  let price = null;
  if (p !== null && p.trim() !== '') {
    const parsed = Number(p.replace(/[^0-9.]/g, ''));
    if (!isNaN(parsed)) price = parsed;
  }
  addToBasket(altName, 'India', price, 1);
  if (typeof showToast === 'function') showToast(`${altName} added to basket`);
}

/*
 loadBasket: render basketItems div showing grouped rows with qty, +/- buttons,
 Edit Price, Remove (with confirmation). Also calls renderImpact()
 */
function loadBasket() {
  const basketItemsDiv = document.getElementById('basketItems');
  if (!basketItemsDiv) return;
  const basket = readBasket();

  if (!basket || basket.length === 0) {
    basketItemsDiv.innerHTML = '<div class="small">Your basket is empty. Add items from results.</div>';
    if (typeof clearChart === 'function') clearChart(); else {
      const impactTextEl = document.getElementById('impactText'); if (impactTextEl) impactTextEl.innerText = '';
    }
    return;
  }

  // build rows
  const html = basket.map((item, index) => {
    const isIndian = (item.country || '').toLowerCase().includes('india');
    const badge = isIndian
      ? '<span class="flag-badge indian" aria-label="Indian owned brand">Indian</span>'
      : '<span class="flag-badge foreign" aria-label="Foreign owned brand">Foreign</span>';
    const priceText = item.price != null ? `₹ ${Number(item.price).toFixed(2)}` : 'Price: N/A';
    return `
      <div class="basket-row card" data-index="${index}" style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px;padding:10px;">
        <div style="display:flex;align-items:center;gap:12px;flex:1;">
          <div style="flex:1">
            <div style="display:flex;align-items:center;gap:8px;">
              <strong>${escapeHtml(item.name)}</strong>
              ${badge}
              <span class="small" style="margin-left:6px;color:#666">(${escapeHtml(item.country||'')})</span>
            </div>
            <div class="small" style="margin-top:6px;color:#666">${priceText}</div>
          </div>
          <div style="display:flex;align-items:center;gap:8px;">
            <button class="btn btn-ghost small-btn" onclick="updateQuantity(${index},-1)">−</button>
            <div style="min-width:36px;text-align:center;font-weight:600">${item.qty}</div>
            <button class="btn btn-ghost small-btn" onclick="updateQuantity(${index},1)">+</button>
          </div>
        </div>

        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px;">
          <button class="btn btn-ghost small-btn" onclick="editPrice(${index})">Edit Price</button>
          <button class="btn btn-ghost" onclick="removeItem(${index})">Remove</button>
        </div>
      </div>
    `;
  }).join('');

  basketItemsDiv.innerHTML = html;
  renderImpact(basket);
}

/*
 update quantity by delta (positive or negative)
 if qty drops to 0, confirm remove.
 */
function updateQuantity(index, delta) {
  const cur = readBasket();
  if (!cur[index]) return;
  cur[index].qty = (cur[index].qty || 0) + delta;
  if (cur[index].qty <= 0) {
    const ok = confirm(`Remove "${cur[index].name}" from basket?`);
    if (!ok) {
      // restore to 1
      cur[index].qty = 1;
    } else {
      cur.splice(index,1);
    }
  }
  writeBasket(cur);
  loadBasket();
  if (typeof showToast === 'function') showToast('Basket updated');
}

/*
 edit price for an item: prompt user
 */
function editPrice(index) {
  const cur = readBasket();
  if (!cur[index]) return;
  const current = cur[index].price != null ? cur[index].price : '';
  const p = prompt(`Enter price for "${cur[index].name}":`, current);
  if (p === null) return; // canceled
  if (p.trim() === '') {
    cur[index].price = null;
  } else {
    const parsed = Number(p.replace(/[^0-9.]/g,''));
    if (!isNaN(parsed)) cur[index].price = parsed;
    else { alert('Invalid number'); return; }
  }
  writeBasket(cur);
  loadBasket();
  if (typeof showToast === 'function') showToast('Price updated');
}

/*
 remove item with confirmation
 */
function removeItem(index) {
  const cur = readBasket();
  if (!cur[index]) return;
  const ok = confirm(`Remove "${cur[index].name}" from basket?`);
  if (!ok) return;
  cur.splice(index,1);
  writeBasket(cur);
  loadBasket();
  if (typeof showToast === 'function') showToast('Item removed');
}

/*
 renderImpact now calculates monetary totals (uses price * qty where available)
 and shows counts as before.
 */
let chartInstance = null;
function renderImpact(basket) {
  // counts
  const indianCount = basket.filter(i => (i.country||'').toLowerCase().includes('india')).reduce((s,i)=>s+i.qty,0);
  const foreignCount = basket.reduce((s,i)=>s + (i.qty || 0),0) - indianCount;
  const totalCount = indianCount + foreignCount;
  const indianPct = totalCount === 0 ? 0 : Math.round((indianCount/totalCount)*10000)/100;

  // monetary totals (only where price defined)
  let indianAmount = 0, foreignAmount = 0;
  basket.forEach(i => {
    const val = (i.price != null && !isNaN(i.price)) ? (Number(i.price) * (i.qty||1)) : 0;
    if ((i.country||'').toLowerCase().includes('india')) indianAmount += val;
    else foreignAmount += val;
  });
  const totalAmount = indianAmount + foreignAmount;

  const impactTextEl = document.getElementById('impactText');
  if (impactTextEl) {
    const cntText = totalCount ? `Indian: ${indianCount} (${indianPct}%) — Foreign: ${foreignCount} (${Math.round(100 - indianPct)}%)` : '';
    const amtText = totalAmount ? `Total ₹${totalAmount.toFixed(2)} — India ₹${indianAmount.toFixed(2)}, Foreign ₹${foreignAmount.toFixed(2)}` : '';
    impactTextEl.innerText = [cntText, amtText].filter(Boolean).join(' — ');
  }

  // pie chart (uses counts)
  const ctx = document.getElementById('pieChart')?.getContext('2d');
  if (!ctx) return;
  if (chartInstance) chartInstance.destroy();
  chartInstance = new Chart(ctx, {
    type: 'pie',
    data: {
      labels: ['Indian', 'Foreign'],
      datasets: [{ data: [indianCount, foreignCount], backgroundColor: ['#138808', '#FF9933'] }]
    },
    options: { responsive: true, maintainAspectRatio: true, plugins: { legend: { position: 'bottom' } } }
  });
}

/* end of basket block */

/* ------------- Pie / Impact chart (Chart.js required on basket page) ------------- */
let chartInstance = null;

function clearChart() {
  if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
  const ctx = document.getElementById('pieChart')?.getContext('2d');
  if (ctx) { ctx.clearRect(0, 0, 220, 220); }
  const impactTextEl = document.getElementById('impactText');
  if (impactTextEl) impactTextEl.innerText = '';
}

function renderImpact(basket) {
  const indianCount = basket.filter(i => (i.country || '').toString().toLowerCase().includes('india')).length;
  const foreignCount = basket.length - indianCount;
  const total = basket.length;
  const indianPct = total === 0 ? 0 : Math.round((indianCount / total) * 10000) / 100;
  const foreignPct = Math.round((100 - indianPct) * 100) / 100;
  const text = `Indian: ${indianCount} (${indianPct}%) — Foreign: ${foreignCount} (${foreignPct}%)`;
  const impactTextEl = document.getElementById('impactText');
  if (impactTextEl) impactTextEl.innerText = text;

  const ctx = document.getElementById('pieChart')?.getContext('2d');
  if (!ctx) return;
  if (chartInstance) chartInstance.destroy();
  chartInstance = new Chart(ctx, {
    type: 'pie',
    data: {
      labels: ['Indian', 'Foreign'],
      datasets: [{ data: [indianCount, foreignCount], backgroundColor: ['#138808', '#FF9933'] }]
    },
    options: { responsive: true, maintainAspectRatio: true, plugins: { legend: { position: 'bottom' } } }
  });
}

/* ------------- Small UI helpers ------------- */
function showToast(msg) {
  const t = document.createElement('div');
  t.innerText = msg;
  t.style.position = 'fixed';
  t.style.right = '18px';
  t.style.bottom = '18px';
  t.style.padding = '10px 14px';
  t.style.background = '#111';
  t.style.color = '#fff';
  t.style.borderRadius = '10px';
  t.style.boxShadow = '0 6px 18px rgba(0,0,0,0.2)';
  t.style.zIndex = 9999;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2000);
}

function escapeHtml(s) {
  return (s + '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeJS(s) {
  return (s + '').replace(/'/g, "\\'").replace(/"/g, '\\"');
}

/* ------------- Auto-init hooks ------------- */
if (document.body.contains(document.getElementById('basketItems'))) {
  // If basket UI is present, load it (and Chart.js should be included on that page)
  loadBasket();
}

// Export functions to window so inline onclick handlers work
window.searchAndShow = searchAndShow;
window.addToBasket = addToBasket;
window.addToBasketFromResult = addToBasketFromResult;
window.addAlternativeToBasket = addAlternativeToBasket;
