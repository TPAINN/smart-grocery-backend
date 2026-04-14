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
    results.push(html.substring(Math.max(0, idx-100), idx+contextChars));
    pos = idx + 1;
  }
  return results;
}

// ===== Galaxias - find product card wrapper =====
console.log('\n===== Γαλαξίας card discovery =====');
const gal = getHtml('mcp-firecrawl-mcp-firecrawl_scrape-1776169881243.txt');
// Wide context around price
const galPriceCtx = findAll(gal, 'rgb(2, 88, 165)', 800, 2);
galPriceCtx.forEach((s,i) => console.log('price_ctx[' + i + ']: ' + s.substring(0,900)));

// Look for app- components
const galApp = (gal.match(/<app-[a-zA-Z-]+ /g) || []);
console.log('\nAngular components found:', [...new Set(galApp)].slice(0, 20));

// Look for product-related classes
const galProdClasses = (gal.match(/class="[^"]{0,60}(?:product|card|item|tile)[^"]{0,60}"/g) || []);
console.log('\nProduct class attrs:', [...new Set(galProdClasses)].slice(0, 15));

// ===== Masoutis - full price area =====
console.log('\n===== Μασούτης full price card =====');
const mas = getHtml('mcp-firecrawl-mcp-firecrawl_scrape-1776169837111.txt');
// Wider context of product card
const masFullCard = findAll(mas, 'class="product"', 2000, 1);
masFullCard.forEach((s,i) => console.log('full_card[' + i + ']: ' + s.substring(0,2000)));

// ===== Sklavenitis - name selector verification =====
console.log('\n===== Σκλαβενίτης name check =====');
const sk = getHtml('mcp-firecrawl-mcp-firecrawl_scrape-1776169736381.txt');
const skTitle = findAll(sk, 'product__title', 300, 2);
skTitle.forEach((s,i) => console.log('title[' + i + ']: ' + s.substring(0,300)));
// Find priceWrp to understand old price
const skOldPrice = findAll(sk, 'priceWrp', 500, 2);
skOldPrice.forEach((s,i) => console.log('priceWrp[' + i + ']: ' + s.substring(0,500)));

// ===== AB promo tag check =====
console.log('\n===== AB promo =====');
const ab = getHtml('mcp-firecrawl-mcp-firecrawl_scrape-1776169702497.txt');
const abPromo = findAll(ab, 'tag-promo', 200, 2);
abPromo.forEach((s,i) => console.log('promo[' + i + ']: ' + s.substring(0,200)));

// ===== MyMarket img =====
console.log('\n===== MyMarket img =====');
const mm = getHtml('mcp-firecrawl-mcp-firecrawl_scrape-1776169810765.txt');
const mmImg = findAll(mm, 'teaser-image-container', 300, 2);
mmImg.forEach((s,i) => console.log('img_container[' + i + ']: ' + s.substring(0,300)));
// Find cdn.mymarket.gr images
const mmCdnImgs = (mm.match(/src="https?:\/\/cdn\.mymarket\.gr[^"]+\.(jpg|png|webp|jpeg|gif)"/gi) || []);
console.log('cdn.mymarket.gr imgs:', mmCdnImgs.slice(0, 5));
