/* app.js — SwitchToIndia full client JS
   - Fetches products via /.netlify/functions/getProducts by default
   - Provides search, renderResults, basket grouping + qty + price, pie chart
   - Lightweight, defensive, and exports functions to window for inline handlers
*/

/* -------- Configuration -------- */
const USE_NETLIFY_FUNCTION = true; // set false to fetch Airtable directly (not recommended)
const NETLIFY_FUNCTION_ENDPOINT = '/.netlify/functions/getProducts';
const BASKET_KEY = 'stindiabasket_v1';

/* -------- Utilities -------- */
function escapeHtml(s){ return (s+'').replace(/[&<>"']/g,c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
function escapeJS(s){ return (s+'').replace(/'/g,"\\'").replace(/"/g,'\\"'); }
function showToast(msg){
  try {
    const t = document.createElement('div');
    t.innerText = msg;
    t.style.position='fixed'; t.style.right='18px'; t.style.bottom='18px';
    t.style.padding='10px 14px'; t.style.background='#111'; t.style.color='#fff';
    t.style.borderRadius='10px'; t.style.boxShadow='0 6px 18px rgba(0,0,0,0.18)';
    t.style.zIndex=99999;
    document.body.appendChild(t);
    setTimeout(()=>t.remove(),2000);
  } catch(e){ console.warn('showToast failed', e); }
}

/* -------- Data fetch -------- */
let _productsCache = null;
async function fetchProductsOnce(){
  if (_productsCache) return _productsCache;

  if (USE_NETLIFY_FUNCTION) {
    try {
      const res = await fetch(NETLIFY_FUNCTION_ENDPOINT);
      if (!res.ok) {
        const txt = await res.text().catch(()=>'<no body>');
        throw new Error(`Function returned ${res.status}: ${txt}`);
      }
      const json = await res.json();
      // accept either {records:[{fields:{...}}]} or simple array
      const records = json.records ? json.records : (Array.isArray(json) ? json : []);
      _productsCache = records.map(r => r.fields ? r.fields : r);
      return _productsCache;
    } catch (e) {
      console.error('Netlify function fetch failed:', e);
      // fallback to empty list
      _productsCache = [];
      return _productsCache;
    }
  } else {
    // If you ever enable direct Airtable fetch, implement here.
    _productsCache = [];
    return _productsCache;
  }
}

/* -------- Search + render pipeline -------- */
async function searchAndShow(q) {
  const container = document.getElementById('resultsList');
  if (!container) return;
  container.innerHTML = '<div class="small">Searching…</div>';

  try {
    const all = await fetchProductsOnce();
    const ql = (q||'').toString().toLowerCase().trim();
    const results = all.filter(item => {
      const name = (item.ProductName||item.ProductID||'').toString().toLowerCase();
      const brand = (item.Brand||'').toString().toLowerCase();
      const alt1 = (item.Alternative1||'').toString().toLowerCase();
      const alt2 = (item.Alternative2||'').toString().toLowerCase();
      const alt3 = (item.Alternative3||'').toString().toLowerCase();
      if (!ql) return true;
      return name.includes(ql) || brand.includes(ql) || alt1.includes(ql) || alt2.includes(ql) || alt3.includes(ql);
    });
    renderResults(results);
  } catch (err) {
    console.error('searchAndShow error', err);
    container.innerHTML = `<div class="small">Error loading data. See console.</div>`;
  }
}

/* renderResults: displays product card + stacked alternatives */
function renderResults(results) {
  const container = document.getElementById('resultsList');
  const no = document.getElementById('noResults');
  if (!container) return;
  container.innerHTML = '';

  if (!results || results.length === 0) {
    if (no) no.style.display = 'block';
    else container.innerHTML = '<div class="small">No results</div>';
    return;
  } else if (no) {
    no.style.display = 'none';
  }

  results.forEach(item => {
    const name = item.ProductName || item.ProductID || 'Unnamed product';
    const brand = item.Brand || '';
    const parent = item.ParentCompany || '';
    const country = item.ParentCountry || '';
    const imageUrl = item.ImageURL || '';

    const alts = [];
    if (item.Alternative1) alts.push(item.Alternative1);
    if (item.Alternative2) alts.push(item.Alternative2);
    if (item.Alternative3) alts.push(item.Alternative3);

    const isIndianParent = (country||'').toString().toLowerCase().includes('india');
    const badgeHtml = isIndianParent
      ? '<span class="flag-badge indian" aria-label="Indian owned brand">Indian</span>'
      : '<span class="flag-badge foreign" aria-label="Foreign owned brand">Foreign</span>';

    const imgHtml = imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(name)}" class="product-thumb">` : '';

    let altHtml = '';
    if (alts.length) {
      altHtml += '<div class="alt-list">';
      altHtml += '<div style="margin-bottom:8px;font-weight:700;color:#333">Alternatives:</div>';
      alts.forEach(a => {
        const safeA = escapeJS(a);
        // assume alternatives are Indian — show green badge next to them
        altHtml += `
          <div class="alt-item">
            <div class="alt-name">${escapeHtml(a)} <span class="flag-badge indian" aria-label="Indian owned brand">Indian</span></div>
            <div class="alt-action">
              <button class="btn btn-ghost small-btn" onclick="addAlternativeToBasket('${safeA}')">Switch / Add</button>
            </div>
          </div>`;
      });
      altHtml += '</div>';
    }

    const safeName = escapeJS(name);
    const safeCountry = escapeJS(country);

    const html = `
      <div class="result-row card" style="margin-bottom:12px;">
        <div class="result-left">
          <div style="display:flex;align-items:center;gap:12px;">
            ${imgHtml}
            <div style="flex:1">
              <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
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

/* -------- Basket helpers (grouped, qty, price) -------- */
function readBasket(){
  try { return JSON.parse(localStorage.getItem(BASKET_KEY) || '[]'); } catch(e){ console.error(e); return []; }
}
function writeBasket(arr){ localStorage.setItem(BASKET_KEY, JSON.stringify(arr)); localStorage.setItem('basket', JSON.stringify(arr)); }

/* addToBasket: name, country, price (number|null), qty */
function addToBasket(name, country, price = null, qty = 1) {
  const key = `${(name||'').trim()}|${(country||'').trim()}`;
  const cur = readBasket();
  const idx = cur.findIndex(i => i.key === key);
  if (idx >= 0) {
    cur[idx].qty = (cur[idx].qty || 0) + qty;
    if (price != null && (!cur[idx].price || cur[idx].price == null)) cur[idx].price = Number(price);
  } else {
    cur.push({ id: Date.now() + Math.random().toString(16).slice(2,8), key, name, country, qty, price: price != null ? Number(price) : null });
  }
  writeBasket(cur);
  if (document.body.contains(document.getElementById('basketItems'))) loadBasket();
}

/* Add from results (asks for optional price) */
function addToBasketFromResult(name, country) {
  const p = prompt(`Enter price for "${name}" (leave blank if unknown):`, '');
  let price = null;
  if (p !== null && p.trim() !== '') {
    const parsed = Number(p.replace(/[^0-9.]/g,''));
    if (!isNaN(parsed)) price = parsed;
  }
  addToBasket(name, country, price, 1);
  showToast(`${name} added to basket`);
}

/* Add alternative (assume Indian) */
function addAlternativeToBasket(altName) {
  const p = prompt(`Enter price for "${altName}" (leave blank if unknown):`, '');
  let price = null;
  if (p !== null && p.trim() !== '') {
    const parsed = Number(p.replace(/[^0-9.]/g,''));
    if (!isNaN(parsed)) price = parsed;
  }
  addToBasket(altName, 'India', price, 1);
  showToast(`${altName} added to basket`);
}

/* loadBasket: render grouped view with qty, edit, remove */
let chartInstance = null;
function loadBasket() {
  const basketItemsDiv = document.getElementById('basketItems');
  if (!basketItemsDiv) return;
  const basket = readBasket();
  if (!basket || basket.length === 0) {
    basketItemsDiv.innerHTML = '<div class="small">Your basket is empty. Add items from results.</div>';
    if (typeof clearChart === 'function') clearChart();
    else { const it = document.getElementById('impactText'); if (it) it.innerText = ''; }
    return;
  }

  const html = basket.map((item, index) => {
    const isIndian = (item.country||'').toString().toLowerCase().includes('india');
    const badge = isIndian ? '<span class="flag-badge indian" aria-label="Indian owned brand">Indian</span>' : '<span class="flag-badge foreign" aria-label="Foreign owned brand">Foreign</span>';
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

/* updateQuantity */
function updateQuantity(index, delta) {
  const cur = readBasket();
  if (!cur[index]) return;
  cur[index].qty = (cur[index].qty || 0) + delta;
  if (cur[index].qty <= 0) {
    const ok = confirm(`Remove "${cur[index].name}" from basket?`);
    if (!ok) { cur[index].qty = 1; }
    else { cur.splice(index,1); }
  }
  writeBasket(cur);
  loadBasket();
  showToast('Basket updated');
}

/* editPrice */
function editPrice(index) {
  const cur = readBasket();
  if (!cur[index]) return;
  const current = cur[index].price != null ? cur[index].price : '';
  const p = prompt(`Enter price for "${cur[index].name}":`, current);
  if (p === null) return;
  if (p.trim() === '') { cur[index].price = null; }
  else {
    const parsed = Number(p.replace(/[^0-9.]/g,''));
    if (!isNaN(parsed)) cur[index].price = parsed;
    else { alert('Invalid number'); return; }
  }
  writeBasket(cur);
  loadBasket();
  showToast('Price updated');
}

/* removeItem */
function removeItem(index) {
  const cur = readBasket();
  if (!cur[index]) return;
  const ok = confirm(`Remove "${cur[index].name}" from basket?`);
  if (!ok) return;
  cur.splice(index,1);
  writeBasket(cur);
  loadBasket();
  showToast('Item removed');
}

/* clearChart (if used elsewhere) */
function clearChart() {
  if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
  const ctx = document.getElementById('pieChart')?.getContext('2d');
  if (ctx) ctx.clearRect(0,0,220,220);
  const impactTextEl = document.getElementById('impactText');
  if (impactTextEl) impactTextEl.innerText = '';
}

/* renderImpact (counts + monetary totals) */
function renderImpact(basket) {
  const indianCount = basket.filter(i => (i.country||'').toLowerCase().includes('india')).reduce((s,i)=>s+(i.qty||0),0);
  const foreignCount = basket.reduce((s,i)=>s+(i.qty||0),0) - indianCount;
  const totalCount = indianCount + foreignCount;
  const indianPct = totalCount === 0 ? 0 : Math.round((indianCount/totalCount)*10000)/100;

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

/* -------- Init on load (populate search box if query param present) -------- */
window.addEventListener('DOMContentLoaded', function(){
  // wire up initial search param on results page
  const initial = new URL(window.location.href).searchParams.get('q') || '';
  if (initial && document.body.contains(document.getElementById('resultsList'))) {
    const sb = document.getElementById('searchBox');
    const sbh = document.getElementById('searchBoxHero');
    if (sb) sb.value = initial;
    if (sbh) sbh.value = initial;
    searchAndShow(initial);
  }
  // load basket if present
  if (document.body.contains(document.getElementById('basketItems'))) {
    loadBasket();
  }
});


/* --- Onboarding tooltip (robust) --- */
function showOnboardingTooltipOnce() {
  try {
    if (localStorage.getItem('seen_badge_tooltip_v1')) return;
    // ensure CSS present (inject if missing)
    if (!document.querySelector('style[data-switchtoindia-tooltip]')) {
      const s = document.createElement('style');
      s.setAttribute('data-switchtoindia-tooltip','1');
      s.innerText = `
        .tooltip-overlay{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);display:flex;justify-content:center;align-items:center;z-index:9999}
        .tooltip-box{background:#fff;border-radius:12px;padding:20px;max-width:360px;text-align:center;box-shadow:0 8px 30px rgba(0,0,0,0.25)}
        .tooltip-box h3{margin-top:0;margin-bottom:10px}
        .tooltip-badges{display:flex;justify-content:center;gap:12px;margin:12px 0}
        .flag-badge.indian{background:#138808;color:#fff;padding:6px 10px;border-radius:6px}
        .flag-badge.foreign{background:#d9534f;color:#fff;padding:6px 10px;border-radius:6px}
        .tooltip-box button{margin-top:12px}
      `;
      document.head.appendChild(s);
    }

    // wait one paint + small timeout so home content is available
    requestAnimationFrame(() => {
      setTimeout(() => {
        const isHomeSelector = !!document.querySelector('.hero');
        const isResultsSelector = !!document.getElementById('resultsList')
                                  || !!document.querySelector('.results-grid')
                                  || !!document.querySelector('.results')
                                  || !!document.querySelector('.result-row')
                                  || location.pathname.toLowerCase().includes('results');
        const isHomePath = location.pathname === '/' || location.pathname.toLowerCase().endsWith('/index.html');
        const shouldShow = isHomeSelector || isHomePath || isResultsSelector;
        if (!shouldShow) return;
        const overlay = document.createElement('div');
        overlay.className = 'tooltip-overlay';
        overlay.innerHTML = `
          <div class="tooltip-box" role="dialog" aria-labelledby="tooltipTitle" aria-describedby="tooltipDesc">
            <h3 id="tooltipTitle">Understand the Badges</h3>
            <p id="tooltipDesc">Badges help you see brand ownership at a glance:</p>
            <div class="tooltip-badges">
              <span class="flag-badge indian" aria-label="Indian owned brand">Indian</span>
              <span class="flag-badge foreign" aria-label="Foreign owned brand">Foreign</span>
            </div>
            <p class="small">Switch to Indian alternatives to support local businesses.</p>
            <button class="btn btn-primary" id="tooltipClose">Got it</button>
          </div>`;
        document.body.appendChild(overlay);
        document.getElementById('tooltipClose').addEventListener('click', () => {
          overlay.remove();
          localStorage.setItem('seen_badge_tooltip_v1', 'yes');
        });
      }, 200);
    });
  } catch (e) {
    console.error('showOnboardingTooltipOnce error', e);
  }
}
window.addEventListener('DOMContentLoaded', showOnboardingTooltipOnce);


/* expose functions to window for inline onclick handlers */
window.fetchProductsOnce = fetchProductsOnce;
window.searchAndShow = searchAndShow;
window.renderResults = renderResults;
window.addToBasket = addToBasket;
window.addToBasketFromResult = addToBasketFromResult;
window.addAlternativeToBasket = addAlternativeToBasket;
window.loadBasket = loadBasket;
window.updateQuantity = updateQuantity;
window.editPrice = editPrice;
window.removeItem = removeItem;
window.clearChart = clearChart;
window.showToast = showToast;
