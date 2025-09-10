// netlify/functions/getProducts.js
const fetch = require('node-fetch');

exports.handler = async function(event) {
  try {
    const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
    const BASE_ID = process.env.AIRTABLE_BASE_ID;
    const TABLE_NAME = process.env.AIRTABLE_TABLE || 'Products';

    if (!AIRTABLE_TOKEN || !BASE_ID) {
      return { statusCode: 500, body: 'Server misconfigured: missing Airtable credentials.' };
    }

    // optional query param 'q' for search
    const url = new URL(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_NAME)}`);
    url.searchParams.set('pageSize', '100'); // page size
    // You can implement more filtering server-side if needed

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` }
    });

    if (!res.ok) {
      const txt = await res.text();
      return { statusCode: res.status, body: `Airtable error: ${txt}` };
    }

    const json = await res.json();
    // Optionally implement basic filtering here by ?q=...
    const q = (event.queryStringParameters && event.queryStringParameters.q || '').toLowerCase().trim();
    let records = (json.records || []).map(r => r.fields || {});
    if (q) {
      records = records.filter(p => {
        const name = (p.ProductName || '').toString().toLowerCase();
        const brand = (p.Brand || '').toString().toLowerCase();
        return name.includes(q) || brand.includes(q);
      });
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ records })
    };
  } catch (err) {
    return { statusCode: 500, body: 'Server error: ' + String(err) };
  }
};
