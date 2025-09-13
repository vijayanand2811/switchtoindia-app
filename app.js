/* app.js — SwitchToIndia full client JS
   Single-file replacement. Paste over your current app.js.
*/

/* -------- Configuration -------- */
const USE_NETLIFY_FUNCTION = true; // set false to fetch Airtable directly (not recommended)
const NETLIFY_FUNCTION_ENDPOINT = '/.netlify/functions/getProducts';
const BASKET_KEY = 'stindiabasket_v1';

/* -------- Utilities -------- */
function escapeHtml(s){ return (s+'').replace(/[&<>"']/g,c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
function escapeJS(s){ return (s+'').replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/"/g,'\\"'); }
function showToast(msg){
  try {
    const t = document.createElement('div');
    t.innerText = msg;
    t.style.position='fixed'; t.style.right='18px'; t.style.bottom='18px';
    t.style.padding='10px 14px'; t.style.background='#111'; t.style.color='#fff';
    t.style.borderRadius='10px'; t.style.boxShadow='0 6px 18px rgba(0,0,0,0.18)';
    t.style.zIndex=99999;
    document.body.appendChild(t);
    setTimeout(()=>{ try{ t.remove(); }catch(e){} },2000);
  } catch(e){ console.warn('showToast failed', e); }
}

/* safe conversion of Airtable fields to string for comparisons */
function fieldToString(v){
  if (v == null) return '';
  if (Array.isArray(v)) return v.map(x => typeof x === 'string' ? x : (x && x.name ? x.name : String(x))).join(', ');
  if (typeof v === 'object') {
    // Airtable sometimes returns objects for linked records or select options
    if (v.name) return String(v.name);
    return JSON.stringify(v);
  }
  return String(v);
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
      const records = json && json.records ? json.records : (Array.isArray(json) ? json : []);
      _productsCache = records.map(r => r && r.fields ? r.fields : r || {});
      return _productsCache;
    } catch (e) {
      console.error('Netlify function fetch failed:', e);
      _productsCache = [];
      return _productsCache;
    }
  } else {
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
      const name = fieldToString(item.ProductName || item.ProductID || '').toLowerCase();
      const brand = fieldToString(item.Brand || '').toLowerCase();
      const alt1 = fieldToString(item.Alternative1 || '').toLowerCase();
      const alt2 = fieldToString(item.Alternative2 || '').toLowerCase();
      const alt3 = fieldToString(item.Alternative3 || '').toLowerCase();
      if (!ql) return true;
      return name.includes(ql) || brand.includes(ql) || alt1.includes(ql) || alt2.includes(ql) || alt3.includes(ql);
    });
    renderResults(results);
  } catch (err) {
    console.error('searchAndShow error', err);
    container.innerHTML = `<div class="small">Error loading data. See console.</div>`;
  }
}

