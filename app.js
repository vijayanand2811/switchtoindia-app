/* app.js — SwitchToIndia full client JS
   Compatibility-safe: avoids nullish (??) and optional chaining (?.)
   Replace your existing app.js with this file.
*/

/* -------- Configuration -------- */
var USE_NETLIFY_FUNCTION = true;
var NETLIFY_FUNCTION_ENDPOINT = '/.netlify/functions/getProducts';
var BASKET_KEY = 'stindiabasket_v1';

/* -------- Utilities -------- */
function escapeHtml(s){
  return (s+'').replace(/[&<>"']/g,function(c){
    return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]);
  });
}
function escapeJS(s){
  return (s+'').replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/"/g,'\\"');
}
function showToast(msg){
  try {
    var t = document.createElement('div');
    t.innerText = msg;
    t.style.position='fixed'; t.style.right='18px'; t.style.bottom='18px';
    t.style.padding='10px 14px'; t.style.background='#111'; t.style.color='#fff';
    t.style.borderRadius='10px'; t.style.boxShadow='0 6px 18px rgba(0,0,0,0.18)';
    t.style.zIndex=99999;
    document.body.appendChild(t);
    setTimeout(function(){ try{ t.remove(); }catch(e){} },2000);
  } catch(e){ console.warn('showToast failed', e); }
}

/* safe conversion of Airtable fields to string for comparisons */
function fieldToString(v){
  if (v == null) return '';
  if (Array.isArray(v)) {
    return v.map(function(x){
      if (typeof x === 'string') return x;
      if (x && typeof x === 'object' && x.name) return String(x.name);
      return String(x);
    }).join(', ');
  }
  if (typeof v === 'object') {
    if (v.name) return String(v.name);
    try { return JSON.stringify(v); } catch(e) { return String(v); }
  }
  return String(v);
}

/* -------- Data fetch -------- */
var _productsCache = null;
function fetchProductsOnce(){
  return new Promise(function(resolve){
    if (_productsCache) return resolve(_productsCache);
    if (USE_NETLIFY_FUNCTION) {
      fetch(NETLIFY_FUNCTION_ENDPOINT).then(function(res){
        if (!res.ok) {
          return res.text().then(function(txt){
            throw new Error('Function returned ' + res.status + ': ' + txt);
          }).catch(function(e){ throw e; });
        }
        return res.json();
      }).then(function(json){
        var records = [];
        if (json && json.records) records = json.records;
        else if (Array.isArray(json)) records = json;
        _productsCache = records.map(function(r){ return (r && r.fields) ? r.fields : (r || {}); });
        resolve(_productsCache);
      }).catch(function(e){
        console.error('Netlify function fetch failed:', e);
        _productsCache = [];
        resolve(_productsCache);
      });
    } else {
      _productsCache = [];
      resolve(_productsCache);
    }
  });
}

