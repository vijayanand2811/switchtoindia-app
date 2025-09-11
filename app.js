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

    // stacked alternative rows
    let altHtml = '';
    if (alts.length) {
      altHtml = '<div class="alt-list" style="margin-top:10px">';
      alts.forEach((a) => {
        const safeA = escapeJS(a);
        altHtml += `
          <div class="alt-item">
            <div class="alt-name">${escapeHtml(a)}</div>
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
    const badgeHtml = isIndian ? '<span class="flag-badge">Indian</span>' : '<span class="flag-badge">Foreign</span>';

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
              <div class="small" style="margin-top:6px;"><strong>Brand:</strong> ${escapeHtml(brand)} &nbsp; <strong>Parent:</strong> ${escapeHtml(parent)} — ${escapeHtml(country)}</div>
            </div>
          </div>

          ${altHtml}
        </div>
      </div>
    `;
    container.insertAdjacentHTML('beforeend', html);
  });
}

/* ------------- Basket helpers (persistent) ------------- */
const BASKET_KEY = 'stindiabasket_v1';

function addToBasketFromResult(name, country) {
  addToBasket(name, country);
  showToast(`${name} added to basket`);
}

function addToBasket(name, country) {
  const cur = JSON.parse(localStorage.getItem(BASKET_KEY) || '[]');
  cur.push({ name, country, addedAt: new Date().toISOString() });
  localStorage.setItem(BASKET_KEY, JSON.stringify(cur));
  // maintain legacy 'basket' key too
  localStorage.setItem('basket', JSON.stringify(cur));
  if (document.body.contains(document.getElementById('basketItems'))) loadBasket();
}

function loadBasket() {
  const basketItemsDiv = document.getElementById('basketItems');
  if (!basketItemsDiv) return;
  const basket = JSON.parse(localStorage.getItem(BASKET_KEY) || '[]');
  if (basket.length === 0) {
    basketItemsDiv.innerHTML = '<div class="small">Your basket is empty. Add items from results.</div>';
    clearChart();
    return;
  }
  basketItemsDiv.innerHTML = basket.map(i => `<div style="padding:6px 0"><strong>${escapeHtml(i.name)}</strong> <span class="small">(${escapeHtml(i.country||'')})</span></div>`).join('');
  renderImpact(basket);
}

/* add alternative (assumed Indian) */
function addAlternativeToBasket(altName) {
  addToBasket(altName, 'India');
  showToast(`${altName} added to basket (Indian alternative)`);
}

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
