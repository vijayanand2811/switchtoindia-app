const AIRTABLE_TOKEN = "pateN3Nvm4hLlMM0U.4ead46cdf48740caa795239fcac77589066dd5ce370b27bc4ddf05a95b135de7";
const BASE_ID = "app9uksWqcJIui7m0";
const TABLE_NAME = "Products";

let _productsCache = null;

async function fetchProductsOnce(){
  if (_productsCache) return _productsCache;
  const endpoint = '/.netlify/functions/getProducts'; // Netlify function path
  const res = await fetch(endpoint); // optional: + '?q=maggi'
  if (!res.ok) throw new Error('Failed to fetch from function: ' + res.status);
  const json = await res.json();
  _productsCache = (json.records || []);
  return _productsCache;
}

async function searchAndShow(q){
  document.getElementById('resultsList').innerHTML = '<div class="small">Searching…</div>';
  const list = (await fetchProductsOnce()) || [];
  const ql = q.toLowerCase();
  const results = list.filter(p => {
    const name = (p.ProductName || '').toString().toLowerCase();
    const brand = (p.Brand || '').toString().toLowerCase();
    return name.includes(ql) || brand.includes(ql);
  });
  renderResults(results);
}

function renderResults(results){
  const container = document.getElementById('resultsList');
  const no = document.getElementById('noResults');
  container.innerHTML = '';
  if(!results || results.length === 0){ no.style.display='block'; return; } else { no.style.display='none'; }
  results.forEach(p => {
    const parent = p.ParentCompany || 'Unknown';
    const country = p.ParentCountry || 'Unknown';
    const alt1 = p.Alternative1 || '';
    const alt2 = p.Alternative2 || '';
    const alt3 = p.Alternative3 || '';
    const isIndian = (country.toString().toLowerCase().indexOf('india') !== -1);
    const badge = isIndian ? '<span class="flag-badge">Indian</span>' : '<span class="flag-badge">Foreign</span>';
    const html = `
      <div class="result-row">
        <div class="result-left">
          <h3>${escapeHtml(p.ProductName || '')}</h3>
          <div class="small"><strong>Parent:</strong> ${escapeHtml(parent)} — ${escapeHtml(country)}</div>
          <div style="margin-top:8px"><strong>Try:</strong> ${escapeHtml(alt1)} ${alt2? ', ' + escapeHtml(alt2):''} ${alt3? ', ' + escapeHtml(alt3):''}</div>
        </div>
        <div class="result-right">
          ${badge}
          <div style="height:8px"></div>
          <button class="btn btn-primary" onclick="addToBasketFromResult('${escapeJS(p.ProductName||'')}', '${escapeJS(country||'Unknown')}')">Add to Basket</button>
        </div>
      </div>
    `;
    container.insertAdjacentHTML('beforeend', html);
  });
}

function escapeHtml(s){ return (s+'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"}[c])); }
function escapeJS(s){ return (s+'').replace(/'/g, "\\'").replace(/\"/g, '\\\"'); }
function addToBasketFromResult(name, country){ addToBasket(name, country); alert(name + ' added to basket.'); }
function addToBasket(name, country){ const cur = JSON.parse(localStorage.getItem('basket') || '[]'); cur.push({ name, country }); localStorage.setItem('basket', JSON.stringify(cur)); }
function loadBasket(){ const basketItemsDiv = document.getElementById('basketItems'); if(!basketItemsDiv) return; const basket = JSON.parse(localStorage.getItem('basket') || '[]'); if(basket.length === 0){ basketItemsDiv.innerHTML = '<div class="small">Your basket is empty. Add items from results.</div>'; clearChart(); return; } basketItemsDiv.innerHTML = basket.map(i => `<div style="padding:6px 0"><strong>${escapeHtml(i.name)}</strong> <span class="small">(${escapeHtml(i.country||'')})</span></div>`).join(''); renderImpact(basket); }
let chartInstance = null;
function clearChart(){ if(chartInstance){ chartInstance.destroy(); chartInstance = null; } const ctx = document.getElementById('pieChart')?.getContext('2d'); if(ctx){ ctx.clearRect(0,0,220,220); document.getElementById('impactText').innerText = ''; } }
function renderImpact(basket){ const indianCount = basket.filter(i => (i.country||'').toString().toLowerCase().indexOf('india') !== -1).length; const foreignCount = basket.length - indianCount; const total = basket.length; const indianPct = total===0?0: Math.round((indianCount/total)*10000)/100; const foreignPct = Math.round((100 - indianPct)*100)/100; const text = `Indian: ${indianCount} (${indianPct}%) — Foreign: ${foreignCount} (${foreignPct}%)`; document.getElementById('impactText').innerText = text; const ctx = document.getElementById('pieChart').getContext('2d'); if(chartInstance){ chartInstance.destroy(); } chartInstance = new Chart(ctx, { type:'pie', data:{ labels:['Indian','Foreign'], datasets:[{ data:[indianCount, foreignCount], backgroundColor:['#138808','#FF9933'] }] }, options:{responsive:true,maintainAspectRatio:true,plugins:{legend:{position:'bottom'}}} ); }
if(document.body.contains(document.getElementById('basketItems'))){ loadBasket(); }
window.searchAndShow = searchAndShow