/* -------- Alternative selection (scoring) -------- */
function pickAltObjects(item, rawAltNames) {
  const normalize = s => fieldToString(s).trim();
  const nLower = s => normalize(s).toLowerCase();

  if (!window._prodMap) {
    window._prodMap = {};
    const list = (_productsCache || []);
    list.forEach(p => {
      const name = nLower(p.ProductName || '');
      const id = nLower(p.ProductID || '');
      const brand = nLower(p.Brand || '');
      if (name) window._prodMap[name] = p;
      if (id) window._prodMap[id] = p;
      if (brand && name) window._prodMap[`${brand}:::${name}`] = p;
    });
  }

  const itemCat = nLower(item.Category || '');
  const itemSub = nLower(item.Subcategory || '');
  const itemAttrs = nLower(item.Attributes || '');

  const isFssaiTrue = rec => {
    const v = rec && (rec.FSSAI_Licensed ?? rec.FSSAI || rec.FSSAI_Licensed === true);
    if (v === true || v === false) return !!v;
    if (typeof v === 'string') return ['yes','y','true','1'].includes((v+'').trim().toLowerCase());
    return Boolean(v);
  };

  const candidates = (rawAltNames||[]).map(n => {
    if (!n) return null;
    const key = nLower(n);
    if (window._prodMap[key]) return window._prodMap[key];
    const fallback = (_productsCache||[]).find(p => (fieldToString(p.ProductName)||'').toLowerCase().includes(key));
    if (fallback) return fallback;
    return { ProductName: String(n).trim(), ProductID:'', Brand:'', ParentCompany:'', ParentCountry:'', Category:'', Subcategory:'', Attributes:'', Ownership:'', FSSAI_Licensed:false };
  }).filter(Boolean);

  const scored = candidates.map(alt => {
    const cat = nLower(alt.Category || '');
    const sub = nLower(alt.Subcategory || '');
    const attrs = nLower(alt.Attributes || '');
    const isIndian = ((fieldToString(alt.Ownership)||'').toLowerCase().includes('india')) || ((fieldToString(alt.ParentCountry)||'').toLowerCase().includes('india'));
    const fssai = isFssaiTrue(alt);

    let score = 0;
    if (sub && itemSub && sub === itemSub) score += 300;
    if (cat && itemCat && cat === itemCat) score += 80;
    if (itemAttrs && attrs) {
      const as = itemAttrs.split(',').map(x=>x.trim()).filter(Boolean);
      const bs = attrs.split(',').map(x=>x.trim()).filter(Boolean);
      if (as.length && bs.length && as.some(x=>bs.includes(x))) score += 30;
    }
    if (isIndian) score += 60;
    if (fssai) score += 20;
    const altName = (fieldToString(alt.ProductName)||'').toLowerCase();
    if (altName && rawAltNames.join(' ').toLowerCase().includes(altName)) score += 6;
    return { alt, score };
  });

  scored.sort((a,b) => b.score - a.score);
  return scored.map(s => s.alt).slice(0,3);
}

