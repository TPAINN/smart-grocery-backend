// services/recipeScraper.js
// ⚡ Lightweight: fetch + cheerio ONLY — no Puppeteer → ~30MB RAM (works on Render free 512MB)
// 🔍 Depth 3: Homepage → Categories → Subcategories → Recipes

const fetch   = (...args) => import('node-fetch').then(m => m.default(...args));
const cheerio = require('cheerio');
const Recipe  = require('../models/Recipe');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'el-GR,el;q=0.9,en;q=0.8',
};

// ─── Fetch HTML safely ────────────────────────────────────────────────────────
async function fetchHTML(url, timeout = 15000) {
  try {
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), timeout);
    const res  = await fetch(url, { headers: HEADERS, signal: ctrl.signal });
    clearTimeout(tid);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

// ─── Parse duration (PT1H30M → 90 min) ───────────────────────────────────────
function parseDuration(d) {
  if (!d) return 45;
  const m = d.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
  if (!m) return 45;
  return ((parseInt(m[1]) || 0) * 60) + (parseInt(m[2]) || 45);
}

// ─── Strip HTML entities ──────────────────────────────────────────────────────
function clean(t) {
  return (t || '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'").replace(/&deg;/g, '°')
    .replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

// ─── Deep search for Recipe in JSON-LD ────────────────────────────────────────
function findRecipe(obj) {
  if (!obj || typeof obj !== 'object') return null;
  if (Array.isArray(obj)) { for (const x of obj) { const r = findRecipe(x); if (r) return r; } return null; }
  const t = obj['@type'];
  if (t === 'Recipe' || (Array.isArray(t) && t.includes('Recipe'))) return obj;
  if (obj['@graph']) return findRecipe(obj['@graph']);
  for (const k of Object.keys(obj)) {
    if (typeof obj[k] === 'object') { const r = findRecipe(obj[k]); if (r) return r; }
  }
  return null;
}

// ─── Extract recipe data from HTML ────────────────────────────────────────────
function extractRecipe(html, url, chef) {
  const $ = cheerio.load(html);
  let rd  = null;

  $('script[type="application/ld+json"]').each((_, el) => {
    try { const r = findRecipe(JSON.parse($(el).html())); if (r) rd = r; } catch {}
  });

  if (!rd || !rd.name) return null;

  const title = clean(rd.name);
  if (!title) return null;

  let image = null;
  if (rd.image) {
    if (Array.isArray(rd.image))          image = rd.image[0]?.url || rd.image[0];
    else if (typeof rd.image === 'object') image = rd.image.url;
    else                                   image = rd.image;
  }

  const ingredients = (rd.recipeIngredient || []).map(clean).filter(Boolean);
  if (ingredients.length === 0) return null;

  let instructions = [];
  if (rd.recipeInstructions) {
    const raw = Array.isArray(rd.recipeInstructions) ? rd.recipeInstructions : [rd.recipeInstructions];
    instructions = raw.map(s => clean(s.text || s)).filter(Boolean);
  }

  const time = typeof rd.totalTime === 'string' ? parseDuration(rd.totalTime) : (rd.totalTime || 45);

  // Estimate cost from ingredients
  let cost = 0;
  ingredients.forEach(ing => {
    const t = ing.toLowerCase();
    if (t.includes('κρέας') || t.includes('κοτόπουλο') || t.includes('σολομ') || t.includes('κιμά') || t.includes('μοσχάρι')) cost += 3.5;
    else if (t.includes('τυρί') || t.includes('φέτα') || t.includes('βούτυρο') || t.includes('mascarpone')) cost += 1.5;
    else if (t.includes('λάδι') || t.includes('ελαιόλαδο')) cost += 0.8;
    else cost += 0.4;
  });

  const bodyText  = instructions.join(' ').toLowerCase();
  const hasOven   = bodyText.includes('φούρν') || bodyText.includes('ψήνουμε') || bodyText.includes('στους 1');
  const ovenMatch = bodyText.match(/στους?\s*(\d{3})/);

  return {
    title,
    chef,
    image: typeof image === 'string' ? image : null,
    time,
    calories: 420,
    cost: parseFloat(cost.toFixed(2)),
    isHealthy: cost < 8,
    isBudget:  cost < 10,
    ovenTemp:  hasOven ? (ovenMatch ? parseInt(ovenMatch[1]) : 180) : null,
    ovenTime:  hasOven ? Math.floor(time * 0.65) : null,
    ingredients,
    instructions,
    url,
  };
}

// ─── Collect links from HTML ───────────────────────────────────────────────────
function collectLinks($, base, pattern, seen = new Set()) {
  const links = new Set();
  $('a[href]').each((_, el) => {
    let href = $(el).attr('href') || '';
    if (href.startsWith('/')) href = base + href;
    if (!href.startsWith('http'))  return;
    if (href.includes('#'))        return;
    if (!href.includes(pattern))   return;
    if (href.includes('category') || href.includes('tag') || href.includes('?')) return;
    if (!seen.has(href)) links.add(href);
  });
  return links;
}

// ─── Main orchestrator — Depth 3 ──────────────────────────────────────────────
async function populateRecipes() {
  console.log('🚀 Recipe Scraper (fetch+cheerio, depth 3) ξεκινάει...');

  const BASE        = 'https://akispetretzikis.com';
  const CHEF        = 'Άκης Πετρετζίκης';
  const recipePattern = '/recipe/';
  const catPattern    = '/categories/';
  const MAX_CATS      = 6;   // depth 2 category pages
  const MAX_SUBCATS   = 12;  // depth 3 subcategory pages
  const MAX_RECIPES   = 40;  // total recipes per run

  const recipeLinks = new Set();
  const seen        = new Set();

  // ── DEPTH 1: Homepage ─────────────────────────────────────────────────────
  console.log('  🌐 [Depth 1] Σκανάρω homepage...');
  const homeHTML = await fetchHTML(BASE);
  if (!homeHTML) { console.error('  ❌ Αποτυχία φόρτωσης homepage'); return; }
  const $home = cheerio.load(homeHTML);

  const catLinks = new Set();
  $home('a[href]').each((_, el) => {
    let href = $home(el).attr('href') || '';
    if (href.startsWith('/')) href = BASE + href;
    if (href.includes(recipePattern) && !href.includes('#')) recipeLinks.add(href);
    if (href.includes(catPattern)    && !href.includes('#')) catLinks.add(href);
  });
  console.log(`  ✅ Βρέθηκαν ${catLinks.size} κατηγορίες, ${recipeLinks.size} συνταγές`);

  // ── DEPTH 2: Category pages ───────────────────────────────────────────────
  const subCatLinks = new Set();
  const targetCats  = Array.from(catLinks).slice(0, MAX_CATS);

  for (const catUrl of targetCats) {
    await sleep(600);
    console.log(`  📂 [Depth 2] ${catUrl.replace(BASE, '')}`);
    const html = await fetchHTML(catUrl);
    if (!html) continue;
    const $  = cheerio.load(html);
    const rl = collectLinks($, BASE, recipePattern, seen);
    const sl = collectLinks($, BASE, catPattern,    seen);
    rl.forEach(l => recipeLinks.add(l));
    sl.forEach(l => { if (!catLinks.has(l)) subCatLinks.add(l); });
    console.log(`     → +${rl.size} συνταγές, +${sl.size} subcategories`);
  }

  // ── DEPTH 3: Subcategory pages ────────────────────────────────────────────
  const targetSubs = Array.from(subCatLinks).slice(0, MAX_SUBCATS);

  for (const subUrl of targetSubs) {
    await sleep(600);
    console.log(`  📁 [Depth 3] ${subUrl.replace(BASE, '')}`);
    const html = await fetchHTML(subUrl);
    if (!html) continue;
    const $ = cheerio.load(html);
    const rl = collectLinks($, BASE, recipePattern, seen);
    rl.forEach(l => recipeLinks.add(l));
    console.log(`     → +${rl.size} συνταγές`);
  }

  // ── ΕΞΑΓΩΓΗ: Scrape each recipe page ──────────────────────────────────────
  const finalLinks = Array.from(recipeLinks).slice(0, MAX_RECIPES);
  console.log(`\n  ⏳ Εξαγωγή από ${finalLinks.length} συνταγές...`);

  let saved = 0, skipped = 0, errors = 0;

  for (const url of finalLinks) {
    await sleep(700);
    try {
      const existing = await Recipe.findOne({ url });
      if (existing) { skipped++; continue; }

      const html = await fetchHTML(url, 20000);
      if (!html) { errors++; continue; }

      const data = extractRecipe(html, url, CHEF);
      if (!data) { errors++; continue; }

      await Recipe.create(data);
      saved++;
      console.log(`  💾 [${saved}] ${data.title.substring(0, 40)} (${data.ingredients.length} υλικά, ~${data.cost}€)`);
    } catch (err) {
      errors++;
      console.error(`  ⚠️  ${url}: ${err.message}`);
    }
  }

  console.log(`\n🎉 ΤΕΛΟΣ! Αποθηκεύτηκαν: ${saved} | Υπήρχαν: ${skipped} | Σφάλματα: ${errors}`);
}

module.exports = { populateRecipes };