/* -------- Search + render pipeline (improved: whole-word matching + applied to alternatives) -------- */
function searchAndShow(q) {
  var container = document.getElementById('resultsList');
  if (!container) return;
  container.innerHTML = '<div class="small">Searching…</div>';

  fetchProductsOnce().then(function(all){
    try {
      var ql = (q||'').toString().toLowerCase().trim();

      function escapeRegExpForSearch(s){
        return (s || '').toString().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      }

      // helper: get searchable strings for a record
      function fieldsToSearch(item) {
        return {
          name: fieldToString(item.ProductName || item.ProductID || '').toLowerCase(),
          brand: fieldToString(item.Brand || '').toLowerCase(),
          alt1: fieldToString(item.Alternative1 || '').toLowerCase(),
          alt2: fieldToString(item.Alternative2 || '').toLowerCase(),
          alt3: fieldToString(item.Alternative3 || '').toLowerCase(),
          category: fieldToString(item.Category || '').toLowerCase(),
          subcat: fieldToString(item.Subcategory || '').toLowerCase(),
          attrs: (typeof item.Attributes === 'string' ? item.Attributes : (item.Attributes || '')).toString().toLowerCase()
        };
      }

      var results = all.filter(function(item){
        var f = fieldsToSearch(item);

        if (!ql) return true;

        var tokens = ql.split(/\s+/).filter(Boolean);
        if (tokens.length === 0) return true;

        // For each token, check across all searchable fields. If any token matches (whole-word / substring rules), accept the record.
        return tokens.some(function(t){
          var esc = escapeRegExpForSearch(t);
          if (t.length <= 2) {
            // short tokens: allow substring across all fields
            return (
              f.name.indexOf(t) !== -1 ||
              f.brand.indexOf(t) !== -1 ||
              f.alt1.indexOf(t) !== -1 ||
              f.alt2.indexOf(t) !== -1 ||
              f.alt3.indexOf(t) !== -1 ||
              f.category.indexOf(t) !== -1 ||
              f.subcat.indexOf(t) !== -1 ||
              f.attrs.indexOf(t) !== -1
            );
          } else {
            // longer token: whole-word match across all fields
            var re = new RegExp('\\b' + esc + '\\b', 'i');
            return (
              re.test(f.name) ||
              re.test(f.brand) ||
              re.test(f.alt1) ||
              re.test(f.alt2) ||
              re.test(f.alt3) ||
              re.test(f.category) ||
              re.test(f.subcat) ||
              re.test(f.attrs)
            );
          }
        });
      });

      renderResults(results);
    } catch (err) {
      console.error('searchAndShow error', err);
      container.innerHTML = '<div class="small">Error loading data. See console.</div>';
    }
  }).catch(function(err){
    console.error('searchAndShow fetch error', err);
    container.innerHTML = '<div class="small">Error loading data. See console.</div>';
  });
}


/* -------- Alternative selection (scoring) -------- */
function pickAltObjects(item, rawAltNames) {
  function normalize(s){ return fieldToString(s).trim(); }
  function nLower(s){ return normalize(s).toLowerCase(); }

  if (!window._prodMap) {
    window._prodMap = {};
    var list = _productsCache || [];
    for (var i=0;i<list.length;i++){
      var p = list[i];
      var name = nLower(p.ProductName || '');
      var id = nLower(p.ProductID || '');
      var brand = nLower(p.Brand || '');
      if (name) window._prodMap[name] = p;
      if (id) window._prodMap[id] = p;
      if (brand && name) window._prodMap[brand + ':::' + name] = p;
    }
  }

  var itemCat = nLower(item.Category || '');
  var itemSub = nLower(item.Subcategory || '');
  var itemAttrs = nLower(item.Attributes || '');

  function isFssaiTrue(rec){
    if (!rec) return false;
    var v = rec.FSSAI_Licensed;
    if (v === undefined) v = rec.FSSAI;
    if (v === true || v === false) return !!v;
    if (typeof v === 'string') {
      var lv = v.trim().toLowerCase();
      return (lv === 'yes' || lv === 'y' || lv === 'true' || lv === '1');
    }
    return Boolean(v);
  }

  var candidates = (rawAltNames || []).map(function(n){
    if (!n) return null;
    var key = nLower(n);
    if (window._prodMap[key]) return window._prodMap[key];
    for (var j=0;j<(_productsCache||[]).length;j++){
      var p = (_productsCache||[])[j];
      var pname = fieldToString(p.ProductName || '').toLowerCase();
      if (pname.indexOf(key) !== -1) return p;
    }
    return { ProductName: String(n).trim(), ProductID:'', Brand:'', ParentCompany:'', ParentCountry:'', Category:'', Subcategory:'', Attributes:'', Ownership:'', FSSAI_Licensed:false };
  }).filter(Boolean);

  var scored = candidates.map(function(alt){
    var cat = nLower(alt.Category || '');
    var sub = nLower(alt.Subcategory || '');
    var attrs = nLower(alt.Attributes || '');
    var isIndian = (fieldToString(alt.Ownership || '').toLowerCase().indexOf('india') !== -1) || (fieldToString(alt.ParentCountry || '').toLowerCase().indexOf('india') !== -1);
    var fssai = isFssaiTrue(alt);
    var score = 0;
    if (sub && itemSub && sub === itemSub) score += 300;
    if (cat && itemCat && cat === itemCat) score += 80;
    if (itemAttrs && attrs) {
      var as = itemAttrs.split(',').map(function(x){ return x.trim(); }).filter(Boolean);
      var bs = attrs.split(',').map(function(x){ return x.trim(); }).filter(Boolean);
      if (as.length && bs.length) {
        for (var k=0;k<as.length;k++){ if (bs.indexOf(as[k]) !== -1) { score += 30; break; } }
      }
    }
    if (isIndian) score += 60;
    if (fssai) score += 20;
    var altName = fieldToString(alt.ProductName || '').toLowerCase();
    if (altName && rawAltNames.join(' ').toLowerCase().indexOf(altName) !== -1) score += 6;
    return { alt: alt, score: score };
  });

  scored.sort(function(a,b){ return b.score - a.score; });
  return scored.map(function(s){ return s.alt; }).slice(0,3);
}

