/**
 * tests/scraping-regression.js
 * Playwright scraping regression tests — run after every scrape to detect
 * HTML structure changes in supermarket sites before they corrupt the DB.
 *
 * Run: npx playwright install chromium && node tests/scraping-regression.js
 * Or:  npm run test:scraping
 *
 * Exit 0 = all selectors still valid
 * Exit 1 = at least one site has broken structure (Slack/email alert in CI)
 */
const { chromium } = require('playwright');

// ── Selector contracts per site ───────────────────────────────────────────────
// Update these ONLY when a site intentionally changes structure.
const SITE_CONTRACTS = [
  {
    name:  'Lidl GR — Offers',
    url:   'https://www.lidl.gr/prosfores',
    checks: [
      { selector: 'article, .offer-item, .product-item, [class*="product"]', minCount: 3, label: 'Product cards present' },
      { selector: 'img',                                                       minCount: 3, label: 'Images loading' },
    ],
  },
  {
    name:  'AB Βασιλόπουλος — Προσφορές',
    url:   'https://www.ab.gr/prosfores',
    checks: [
      { selector: '[class*="product"], .product-card, article', minCount: 3, label: 'Product cards present' },
      { selector: 'img[src]',                                    minCount: 3, label: 'Images loading' },
    ],
  },
  {
    name:  'Σκλαβενίτης — Προσφορές',
    url:   'https://www.sklavenitis.gr/prosfores/',
    checks: [
      { selector: '[class*="product"], .product-tile, article',  minCount: 3, label: 'Product cards present' },
      { selector: 'img',                                          minCount: 3, label: 'Images loading' },
    ],
  },
  {
    name:  'My Market — Φυλλάδιο',
    url:   'https://www.mymarket.gr/prosfores',
    checks: [
      { selector: '[class*="product"], .item, article',           minCount: 3, label: 'Product cards present' },
    ],
  },
];

// ── Runner ────────────────────────────────────────────────────────────────────
async function runTests() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
  });

  let passed = 0;
  let failed = 0;
  const failures = [];

  for (const site of SITE_CONTRACTS) {
    const page = await context.newPage();
    console.log(`\n🔍 Testing: ${site.name}`);
    console.log(`   URL: ${site.url}`);

    try {
      await page.goto(site.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      // Wait a moment for JS-rendered content
      await page.waitForTimeout(3000);

      for (const check of site.checks) {
        const count = await page.locator(check.selector).count();
        const ok = count >= check.minCount;
        if (ok) {
          console.log(`   ✅ ${check.label} (found ${count})`);
          passed++;
        } else {
          console.log(`   ❌ ${check.label} — expected ≥${check.minCount}, got ${count}`);
          failed++;
          failures.push({ site: site.name, check: check.label, expected: check.minCount, got: count });
        }
      }
    } catch (err) {
      console.log(`   ❌ Navigation failed: ${err.message}`);
      failed++;
      failures.push({ site: site.name, check: 'Page load', expected: 'success', got: err.message });
    } finally {
      await page.close();
    }
  }

  await browser.close();

  console.log(`\n${'─'.repeat(55)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);

  if (failures.length > 0) {
    console.log('\n⚠️  FAILURES — scraper selectors may be broken:');
    failures.forEach(f => console.log(`  • [${f.site}] ${f.check}: expected ${f.expected}, got ${f.got}`));
    process.exit(1);
  } else {
    console.log('✅ All selector contracts valid — safe to scrape.');
    process.exit(0);
  }
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
