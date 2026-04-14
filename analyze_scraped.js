const fs = require('fs');
const base = 'C:/Users/User/.claude/projects/C--Users-User-Documents-GitHub/f086445e-b123-4ccd-9657-9cb39e93469a/tool-results/';

const files = {
  'AB': 'mcp-firecrawl-mcp-firecrawl_scrape-1776169702497.txt',
  'Sklavenitis': 'mcp-firecrawl-mcp-firecrawl_scrape-1776169736381.txt',
  'Kritikos': 'mcp-firecrawl-mcp-firecrawl_scrape-1776169774012.txt',
  'MyMarket': 'mcp-firecrawl-mcp-firecrawl_scrape-1776169810765.txt',
  'Masoutis': 'mcp-firecrawl-mcp-firecrawl_scrape-1776169837111.txt',
  'MarketIn': 'mcp-firecrawl-mcp-firecrawl_scrape-1776169852523.txt',
  'Galaxias': 'mcp-firecrawl-mcp-firecrawl_scrape-1776169881243.txt',
  'Lidl': 'mcp-firecrawl-mcp-firecrawl_scrape-1776169923954.txt',
};

for (const [name, file] of Object.entries(files)) {
  const raw = fs.readFileSync(base + file, 'utf8');
  // Files are JSON arrays: [{type,text}]
  let html = '';
  try {
    const arr = JSON.parse(raw);
    const combinedText = arr.map(x => x.text || '').join('\n');
    // The text field itself contains a JSON object: {"rawHtml": "..."}
    try {
      const inner = JSON.parse(combinedText);
      html = inner.rawHtml || inner.html || combinedText;
    } catch(e2) {
      html = combinedText;
    }
  } catch(e) {
    html = raw;
  }

  console.log('\n========== ' + name + ' ==========');
  console.log('HTML length:', html.length);

  // Find class attributes
  const classMatches = html.match(/class="[^"]{0,100}"/g) || [];
  const classUniq = [...new Set(classMatches)].filter(m => /product|price|title|card|item|teaser|grid|odsc|tile|badge/i.test(m));
  console.log('--- Relevant class attrs (' + classUniq.length + ' unique) ---');
  classUniq.slice(0, 25).forEach(m => console.log('  ' + m));

  // Find data-testid attributes
  const testidMatches = html.match(/data-testid="[^"]*"/g) || [];
  const testidUniq = [...new Set(testidMatches)].filter(m => /product|price|name|brand|image/i.test(m));
  if (testidUniq.length) {
    console.log('--- data-testid attrs (' + testidUniq.length + ' unique) ---');
    testidUniq.slice(0, 20).forEach(m => console.log('  ' + m));
  }

  // Find img src patterns
  const imgMatches = html.match(/src="https?:[^"]{5,150}"/g) || [];
  const imgUniq = [...new Set(imgMatches)].slice(0, 5);
  if (imgUniq.length) {
    console.log('--- img src examples ---');
    imgUniq.forEach(m => console.log('  ' + m));
  }

  // Find data-grid-data for Lidl
  if (name === 'Lidl') {
    const gridData = html.match(/data-grid-data="[^"]{0,200}"/g) || [];
    if (gridData.length) {
      console.log('--- data-grid-data present:', gridData.length, 'tiles ---');
      console.log('  Example:', gridData[0].substring(0, 150));
    } else {
      console.log('--- NO data-grid-data found ---');
    }
  }
}