/* renderResults: displays product card + stacked alternatives (NEW) */
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

  // ensure product map exists for pickAltObjects etc.
  window._prodMap = window._prodMap || (_productsCache || []).reduce((m, p) => {
    if (p && (p.ProductName || p.ProductID)) m[(p.ProductName || p.ProductID).toString().toLowerCase()] = p;
    return m;
  }, {});

  results.forEach(item => {
    const name = item.ProductName || item.ProductID || 'Unnamed product';
    const brand = item.Brand || '';
    const parent = item.ParentCompany || '';
    const country = item.ParentCountry || '';
    const imageUrl = item.ImageURL || '';

    // gather raw alternative names
    const rawAlts = [];
    if (item.Alternative1) rawAlts.push(item.Alternative1);
    if (item.Alternative2) rawAlts.push(item.Alternative2);
    if (item.Alternative3) rawAlts.push(item.Alternative3);

    // pick best matching alternative objects (uses your existing pickAltObjects)
    const altObjs = (typeof pickAltObjects === 'function') ? pickAltObjects(item, rawAlts) : rawAlts.map(n => ({ ProductName: n, ParentCountry: 'India', ParentCompany: '', Brand: n }));

    // product badge
    const isIndianParent = (country || '').toString().toLowerCase().includes('india');
    const badgeHtml = isIndianParent
      ? '<span class="flag-badge indian" aria-label="Indian owned brand">Indian</span>'
      : '<span class="flag-badge foreign" aria-label="Foreign owned brand">Foreign</span>';

    const imgHtml = imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(name)}" class="product-thumb">` : '';

    // build HTML for main product block
    let html = '';
    html += `<div class="result-row card" style="margin-bottom:12px;">`;
    html += `  <div class="result-info">`;
    html += `    <div style="display:flex;align-items:center;gap:12px;">`;
    if (imgHtml) html += imgHtml;
    html += `      <div style="flex:1;min-width:0">`;
    html += `        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">`;
    html += `          <h3 style="margin:0;">${escapeHtml(name)}</h3>`;
    html += `          ${badgeHtml}`;
    html += `        </div>`;
    html += `        <div class="small" style="margin-top:8px;"><strong>Brand:</strong> ${escapeHtml(brand)} &nbsp; <strong>Parent:</strong> ${escapeHtml(parent)} — ${escapeHtml(country)}</div>`;
    // show category/subcategory if present
    if (item.Category || item.Subcategory) {
      html += `    <div class="small" style="margin-top:6px;"><strong>Category:</strong> ${escapeHtml(item.Category || '')}`;
      if (item.Subcategory) html += ` — ${escapeHtml(item.Subcategory)}`;
      html += `</div>`;
    }
    html += `      </div>`;
    html += `    </div>`; // end product top row
    html += `  </div>`; // end result-info

    // actions (Add button) - right aligned column
    html += `  <div class="result-actions">`;
    const safeName = escapeJS(name);
    const safeCountry = escapeJS(country);
    html += `    <button class="btn btn-ghost small-btn add-btn" onclick="addToBasketFromResult('${safeName}', '${safeCountry}')">Add</button>`;
    html += `  </div>`; // end result-actions

    html += `  <div style="width:100%;margin-top:12px">`;
    // Alternatives header & list
    if (altObjs && altObjs.length) {
      html += `<div class="alt-list">`;
      html += `<div style="margin-bottom:8px;font-weight:700;color:#333">Alternatives:</div>`;

      // for each alternative, render using the same layout (alt-item)
      altObjs.forEach(altObj => {
        if (!altObj) return;
        const altName = altObj.ProductName || altObj.ProductID || '';
        const altBrand = altObj.Brand || '';
        const altParent = altObj.ParentCompany || '';
        const altCountry = altObj.ParentCountry || altObj.Country || '';
        const isAltIndian = (altObj.Ownership || '').toString().toLowerCase().includes('india') || (altCountry || '').toString().toLowerCase().includes('india');
        const altBadge = isAltIndian ? '<span class="flag-badge indian">Indian</span>' : '<span class="flag-badge foreign">Foreign</span>';
        const safeAltNameJS = escapeJS(altName);
        html += `<div class="alt-item card" style="padding:10px;margin-bottom:8px;">`;
        html += `  <div class="alt-info">`;
        html += `    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">`;
        html += `      <div style="flex:1;min-width:0"><strong>${escapeHtml(altName)}</strong> ${altBadge}</div>`;
        html += `    </div>`;
        html += `    <div class="small" style="margin-top:6px;"><strong>Brand:</strong> ${escapeHtml(altBrand)} &nbsp; <strong>Parent:</strong> ${escapeHtml(altParent)} — ${escapeHtml(altCountry)}</div>`;
        if (altObj.Category || altObj.Subcategory) {
          html += `<div class="small" style="margin-top:6px;"><strong>Category:</strong> ${escapeHtml(altObj.Category || '')}`;
          if (altObj.Subcategory) html += ` — ${escapeHtml(altObj.Subcategory)}`;
          html += `</div>`;
        }
        html += `  </div>`; // end alt-info

        // alt actions column (Switch/Add)
        html += `  <div class="alt-actions">`;
        html += `    <button class="btn btn-ghost small-btn" onclick="addAlternativeToBasket('${safeAltNameJS}', '${escapeJS(altCountry || 'India')}')">Switch</button>`;
        html += `  </div>`;

        html += `</div>`; // end alt-item
      });

      html += `</div>`; // end alt-list
    }
    html += `  </div>`; // end alternatives wrapper

    html += `</div>`; // end result-row

    container.insertAdjacentHTML('beforeend', html);
  });
}