/* -------- renderResults: displays product + alternatives -------- */
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
    const name = fieldToString(item.ProductName || item.ProductID || 'Unnamed product');
    const brand = fieldToString(item.Brand || '');
    const parent = fieldToString(item.ParentCompany || '');
    const country = fieldToString(item.ParentCountry || '');
    const imageUrl = fieldToString(item.ImageURL || '');

    const rawAlts = [];
    if (item.Alternative1) rawAlts.push(fieldToString(item.Alternative1));
    if (item.Alternative2) rawAlts.push(fieldToString(item.Alternative2));
    if (item.Alternative3) rawAlts.push(fieldToString(item.Alternative3));

    const alts = pickAltObjects(item, rawAlts || []);

    const isIndianParent = (country||'').toString().toLowerCase().includes('india');
    const badgeHtml = isIndianParent
      ? '<span class="flag-badge indian" aria-label="Indian owned brand">Indian</span>'
      : '<span class="flag-badge foreign" aria-label="Foreign owned brand">Foreign</span>';

    const imgHtml = imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(name)}" class="product-thumb">` : '';

    let altHtml = '';
    if (alts && alts.length) {
      altHtml += '<div class="alt-list">';
      altHtml += '<div style="margin-bottom:8px;font-weight:700;color:#333">Alternatives:</div>';
      alts.forEach(altObj => {
        if (!altObj) return;
        const altName = fieldToString(altObj.ProductName || altObj.Brand || '');
        const altCountry = fieldToString(altObj.ParentCountry || '');
        const safeA = escapeJS(altName);
        const isAltIndian = (fieldToString(altObj.Ownership||'')).toLowerCase().includes('india') || (altCountry||'').toLowerCase().includes('india');
        const altBadge = isAltIndian ? '<span class="flag-badge indian" aria-label="Indian owned brand">Indian</span>' : '<span class="flag-badge foreign" aria-label="Foreign owned brand">Foreign</span>';
        altHtml += `
          <div class="alt-item" style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;">
            <div class="alt-name">${escapeHtml(altName)} ${altBadge}</div>
            <div class="alt-action"><button class="btn btn-ghost small-btn" onclick="addAlternativeToBasket('${safeA}')">Switch / Add</button></div>
          </div>`;
      });
      altHtml += '</div>';
    } else {
      const raw = rawAlts || [];
      if (raw.length) {
        altHtml += '<div class="alt-list"><div style="font-weight:700;color:#333;margin-bottom:8px">Alternatives (unverified):</div>';
        raw.forEach(a => {
          const safeA = escapeJS(a);
          altHtml += `<div class="alt-item" style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;">
            <div class="alt-name">${escapeHtml(a)} <span class="flag-badge foreign" aria-label="Unverified">Unverified</span></div>
            <div class="alt-action"><button class="btn btn-ghost small-btn" onclick="addAlternativeToBasket('${safeA}')">Add</button></div>
          </div>`;
        });
        altHtml += '</div>';
      }
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
function writeBasket(arr){ localStorage.setItem(BASKET_KEY, JSON.stringify(arr)); localStorage.setItem('basket', JSON.stringify(arr)); if (typeof updateBasketCount === 'function') updateBasketCount(); }

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

function updateBasketCount() {
  try {
    const count = readBasket().reduce((s,i)=>s + (i.qty || 0), 0);
    const el = document.getElementById('basketCount');
    if (!el) return;
    const prev = Number(el.innerText || 0);
    el.innerText = String(count);
    if (count > 0) {
      el.style.display = 'inline-block';
      el.setAttribute('aria-label', `${count} items in basket`);
      if (count > prev) { el.classList.add('pop'); setTimeout(()=>el.classList.remove('pop'),350); }
    } else {
      el.style.display = 'none';
      el.removeAttribute('aria-label');
    }
  } catch (e) {
    console.error('updateBasketCount error', e);
  }
}

function addToBasketFromResult(name, country) {
  addToBasket(name, country, null, 1);
  showToast(`${name} added to basket. You can set price in Basket.`);
}

function addAlternativeToBasket(altName) {
  addToBasket(altName, 'India', null, 1);
  showToast(`${altName} added to basket. You can set price in Basket.`);
}

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

function clearChart() {
  if (chartInstance) { try{ chartInstance.destroy(); }catch(e){} chartInstance = null; }
  const ctx = document.getElementById('pieChart')?.getContext('2d');
  if (ctx) ctx.clearRect(0,0,220,220);
  const impactTextEl = document.getElementById('impactText');
  if (impactTextEl) impactTextEl.innerText = '';
}

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
  if (chartInstance) try{ chartInstance.destroy(); }catch(e){}
  chartInstance = new Chart(ctx, {
    type: 'pie',
    data: {
      labels: ['Indian', 'Foreign'],
      datasets: [{ data: [indianCount, foreignCount], backgroundColor: ['#138808', '#FF9933'] }]
    },
    options: { responsive: true, maintainAspectRatio: true, plugins: { legend: { position: 'bottom' } } }
  });
}

function clearBasket(){
  try {
    localStorage.removeItem(BASKET_KEY);
    localStorage.removeItem('basket');
    if (typeof loadBasket === 'function') loadBasket();
    if (typeof clearChart === 'function') clearChart();
    if (typeof updateBasketCount === 'function') updateBasketCount();
    showToast('Basket cleared');
  } catch (e) {
    console.error('clearBasket error', e);
    alert('Could not clear basket — see console for details.');
  }
}

function shareScore(){
  const stats = (document.getElementById('impactText') || {}).innerText || '';
  const origin = window.location.origin || 'https://switchtoindia.in';
  const url = origin + '/';
  const prefix = 'My Indian score from SwitchToIndia:';
  const message = stats ? `${prefix} ${stats} — Try it: ${url}` : `Check your SwitchToIndia score: ${url}`;

  if (navigator.share) {
    navigator.share({ title: 'My Indian Score — SwitchToIndia', text: message, url })
      .catch(err => {
        console.info('navigator.share failed or cancelled:', err);
        tryCopy();
      });
  } else {
    tryCopy();
  }

  function tryCopy(){
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(message).then(() => {
        alert('Score copied to clipboard — paste it in any chat to share!');
      }).catch(() => {
        prompt('Copy and share this message:', message);
      });
    } else {
      prompt('Copy and share this message:', message);
    }
  }
}

