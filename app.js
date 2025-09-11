// app.js - drop this in (replace previous app.js)
// Make sure you have set AIRTABLE_TOKEN and BASE_ID (or used Netlify function).
// This version expects your fetchProductsOnce() to return objects with fields:
// ProductID, ProductName, Brand, ParentCompany, ParentCountry, Alternative1/2/3

const AIRTABLE_TOKEN = "YOUR_PERSONAL_ACCESS_TOKEN"; // if using client-side (temporary)
const BASE_ID = "YOUR_BASE_ID";                        // if using client-side (temporary)
const USE_NETLIFY_FUNCTION = true; // set true if you use /.netlify/functions/getProducts

const TABLE_NAME = "Products";
let _productsCache = null;

/* -------------------------
   Data fetching abstraction
   ------------------------- */
async function fetchProductsOnce() {
  if (_productsCache) return _productsCache;

  if (USE_NETLIFY_FUNCTION) {
    // Call your Netlify Function which hides the PAT
    const endpoint = '/.netlify/functions/getProducts';
    const res = await fetch(endpoint);
    if (!res.ok) {
      throw new Error('Function fetch failed: ' + res.status);
    }
    const json = await res.json();
    // function returns { records: [ ... ] }
    _productsCache = (json.records || []).map(r => r);
    return _productsCache;
  } else {
    // Direct Airtable fetch (not recommended for production; token visible in client)
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

/* -------------------------
   Search + rendering
   ------------------------- */
async function searchAndShow(q) {
  const resultsList = document.getElementById('resultsList');
  if (!resultsList) return;
  resultsList.innerHTML = '<div class="small">Searching…</div>';

  try {
    const all = await fetchProductsOnce();
    const ql = (q || '').toString().toLowerCase().trim();

    // Match product name, brand, and alternatives
    const results = all.filter(p => {
      const item = p.fields ? p.fields : p; // normalize shapes
      const name = (item.ProductName || item.ProductID || '').toString().toLowerCase();
      const brand = (item.Brand || '').toString().toLowerCase();
      const alt1 = (item.Alternative1 || '').toString().toLowerCase();
      const alt2 = (item.Alternative2 || '').toString().toLowerCase();
      const alt3 = (item.Alternative3 || '').toString().toLowerCase();

      // If query is empty, show all (or you can return [] to require a query)
      if (!ql) return true;

      return name.includes(ql)
        || brand.includes(ql)
        || alt1.includes(ql)
        || alt2.includes(ql)
        || alt3.includes(ql);
    });

    renderResults(results);
  } catch (err) {
    resultsList.innerHTML = `<div class="small">Error fetching data: ${escapeHtml(err.message || err)}</div>`;
    console.error(err);
  }
}
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

    let altHtml = '';
    if (alts.length) {
      altHtml = '<div style="margin-top:8px"><strong>Alternatives:</strong><div style="margin-top:6px">';
      alts.forEach((a) => {
        const safeA = escapeJS(a);
        altHtml += `<div style="margin-top:6px; display:inline-block; margin-right:8px;">
                      <span>${escapeHtml(a)}</span>
                      <button class="btn btn-ghost" style="margin-left:8px;padding:6px 10px;border-radius:8px" onclick="addAlternativeToBasket('${safeA}')">Switch / Add</button>
                    </div>`;
      });
      altHtml += '</div></div>';
    } else {
      altHtml = `<div style="margin-top:8px;color:#666">No alternatives listed</div>`;
    }

    const isIndian = (country || '').toString().toLowerCase().includes('india');
    const badgeHtml = isIndian ? '<span class="flag-badge">Indian</span>' : '<span class="flag-badge">Foreign</span>';

    const safeName = escapeJS(name);
    const safeCountry = escapeJS(country);

    const imgHtml = imageUrl ? `<img src="${imageUrl}" alt="${escapeHtml(name)}" class="product-thumb">` : '';

    const html = `
      <div class="result-row" style="margin-bottom:10px;">
        <div class="result-left">
          <div style="display:flex;align-items:center;gap:12px;">
            ${imgHtml}
            <div>
              <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
                <h3 style="margin:0;">${escapeHtml(name)}</h3>
                ${badgeHtml}
                <button class="btn btn-ghost small-btn" style="padding:6px 10px;border-radius:8px" onclick="addToBasketFromResult('${safeName}', '${safeCountry}')">Add</button>
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
/* -------------------------
   Basket helpers
   ------------------------- */
function addToBasketFromResult(name, country) {
  addToBasket(name, country);
  // Visual feedback (toast style)
  showToast(`${name} added to basket`);
}

function addToBasket(name, country) {
  const cur = JSON.parse(localStorage.getItem('basket') || '[]');
  cur.push({ name, country });
  localStorage.setItem('basket', JSON.stringify(cur));
  // Update basket UI if on basket page:
  if (document.body.contains(document.getElementById('basketItems'))) loadBasket();
}

function loadBasket() {
  const basketItemsDiv = document.getElementById('basketItems');
  if (!basketItemsDiv) return;
  const basket = JSON.parse(localStorage.getItem('basket') || '[]');
  if (basket.length === 0) {
    basketItemsDiv.innerHTML = '<div class="small">Your basket is empty. Add items from results.</div>';
    clearChart();
    return;
  }
  basketItemsDiv.innerHTML = basket.map(i => `<div style="padding:6px 0"><strong>${escapeHtml(i.name)}</strong> <span class="small">(${escapeHtml(i.country||'')})</span></div>`).join('');
  renderImpact(basket);
}

// Add an alternative (assume Indian ownership) to basket
function addAlternativeToBasket(altName) {
  // country set to "India" for alternatives — change if your Airtable has explicit alt country
  addToBasket(altName, 'India');
  showToast(`${altName} added to basket (Indian alternative)`);
}

/* -------------------------
   Pie / Impact chart (Chart.js)
   ------------------------- */
let chartInstance = null;
function clearChart() {
  if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
  const ctx = document.getElementById('pieChart')?.getContext('2d');
  if (ctx) { ctx.clearRect(0, 0, 220, 220); document.getElementById('impactText').innerText = ''; }
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
  if (chartInstance) { chartInstance.destroy(); }
  chartInstance = new Chart(ctx, {
    type: 'pie',
    data: { labels: ['Indian', 'Foreign'], datasets: [{ data: [indianCount, foreignCount], backgroundColor: ['#138808', '#FF9933'] }] },
    options: { responsive: true, maintainAspectRatio: true, plugins: { legend: { position: 'bottom' } } }
  });
}

/* -------------------------
   Small UI helpers
   ------------------------- */
function showToast(msg) {
  // very small temporary toast
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
  setTimeout(() => t.remove(), 2200);
}

function escapeHtml(s) {
  return (s + '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeJS(s) {
  return (s + '').replace(/'/g, "\\'").replace(/"/g, '\\"');
}

/* -------------------------
   Auto-load hooks
   ------------------------- */
// If results.html included ?q=... it will call searchAndShow via its small script.
// If basket.html contains basketItems, load them:
if (document.body.contains(document.getElementById('basketItems'))) {
  // If Chart.js is not yet loaded, ensure it exists
  // Chart.js script is already added in basket.html head in previous bundle
  loadBasket();
}

// expose functions for pages
window.searchAndShow = searchAndShow;
window.addToBasket = addToBasket;