/* -------- Basket helpers (grouped, qty, price) -------- */
function readBasket(){
  try { return JSON.parse(localStorage.getItem(BASKET_KEY) || '[]'); } catch(e){ console.error(e); return []; }
}
function writeBasket(arr){ localStorage.setItem(BASKET_KEY, JSON.stringify(arr)); localStorage.setItem('basket', JSON.stringify(arr)); if (typeof updateBasketCount === 'function') updateBasketCount(); }

function addToBasket(name, country, price, qty) {
  price = (price === undefined) ? null : price;
  qty = qty || 1;
  var key = ((name||'').trim() + '|' + (country||'').trim());
  var cur = readBasket();
  var idx = -1;
  for (var i=0;i<cur.length;i++){ if (cur[i].key === key) { idx = i; break; } }
  if (idx >= 0) {
    cur[idx].qty = (cur[idx].qty || 0) + qty;
    if (price != null && (!cur[idx].price || cur[idx].price == null)) cur[idx].price = Number(price);
  } else {
    cur.push({ id: Date.now() + Math.random().toString(16).slice(2,8), key: key, name: name, country: country, qty: qty, price: price != null ? Number(price) : null });
  }
  writeBasket(cur);
  if (document.body.contains(document.getElementById('basketItems'))) loadBasket();
}

