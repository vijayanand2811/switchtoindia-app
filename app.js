// Replace with your Airtable credentials
const AIRTABLE_TOKEN = "pateN3Nvm4hLlMM0U.4ead46cdf48740caa795239fcac77589066dd5ce370b27bc4ddf05a95b135de7";
const BASE_ID = "app9uksWqcJIui7m0";
const TABLE_NAME = "Products";

let basket = [];

// Fetch products from Airtable
async function fetchProducts() {
  const url = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_NAME}`;
const response = await fetch(url, {
  headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` }
});

  const data = await response.json();
  return data.records.map(r => r.fields);
}

// Search and display
async function searchProduct() {
  const query = document.getElementById("searchBox").value;
  const products = await fetchProducts();
  const results = products.filter(p => p.ProductName.toLowerCase().includes(query.toLowerCase()));
  displayResults(results);
}

function displayResults(products) {
  const resultsDiv = document.getElementById("results");
  if (!resultsDiv) return;
  resultsDiv.innerHTML = "";
  products.forEach(p => {
    resultsDiv.innerHTML += `
      <div class="card">
        <h3>${p.ProductName}</h3>
        <p><b>Parent:</b> ${p.ParentCompany} (${p.ParentCountry})</p>
        <p><b>Switch to:</b> ${p.Alternative1 || ""}, ${p.Alternative2 || ""}, ${p.Alternative3 || ""}</p>
        <button onclick="addToBasket('${p.ProductName}', '${p.ParentCountry}')">Add to Basket</button>
      </div>
    `;
  });
}

// Basket functions
function addToBasket(name, country) {
  basket.push({ name, country });
  localStorage.setItem("basket", JSON.stringify(basket));
  alert(name + " added to basket!");
}

function loadBasket() {
  const basketItemsDiv = document.getElementById("basketItems");
  if (!basketItemsDiv) return;

  basket = JSON.parse(localStorage.getItem("basket")) || [];
  basketItemsDiv.innerHTML = basket.map(i => `<p>${i.name} (${i.country})</p>`).join("");

  const indian = basket.filter(i => i.country.toLowerCase() === "india").length;
  const foreign = basket.length - indian;

  if (basket.length > 0) {
    const ctx = document.getElementById("pieChart").getContext("2d");
    new Chart(ctx, {
      type: "pie",
      data: {
        labels: ["Indian", "Foreign"],
        datasets: [{
          data: [indian, foreign],
          backgroundColor: ["#138808", "#FF9933"]
        }]
      }
    });
  }
}

// Load basket on basket.html
if (document.body.contains(document.getElementById("basketItems"))) {
  loadBasket();
}
