const fs = require('fs');
const base = 'C:/Users/User/.claude/projects/C--Users-User-Documents-GitHub/f086445e-b123-4ccd-9657-9cb39e93469a/tool-results/';

function getHtml(filename) {
  const raw = fs.readFileSync(base + filename, 'utf8');
  try {
    const arr = JSON.parse(raw);
    const text = arr.map(x => x.text || '').join('\n');
    try { const inner = JSON.parse(text); return inner.rawHtml || inner.html || text; } catch(e) { return text; }
  } catch(e) { return raw; }
}

function findAll(html, searchFor, contextChars=400, maxResults=3) {
  const results = [];
  let pos = 0;
  while (results.length < maxResults) {
    const idx = html.indexOf(searchFor, pos);
    if (idx === -1) break;
    results.push(html.substring(Math.max(0, idx-30), idx+contextChars));
    pos = idx + 1;
  }
  return results;
}

// ===== Σκλαβενίτης price and img =====
console.log('\n===== Σκλαβενίτης =====');
const sk = getHtml('mcp-firecrawl-mcp-firecrawl_scrape-1776169736381.txt');
const skPrice = findAll(sk, 'class="price"', 200);
skPrice.forEach((s,i) => console.log('price[' + i + ']: ' + s.substring(0,200)));
const skMainPrice = findAll(sk, 'main-price', 300);
skMainPrice.forEach((s,i) => console.log('main-price[' + i + ']: ' + s.substring(0,300)));
// Find product image in sk
const skFigure = findAll(sk, 'product__figure', 400);
skFigure.forEach((s,i) => console.log('figure[' + i + ']: ' + s.substring(0,400)));

// ===== Μασούτης price details =====
console.log('\n===== Μασούτης =====');
const mas = getHtml('mcp-firecrawl-mcp-firecrawl_scrape-1776169837111.txt');
// Full product card
const masCard = findAll(mas, 'class="product"', 1200, 1);
masCard.forEach((s,i) => console.log('card[' + i + ']: ' + s.substring(0,1200)));
// Price elements
const masPriceEl = findAll(mas, 'pDscntPrice', 300, 2);
masPriceEl.forEach((s,i) => console.log('pDscntPrice[' + i + ']: ' + s.substring(0,300)));
const masStartPrice = findAll(mas, 'pStartPrice', 300, 2);
masStartPrice.forEach((s,i) => console.log('pStartPrice[' + i + ']: ' + s.substring(0,300)));

// ===== Κρητικός img =====
console.log('\n===== Κρητικός =====');
const kr = getHtml('mcp-firecrawl-mcp-firecrawl_scrape-1776169774012.txt');
const krImg = findAll(kr, 'ProductListItem_productImage', 300, 2);
krImg.forEach((s,i) => console.log('img[' + i + ']: ' + s.substring(0,300)));
const krPrice = findAll(kr, 'finalPrice', 300, 2);
krPrice.forEach((s,i) => console.log('price[' + i + ']: ' + s.substring(0,300)));

// ===== MyMarket img =====
console.log('\n===== MyMarket =====');
const mm = getHtml('mcp-firecrawl-mcp-firecrawl_scrape-1776169810765.txt');
const mmTeaser = findAll(mm, 'product--teaser', 600, 1);
mmTeaser.forEach((s,i) => console.log('teaser[' + i + ']: ' + s.substring(0,600)));

// ===== Galaxias product cards =====
console.log('\n===== Γαλαξίας =====');
const gal = getHtml('mcp-firecrawl-mcp-firecrawl_scrape-1776169881243.txt');
// Look for any product-like structure
const galProductImgs = (gal.match(/src="https?:[^"]{10,200}(\.webp|\.jpg|\.png|\.jpeg)"/gi) || []);
console.log('All img URLs:', galProductImgs.slice(0, 10));
// Look for "price" text nearby
const galNgStar = findAll(gal, 'ng-star-inserted', 300, 5);
galNgStar.forEach((s,i) => { if (s.includes('€') || s.includes('img')) console.log('ngstar[' + i + ']: ' + s.substring(0,300)); });
// Look for euro sign
const galEuro = findAll(gal, '€', 200, 5);
galEuro.forEach((s,i) => console.log('€[' + i + ']: ' + s.substring(0,200)));
// Try to find any app-root content
const galRoot = findAll(gal, 'app-root', 500, 1);
galRoot.forEach((s,i) => console.log('approot: ' + s.substring(0,200)));

// ===== AB img check =====
console.log('\n===== AB img =====');
const ab = getHtml('mcp-firecrawl-mcp-firecrawl_scrape-1776169702497.txt');
const abImg = findAll(ab, 'data-testid="product-block-image"', 400, 2);
abImg.forEach((s,i) => console.log('img[' + i + ']: ' + s.substring(0,400)));
// Check price per unit vs package price
const abPriceEl = findAll(ab, 'product-block-price"', 400, 2);
abPriceEl.forEach((s,i) => console.log('price[' + i + ']: ' + s.substring(0,400)));
