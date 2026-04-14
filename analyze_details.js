const fs = require('fs');
const base = 'C:/Users/User/.claude/projects/C--Users-User-Documents-GitHub/f086445e-b123-4ccd-9657-9cb39e93469a/tool-results/';

function getHtml(filename) {
  const raw = fs.readFileSync(base + filename, 'utf8');
  try {
    const arr = JSON.parse(raw);
    const text = arr.map(x => x.text || '').join('\n');
    try {
      const inner = JSON.parse(text);
      return inner.rawHtml || inner.html || text;
    } catch(e) { return text; }
  } catch(e) { return raw; }
}

function findSnippet(html, pattern, contextChars=300) {
  const idx = html.indexOf(pattern);
  if (idx === -1) return null;
  return html.substring(Math.max(0, idx-50), idx+contextChars);
}

// ===== AB =====
console.log('\n===== AB Βασιλόπουλος =====');
const ab = getHtml('mcp-firecrawl-mcp-firecrawl_scrape-1776169702497.txt');
const abSnip = findSnippet(ab, 'data-testid="product-block"', 600);
console.log(abSnip ? abSnip.substring(0, 800) : 'NOT FOUND');
// Check image in AB
const abImgSnip = findSnippet(ab, 'data-testid="product-block-image"', 300);
console.log('  Image: ' + (abImgSnip ? abImgSnip.substring(0, 300) : 'NOT FOUND'));

// ===== Σκλαβενίτης =====
console.log('\n===== Σκλαβενίτης =====');
const sk = getHtml('mcp-firecrawl-mcp-firecrawl_scrape-1776169736381.txt');
const skSnip = findSnippet(sk, 'class="product ', 800);
console.log(skSnip ? skSnip.substring(0, 800) : 'NOT FOUND');

// ===== Κρητικός =====
console.log('\n===== Κρητικός =====');
const kr = getHtml('mcp-firecrawl-mcp-firecrawl_scrape-1776169774012.txt');
const krSnip = findSnippet(kr, 'ProductListItem_productItem', 600);
console.log(krSnip ? krSnip.substring(0, 700) : 'NOT FOUND');

// ===== MyMarket =====
console.log('\n===== MyMarket =====');
const mm = getHtml('mcp-firecrawl-mcp-firecrawl_scrape-1776169810765.txt');
const mmSnip = findSnippet(mm, 'product--teaser', 600);
console.log(mmSnip ? mmSnip.substring(0, 700) : 'NOT FOUND');

// ===== Μασούτης =====
console.log('\n===== Μασούτης =====');
const mas = getHtml('mcp-firecrawl-mcp-firecrawl_scrape-1776169837111.txt');
// Look for actual product card
const masSnip = findSnippet(mas, 'class="product"', 800);
console.log(masSnip ? masSnip.substring(0, 900) : 'NOT FOUND - trying productTitle');
const masSnip2 = findSnippet(mas, 'class="productTitle"', 400);
console.log('productTitle: ' + (masSnip2 ? masSnip2.substring(0, 400) : 'NOT FOUND'));
// Check for pDscntPrice
const masPrice = findSnippet(mas, 'pDscntPrice', 200);
console.log('pDscntPrice: ' + (masPrice ? masPrice.substring(0, 200) : 'NOT FOUND'));
const masDiscPrice = findSnippet(mas, 'discountPrice', 200);
console.log('discountPrice: ' + (masDiscPrice ? masDiscPrice.substring(0, 200) : 'NOT FOUND'));
const masProductImage = findSnippet(mas, 'class="productImage"', 200);
console.log('productImage: ' + (masProductImage ? masProductImage.substring(0, 200) : 'NOT FOUND'));

// ===== Market In =====
console.log('\n===== Market In =====');
const mkt = getHtml('mcp-firecrawl-mcp-firecrawl_scrape-1776169852523.txt');
const mktSnip = findSnippet(mkt, 'class="product-item"', 600);
console.log(mktSnip ? mktSnip.substring(0, 700) : 'NOT FOUND');
const mktImg = findSnippet(mkt, 'class="product-thumb"', 200);
console.log('product-thumb: ' + (mktImg ? mktImg.substring(0, 250) : 'NOT FOUND'));

// ===== Γαλαξίας =====
console.log('\n===== Γαλαξίας =====');
const gal = getHtml('mcp-firecrawl-mcp-firecrawl_scrape-1776169881243.txt');
// Look for any img with galaxias CDN
const galImgMatches = gal.match(/src="[^"]*(?:galaxias|product|item)[^"]*\.(jpg|png|webp|jpeg)"/gi) || [];
console.log('Product img URLs:', galImgMatches.slice(0, 5));
// Look for price-related content
const galPrice = findSnippet(gal, 'price', 300);
console.log('price context:', galPrice ? galPrice.substring(0, 300) : 'NOT FOUND');
// Find product wrapper
const galClasses = gal.match(/class="[^"]{0,120}"/g) || [];
const galUniq = [...new Set(galClasses)];
console.log('All classes:', galUniq.slice(0, 50).join('\n'));

// ===== Lidl =====
console.log('\n===== Lidl =====');
const lidl = getHtml('mcp-firecrawl-mcp-firecrawl_scrape-1776169923954.txt');
const lidlTile = findSnippet(lidl, 'odsc-tile odsc-tile--', 600);
console.log(lidlTile ? lidlTile.substring(0, 700) : 'NOT FOUND');
// Check if s-load-more button present
const lidlMore = findSnippet(lidl, 's-load-more', 200);
console.log('s-load-more: ' + (lidlMore ? lidlMore.substring(0, 200) : 'NOT FOUND'));