function updateBasketCount() {
  try {
    var count = readBasket().reduce(function(s,i){ return s + (i.qty || 0); }, 0);
    var el = document.getElementById('basketCount');
    if (!el) return;
    var prev = Number(el.innerText || 0);
    el.innerText = String(count);
    if (count > 0) {
      el.style.display = 'inline-block';
      el.setAttribute('aria-label', count + ' items in basket');
      if (count > prev) { el.classList.add('pop'); setTimeout(function(){ el.classList.remove('pop'); },350); }
    } else {
      el.style.display = 'none';
      el.removeAttribute('aria-label');
    }
  } catch (e) { console.error('updateBasketCount error', e); }
}

function addToBasketFromResult(name, country) {
  addToBasket(name, country, null, 1);
  showToast(name + ' added to basket. You can set price in Basket.');
}
/* Add alternative to basket; accepts name and optional country */
function addAlternativeToBasket(altName, altCountry) {
  const country = altCountry || 'India';
  addToBasket(altName, country, null, 1);
  showToast(`${altName} added to basket. You can set price in Basket.`);
}

/* Basket rendering */
var chartInstance = null;
function loadBasket() {
  var basketItemsDiv = document.getElementById('basketItems');
  if (!basketItemsDiv) return;
  var basket = readBasket();
  if (!basket || basket.length === 0) {
    basketItemsDiv.innerHTML = '<div class="small">Your basket is empty. Add items from results.</div>';
    if (typeof clearChart === 'function') clearChart();
    else { var it = document.getElementById('impactText'); if (it) it.innerText = ''; }
    return;
  }

  var htmlParts = basket.map(function(item, index){
    var isIndian = (item.country||'').toString().toLowerCase().indexOf('india') !== -1;
    var badge = isIndian ? '<span class="flag-badge indian" aria-label="Indian owned brand">Indian</span>' : '<span class="flag-badge foreign" aria-label="Foreign owned brand">Foreign</span>';
    var priceText = (item.price != null) ? ('₹ ' + Number(item.price).toFixed(2)) : 'Price: N/A';
    return '<div class="basket-row card" data-index="' + index + '" style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px;padding:10px;">' +
           '<div style="display:flex;align-items:center;gap:12px;flex:1;">' +
           '<div style="flex:1">' +
           '<div style="display:flex;align-items:center;gap:8px;">' +
           '<strong>' + escapeHtml(item.name) + '</strong>' +
           badge +
           '<span class="small" style="margin-left:6px;color:#666">(' + escapeHtml(item.country||'') + ')</span>' +
           '</div>' +
           '<div class="small" style="margin-top:6px;color:#666">' + priceText + '</div>' +
           '</div>' +
           '<div style="display:flex;align-items:center;gap:8px;">' +
           '<button class="btn btn-ghost small-btn" onclick="updateQuantity(' + index + ',-1)">−</button>' +
           '<div style="min-width:36px;text-align:center;font-weight:600">' + item.qty + '</div>' +
           '<button class="btn btn-ghost small-btn" onclick="updateQuantity(' + index + ',1)">+</button>' +
           '</div>' +
           '</div>' +
           '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px;">' +
           '<button class="btn btn-ghost small-btn" onclick="editPrice(' + index + ')">Edit Price</button>' +
           '<button class="btn btn-ghost" onclick="removeItem(' + index + ')">Remove</button>' +
           '</div>' +
           '</div>';
  }).join('');

  basketItemsDiv.innerHTML = htmlParts;
  renderImpact(basket);
}

function updateQuantity(index, delta) {
  var cur = readBasket();
  if (!cur[index]) return;
  cur[index].qty = (cur[index].qty || 0) + delta;
  if (cur[index].qty <= 0) {
    var ok = confirm('Remove "' + cur[index].name + '" from basket?');
    if (!ok) { cur[index].qty = 1; } else { cur.splice(index,1); }
  }
  writeBasket(cur);
  loadBasket();
  showToast('Basket updated');
}

