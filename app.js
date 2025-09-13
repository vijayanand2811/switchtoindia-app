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

/* -------- Search + render pipeline -------- */
function searchAndShow(q) {
  var container = document.getElementById('resultsList');
  if (!container) return;
  container.innerHTML = '<div class="small">Searching…</div>';

  fetchProductsOnce().then(function(all){
    try {
      var ql = (q||'').toString().toLowerCase().trim();
      var results = all.filter(function(item){
        var name = fieldToString(item.ProductName || item.ProductID || '').toLowerCase();
        var brand = fieldToString(item.Brand || '').toLowerCase();
        var alt1 = fieldToString(item.Alternative1 || '').toLowerCase();
        var alt2 = fieldToString(item.Alternative2 || '').toLowerCase();
        var alt3 = fieldToString(item.Alternative3 || '').toLowerCase();
        if (!ql) return true;
        return name.indexOf(ql) !== -1 || brand.indexOf(ql) !== -1 || alt1.indexOf(ql) !== -1 || alt2.indexOf(ql) !== -1 || alt3.indexOf(ql) !== -1;
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

/* -------- renderResults: displays product + alternatives -------- */
function renderResults(results) {
  var container = document.getElementById('resultsList');
  var no = document.getElementById('noResults');
  if (!container) return;
  container.innerHTML = '';

  if (!results || results.length === 0) {
    if (no) no.style.display = 'block';
    else container.innerHTML = '<div class="small">No results</div>';
    return;
  } else if (no) {
    no.style.display = 'none';
  }

  for (var i=0;i<results.length;i++){
    var item = results[i];
    var name = fieldToString(item.ProductName || item.ProductID || 'Unnamed product');
    var brand = fieldToString(item.Brand || '');
    var parent = fieldToString(item.ParentCompany || '');
    var country = fieldToString(item.ParentCountry || '');
    var imageUrl = fieldToString(item.ImageURL || '');

    var rawAlts = [];
    if (item.Alternative1) rawAlts.push(fieldToString(item.Alternative1));
    if (item.Alternative2) rawAlts.push(fieldToString(item.Alternative2));
    if (item.Alternative3) rawAlts.push(fieldToString(item.Alternative3));

    var alts = pickAltObjects(item, rawAlts || []);

    var isIndianParent = (country || '').toLowerCase().indexOf('india') !== -1;
    var badgeHtml = isIndianParent ? '<span class="flag-badge indian" aria-label="Indian owned brand">Indian</span>' : '<span class="flag-badge foreign" aria-label="Foreign owned brand">Foreign</span>';
    var imgHtml = imageUrl ? '<img src="' + escapeHtml(imageUrl) + '" alt="' + escapeHtml(name) + '" class="product-thumb">' : '';

    var altHtml = '';
    if (alts && alts.length) {
      altHtml += '<div class="alt-list">';
      altHtml += '<div style="margin-bottom:8px;font-weight:700;color:#333">Alternatives:</div>';
      for (var j=0;j<alts.length;j++){
        var altObj = alts[j];
        if (!altObj) continue;
        var altName = fieldToString(altObj.ProductName || altObj.Brand || '');
        var altCountry = fieldToString(altObj.ParentCountry || '');
        var safeA = escapeJS(altName);
        var isAltIndian = (fieldToString(altObj.Ownership||'')).toLowerCase().indexOf('india') !== -1 || (altCountry || '').toLowerCase().indexOf('india') !== -1;
        var altBadge = isAltIndian ? '<span class="flag-badge indian" aria-label="Indian owned brand">Indian</span>' : '<span class="flag-badge foreign" aria-label="Foreign owned brand">Foreign</span>';
        altHtml += '<div class="alt-item" style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;">' +
                   '<div class="alt-name">' + escapeHtml(altName) + ' ' + altBadge + '</div>' +
                   '<div class="alt-action"><button class="btn btn-ghost small-btn" onclick="addAlternativeToBasket(\'' + safeA + '\')">Switch / Add</button></div>' +
                   '</div>';
      }
      altHtml += '</div>';
    } else {
      var raw = rawAlts || [];
      if (raw.length) {
        altHtml += '<div class="alt-list"><div style="font-weight:700;color:#333;margin-bottom:8px">Alternatives (unverified):</div>';
        for (var r=0;r<raw.length;r++){
          var a = raw[r];
          var safeA2 = escapeJS(a);
          altHtml += '<div class="alt-item" style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;">' +
                     '<div class="alt-name">' + escapeHtml(a) + ' <span class="flag-badge foreign" aria-label="Unverified">Unverified</span></div>' +
                     '<div class="alt-action"><button class="btn btn-ghost small-btn" onclick="addAlternativeToBasket(\'' + safeA2 + '\')">Add</button></div>' +
                     '</div>';
        }
        altHtml += '</div>';
      }
    }

    var safeName = escapeJS(name);
    var safeCountry = escapeJS(country);

    var html = '<div class="result-row card" style="margin-bottom:12px;">' +
               '<div class="result-left">' +
               '<div style="display:flex;align-items:center;gap:12px;">' +
               imgHtml +
               '<div style="flex:1">' +
               '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">' +
               '<h3 style="margin:0;">' + escapeHtml(name) + '</h3>' +
               badgeHtml +
               '<button class="btn btn-ghost small-btn" style="margin-left:6px;" onclick="addToBasketFromResult(\'' + safeName + '\', \'' + safeCountry + '\')">Add</button>' +
               '</div>' +
               '<div class="small" style="margin-top:8px;"><strong>Brand:</strong> ' + escapeHtml(brand) + ' &nbsp; <strong>Parent:</strong> ' + escapeHtml(parent) + ' — ' + escapeHtml(country) + '</div>' +
               '</div>' +
               '</div>' +
               altHtml +
               '</div>' +
               '</div>';
    container.insertAdjacentHTML('beforeend', html);
  }
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
function addAlternativeToBasket(altName) {
  addToBasket(altName, 'India', null, 1);
  showToast(altName + ' added to basket. You can set price in Basket.');
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