/* -------- Init on load -------- */
window.addEventListener('DOMContentLoaded', async function(){
  const initial = new URL(window.location.href).searchParams.get('q') || '';
  if (initial && document.body.contains(document.getElementById('resultsList'))) {
    const sb = document.getElementById('searchBox');
    const sbh = document.getElementById('searchBoxHero');
    if (sb) sb.value = initial;
    if (sbh) sbh.value = initial;
    await searchAndShow(initial);
  }
  if (document.body.contains(document.getElementById('basketItems'))) {
    loadBasket();
  }
  updateBasketCount();
});

/* --- Onboarding tooltip (robust) --- */
function showOnboardingTooltipOnce() {
  try {
    if (localStorage.getItem('seen_badge_tooltip_v1')) return;
    if (document.getElementById('switchtoindia-tooltip-overlay')) return;

    if (!document.querySelector('style[data-switchtoindia-tooltip]')) {
      const s = document.createElement('style');
      s.setAttribute('data-switchtoindia-tooltip','1');
      s.innerText = `
        .tooltip-overlay{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.45);display:flex;justify-content:center;align-items:center;z-index:99999}
        .tooltip-box{background:#fff;border-radius:12px;padding:20px;max-width:360px;text-align:center;box-shadow:0 12px 40px rgba(0,0,0,0.25)}
        .tooltip-box h3{margin-top:0;margin-bottom:10px}
        .tooltip-badges{display:flex;justify-content:center;gap:12px;margin:12px 0}
        .flag-badge.indian{background:#138808;color:#fff;padding:6px 10px;border-radius:6px}
        .flag-badge.foreign{background:#d9534f;color:#fff;padding:6px 10px;border-radius:6px}
        .tooltip-box button{margin-top:12px}
      `;
      document.head.appendChild(s);
    }

    const isHomeSelector = !!document.querySelector('.hero');
    const isResultsSelector = !!document.getElementById('resultsList') || !!document.querySelector('.result-row');
    const isHomePath = location.pathname === '/' || location.pathname.toLowerCase().endsWith('/index.html');
    const shouldShow = isHomeSelector || isHomePath || isResultsSelector;
    if (!shouldShow) return;

    setTimeout(() => {
      if (localStorage.getItem('seen_badge_tooltip_v1')) return;
      const overlay = document.createElement('div');
      overlay.id = 'switchtoindia-tooltip-overlay';
      overlay.className = 'tooltip-overlay';
      overlay.innerHTML = `
        <div class="tooltip-box" role="dialog" aria-labelledby="tooltipTitle" aria-describedby="tooltipDesc">
          <h3 id="tooltipTitle">Understand the Badges</h3>
          <p id="tooltipDesc">Badges show ownership at a glance:</p>
          <div class="tooltip-badges">
            <span class="flag-badge indian" aria-label="Indian owned brand">Indian</span>
            <span class="flag-badge foreign" aria-label="Foreign owned brand">Foreign</span>
          </div>
          <p class="small">Use Switch To India to discover local alternatives.</p>
          <div style="margin-top:12px"><button class="btn btn-primary" id="tooltipClose">Got it</button></div>
        </div>`;
      document.body.appendChild(overlay);
      const closeBtn = document.getElementById('tooltipClose');
      closeBtn && closeBtn.addEventListener('click', () => {
        try { overlay.remove(); } catch(e){}
        localStorage.setItem('seen_badge_tooltip_v1', 'yes');
      });
      overlay.addEventListener('click', (ev) => {
        if (ev.target === overlay) {
          try { overlay.remove(); } catch(e){}
          localStorage.setItem('seen_badge_tooltip_v1', 'yes');
        }
      });
    }, 220);
  } catch (e) {
    console.error('showOnboardingTooltipOnce error', e);
  }
}
window.addEventListener('DOMContentLoaded', showOnboardingTooltipOnce);

/* expose functions */
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
window.updateBasketCount = updateBasketCount;
window.clearBasket = clearBasket;
window.shareScore = shareScore;