function editPrice(index) {
  var cur = readBasket();
  if (!cur[index]) return;
  var current = (cur[index].price != null) ? cur[index].price : '';
  var p = prompt('Enter price for "' + cur[index].name + '":', current);
  if (p === null) return;
  if (p.trim() === '') { cur[index].price = null; }
  else {
    var parsed = Number(p.replace(/[^0-9.]/g,''));
    if (!isNaN(parsed)) cur[index].price = parsed;
    else { alert('Invalid number'); return; }
  }
  writeBasket(cur);
  loadBasket();
  showToast('Price updated');
}

function removeItem(index) {
  var cur = readBasket();
  if (!cur[index]) return;
  var ok = confirm('Remove "' + cur[index].name + '" from basket?');
  if (!ok) return;
  cur.splice(index,1);
  writeBasket(cur);
  loadBasket();
  showToast('Item removed');
}

function clearChart() {
  try {
    if (chartInstance && typeof chartInstance.destroy === 'function') { chartInstance.destroy(); chartInstance = null; }
    var ctxEl = document.getElementById('pieChart');
    if (ctxEl && ctxEl.getContext) { var ctx = ctxEl.getContext('2d'); ctx.clearRect(0,0,220,220); }
  } catch(e){ console.warn(e); }
  var impactTextEl = document.getElementById('impactText');
  if (impactTextEl) impactTextEl.innerText = '';
}

function renderImpact(basket) {
  var indianCount = basket.filter(function(i){ return (i.country||'').toLowerCase().indexOf('india') !== -1; }).reduce(function(s,i){ return s + (i.qty||0); }, 0);
  var foreignCount = basket.reduce(function(s,i){ return s + (i.qty||0); }, 0) - indianCount;
  var totalCount = indianCount + foreignCount;
  var indianPct = totalCount === 0 ? 0 : Math.round((indianCount/totalCount)*10000)/100;

  var indianAmount = 0, foreignAmount = 0;
  basket.forEach(function(i){
    var val = (i.price != null && !isNaN(i.price)) ? (Number(i.price) * (i.qty||1)) : 0;
    if ((i.country||'').toLowerCase().indexOf('india') !== -1) indianAmount += val;
    else foreignAmount += val;
  });
  var totalAmount = indianAmount + foreignAmount;

  var impactTextEl = document.getElementById('impactText');
  if (impactTextEl) {
    var cntText = totalCount ? ('Indian: ' + indianCount + ' (' + indianPct + '%) — Foreign: ' + foreignCount + ' (' + Math.round(100 - indianPct) + '%)') : '';
    var amtText = totalAmount ? ('Total ₹' + totalAmount.toFixed(2) + ' — India ₹' + indianAmount.toFixed(2) + ', Foreign ₹' + foreignAmount.toFixed(2)) : '';
    impactTextEl.innerText = [cntText, amtText].filter(Boolean).join(' — ');
  }

  var ctxEl2 = document.getElementById('pieChart');
  if (!ctxEl2 || !ctxEl2.getContext || typeof Chart !== 'function') return;
  try { if (chartInstance && typeof chartInstance.destroy === 'function') chartInstance.destroy(); } catch(e){}
  var ctx2 = ctxEl2.getContext('2d');
  chartInstance = new Chart(ctx2, {
    type: 'pie',
    data: {
      labels: ['Indian', 'Foreign'],
      datasets: [{ data: [indianCount, foreignCount], backgroundColor: ['#138808', '#FF9933'] }]
    },
    options: { responsive: true, maintainAspectRatio: true, plugins: { legend: { position: 'bottom' } } }
  });
}

/* clear / share helpers */
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
  var stats = (document.getElementById('impactText') || {}).innerText || '';
  var origin = window.location.origin || 'https://switchtoindia.in';
  var url = origin + '/';
  var prefix = 'My Indian score from SwitchToIndia:';
  var message = stats ? (prefix + ' ' + stats + ' — Try it: ' + url) : ('Check your SwitchToIndia score: ' + url);
  if (navigator.share) {
    navigator.share({ title: 'My Indian Score — SwitchToIndia', text: message, url: url })
      .catch(function(err){ console.info('navigator.share failed or cancelled:', err); tryCopy(); });
  } else {
    tryCopy();
  }
  function tryCopy(){
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(message).then(function(){ alert('Score copied to clipboard — paste it in any chat to share!'); }).catch(function(){ prompt('Copy and share this message:', message); });
    } else {
      prompt('Copy and share this message:', message);
    }
  }
}

/* -------- Init on load -------- */
window.addEventListener('DOMContentLoaded', function(){
  var initial = (new URL(window.location.href)).searchParams.get('q') || '';
  if (initial && document.body.contains(document.getElementById('resultsList'))) {
    var sb = document.getElementById('searchBox');
    var sbh = document.getElementById('searchBoxHero');
    if (sb) sb.value = initial;
    if (sbh) sbh.value = initial;
    try { searchAndShow(initial); } catch(e){ console.error(e); }
  }
  if (document.body.contains(document.getElementById('basketItems'))) {
    try { loadBasket(); } catch(e){ console.error(e); }
  }
  try { updateBasketCount(); } catch(e){}
  try { showOnboardingTooltipOnce(); } catch(e){}
});

/* --- Onboarding tooltip (robust) --- */
function showOnboardingTooltipOnce() {
  try {
    if (localStorage.getItem('seen_badge_tooltip_v1')) return;
    if (document.getElementById('switchtoindia-tooltip-overlay')) return;
    if (!document.querySelector('style[data-switchtoindia-tooltip]')) {
      var s = document.createElement('style');
      s.setAttribute('data-switchtoindia-tooltip','1');
      s.innerText = '\
        .tooltip-overlay{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.45);display:flex;justify-content:center;align-items:center;z-index:99999}\
        .tooltip-box{background:#fff;border-radius:12px;padding:20px;max-width:360px;text-align:center;box-shadow:0 12px 40px rgba(0,0,0,0.25)}\
        .tooltip-box h3{margin-top:0;margin-bottom:10px}\
        .tooltip-badges{display:flex;justify-content:center;gap:12px;margin:12px 0}\
        .flag-badge.indian{background:#138808;color:#fff;padding:6px 10px;border-radius:6px}\
        .flag-badge.foreign{background:#d9534f;color:#fff;padding:6px 10px;border-radius:6px}\
        .tooltip-box button{margin-top:12px}\
      ';
      document.head.appendChild(s);
    }
    var isHomeSelector = !!document.querySelector('.hero');
    var isResultsSelector = !!document.getElementById('resultsList') || !!document.querySelector('.result-row');
    var isHomePath = (location.pathname === '/') || (location.pathname.toLowerCase().endsWith('/index.html'));
    var shouldShow = isHomeSelector || isHomePath || isResultsSelector;
    if (!shouldShow) return;
    setTimeout(function(){
      if (localStorage.getItem('seen_badge_tooltip_v1')) return;
      var overlay = document.createElement('div');
      overlay.id = 'switchtoindia-tooltip-overlay';
      overlay.className = 'tooltip-overlay';
      overlay.innerHTML = '\
        <div class="tooltip-box" role="dialog" aria-labelledby="tooltipTitle" aria-describedby="tooltipDesc">\
          <h3 id="tooltipTitle">Understand the Badges</h3>\
          <p id="tooltipDesc">Badges show ownership at a glance:</p>\
          <div class="tooltip-badges">\
            <span class="flag-badge indian" aria-label="Indian owned brand">Indian</span>\
            <span class="flag-badge foreign" aria-label="Foreign owned brand">Foreign</span>\
          </div>\
          <p class="small">Use Switch To India to discover local alternatives.</p>\
          <div style="margin-top:12px"><button class="btn btn-primary" id="tooltipClose">Got it</button></div>\
        </div>';
      document.body.appendChild(overlay);
      var closeBtn = document.getElementById('tooltipClose');
      if (closeBtn) closeBtn.addEventListener('click', function(){
        try { overlay.remove(); } catch(e){}
        localStorage.setItem('seen_badge_tooltip_v1', 'yes');
      });
      overlay.addEventListener('click', function(ev){
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
