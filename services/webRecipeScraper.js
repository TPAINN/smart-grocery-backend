// services/webRecipeScraper.js
// Scrapes Greek recipe sites: Akis, Panos Ioannidis, GymBeam, NutriRoots
// Uses Puppeteer (same install as grocery scraper — no extra deps needed)

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const Recipe = require('../models/Recipe');

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Strip HTML tags, decode entities, collapse whitespace */
function cleanStr(raw) {
    if (!raw || typeof raw !== 'string') return '';
    return raw
        .replace(/<[^>]*>/g, ' ')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"')
        .replace(/&#\d+;/g, '').replace(/&[a-z]+;/g, '')
        .replace(/\s{2,}/g, ' ').trim();
}

/** ISO 8601 duration → minutes (e.g. "PT1H30M" → 90) */
function parseDuration(iso) {
    if (!iso) return null;
    const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?/i);
    if (!m) return null;
    return (parseInt(m[1] || 0) * 60) + parseInt(m[2] || 0);
}

function getDifficulty(minutes, ingCount) {
    if (!minutes) return 'Μέτρια';
    if (minutes <= 20 && ingCount <= 6)  return 'Εύκολη';
    if (minutes <= 45 && ingCount <= 12) return 'Μέτρια';
    return 'Δύσκολη';
}

function mapCategory(hints = []) {
    const t = hints.join(' ').toLowerCase();
    if (/πρωιν|breakfast/i.test(t))                        return 'Πρωινό';
    if (/σαλατ/i.test(t))                                   return 'Σαλάτες';
    if (/σουπ/i.test(t))                                    return 'Σούπες';
    if (/σνακ|snack/i.test(t))                              return 'Σνακ';
    if (/επιδορπ|γλυκ|dessert|κεικ|cake|μπισκοτ/i.test(t)) return 'Επιδόρπια';
    if (/συνοδευτ/i.test(t))                                return 'Συνοδευτικά';
    if (/ροφημ|smoothie|shake|drink/i.test(t))              return 'Ροφήματα';
    return 'Κυρίως';
}

function buildTags(r) {
    const tags = [];
    if ((r.protein  || 0) > 25)  tags.push('high-protein');
    if ((r.calories || 0) < 400) tags.push('healthy');
    if ((r.carbs    || 999) < 15) tags.push('low-carb');
    if ((r.fat      || 999) < 8)  tags.push('low-fat');
    if ((r.fiber    || 0) > 5)   tags.push('high-fiber');
    if (r.time && r.time <= 25)  tags.push('quick');
    return [...new Set(tags)];
}

function delay(ms) {
    return new Promise(r => setTimeout(r, ms));
}

async function launchBrowser() {
    return puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled'],
    });
}

// ── SITE 1: Άκης Πετρετζίκης ─────────────────────────────────────────────────
// Strategy: JSON-LD (has everything: ingredients, steps, macros, time, servings)
//
// NOTE: Cloudflare blocks listing/API pages in headless mode.
// Solution: seed from known recipe URLs + explore related recipe links per page.
// Individual recipe pages bypass Cloudflare fine via Puppeteer stealth.

// Known seed URLs harvested from public sources — enough to bootstrap
const AKIS_SEED_URLS = [
    'https://akispetretzikis.com/recipe/9663/thgania-agriwn-manitariwn',
    'https://akispetretzikis.com/recipe/9660/ta-pio-soft-cookies',
    'https://akispetretzikis.com/recipe/9657/choirino-prasoselino-sth-chytra-tachythtas',
    'https://akispetretzikis.com/recipe/9654/healthy-tourta-me-granola',
    'https://akispetretzikis.com/recipe/9653/zymarika-me-tyri-krema-kai-kapnisto-solomo',
    'https://akispetretzikis.com/recipe/9649/spanakoryzo-me-trachana',
    'https://akispetretzikis.com/recipe/9644/cookies-karamela',
    'https://akispetretzikis.com/recipe/9634/cake-me-taxini',
    'https://akispetretzikis.com/recipe/6174/thgania-manitariwn',
];

async function getAkisLinks(page, max) {
    const links = new Set(AKIS_SEED_URLS);

    // From each seed page, harvest any related/suggested recipe links
    for (const seedUrl of AKIS_SEED_URLS) {
        if (links.size >= max) break;
        try {
            await page.goto(seedUrl, { waitUntil: 'networkidle2', timeout: 30000 });
            // Wait a bit for React to render related recipes section
            await delay(2500);
            const found = await page.$$eval(
                'a[href*="/recipe/"]',
                els => [...new Set(els.map(el => el.href).filter(h => /\/recipe\/\d+\//.test(h)))]
            );
            found.forEach(l => links.add(l));
        } catch (e) {
            console.error(`  ⚠️  Akis seed crawl ${seedUrl}:`, e.message);
        }
    }

    return [...links].slice(0, max);
}

async function parseAkisRecipe(page, url) {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

    return page.evaluate(() => {
        const ld = [...document.querySelectorAll('script[type="application/ld+json"]')]
            .map(s => { try { return JSON.parse(s.textContent); } catch { return null; } })
            .filter(Boolean)
            .find(l => l['@type'] === 'Recipe');
        if (!ld) return null;

        const clean = s => (s || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&[a-z]+;/g, '').trim();

        // Macros from the nutrition section (flat text with pattern: "714Θερμίδες 42Λιπαρά...")
        const nutEl = document.querySelector('[class*="nutrition"]');
        const nt = nutEl?.innerText || '';
        const cal    = parseFloat(nt.match(/(\d+(?:\.\d+)?)\s*Θερμίδ/i)?.[1])    || null;
        const fat    = parseFloat(nt.match(/(\d+(?:\.\d+)?)\s*Λιπαρά/i)?.[1])    || null;
        const carbs  = parseFloat(nt.match(/(\d+(?:\.\d+)?)\s*Υδατ/i)?.[1])      || null;
        const protein= parseFloat(nt.match(/(\d+(?:\.\d+)?)\s*Πρωτεΐνη/i)?.[1])  || null;
        const fiber  = parseFloat(nt.match(/(\d+(?:\.\d+)?)\s*Φυτικές/i)?.[1])   || null;

        return {
            title:        ld.name,
            description:  clean(ld.description).substring(0, 300),
            image:        Array.isArray(ld.image) ? ld.image[0] : (ld.image || ''),
            servings:     parseInt(ld.recipeYield) || 4,
            timeRaw:      ld.totalTime || ld.cookTime || ld.prepTime,
            ingredients:  (ld.recipeIngredient || []).map(clean).filter(Boolean),
            instructions: (ld.recipeInstructions || []).map(s => clean(s.text || s)).filter(s => s.length > 5),
            cuisine:      ld.recipeCuisine || 'Ελληνική',
            keywords:     Array.isArray(ld.keywords) ? ld.keywords : String(ld.keywords || '').split(',').map(k => k.trim()).filter(Boolean),
            calories: cal, fat, carbs, protein, fiber,
        };
    });
}

// ── SITE 2: Πάνος Ιωαννίδης ──────────────────────────────────────────────────
// Strategy: DOM — .recipe-ingredient, .recipe-content, .nutri-fact, og:image

async function getPanosLinks(page, max) {
    const links = new Set();
    let pageNum = 1;
    while (links.size < max && pageNum <= 4) {
        try {
            const url = pageNum === 1
                ? 'https://www.panosioannidis.com/syntages/'
                : `https://www.panosioannidis.com/syntages/page/${pageNum}/`;
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
            const found = await page.$$eval(
                'a[href*="/recipe/"]',
                els => [...new Set(els.map(el => el.href).filter(h => h.includes('/recipe/')))]
            );
            if (!found.length) break;
            found.forEach(l => links.add(l));
            pageNum++;
        } catch (e) {
            console.error(`  ⚠️  Panos page ${pageNum}:`, e.message);
            break;
        }
    }
    return [...links].slice(0, max);
}

async function parsePanosRecipe(page, url) {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

    return page.evaluate(() => {
        const title = document.querySelector('h1')?.innerText?.trim();
        if (!title) return null;

        const image = document.querySelector('meta[property="og:image"]')?.content || '';

        // Ingredients — each .recipe-ingredient has "qty\nname" innerText
        const ingredients = [...document.querySelectorAll('.recipe-ingredient')]
            .map(el => el.innerText.trim().replace(/\s+/g, ' '))
            .filter(s => s.length > 1);

        // Instructions — .recipe-content free text, split to sentences
        const contentText = document.querySelector('.recipe-content')?.innerText || '';
        const allLines = contentText.split('\n').map(s => s.trim()).filter(s => s.length > 20);

        // Macros — each .nutri-fact has "label\nVALUEunit\n%"
        const macroMap = {};
        [...document.querySelectorAll('.nutri-fact')].forEach(el => {
            const t = el.innerText;
            const num = parseFloat(t.match(/(\d+(?:\.\d+)?)/)?.[1]);
            if (!num) return;
            if (/θερμίδ|kcal/i.test(t))                    macroMap.calories = num;
            else if (/πρωτεΐν/i.test(t))                   macroMap.protein  = num;
            else if (/υδατάνθρ/i.test(t))                  macroMap.carbs    = num;
            else if (/λιπαρ/i.test(t) && !/κορεσ/.test(t)) macroMap.fat     = num;
            else if (/φυτικ/i.test(t))                     macroMap.fiber    = num;
        });

        // Time — sum prep + cook minutes
        let totalTime = 0;
        [...document.querySelectorAll('[class*="recipe-time"]')].forEach(el => {
            const m = el.innerText.match(/(\d+)'/);
            if (m) totalTime += parseInt(m[1]);
        });

        // Servings
        const servText = document.querySelector('[class*="recipe-yield"], [class*="portion"]')?.innerText || '';
        const servings = parseInt(servText.match(/(\d+)/)?.[1]) || 2;

        const description = allLines.shift() || '';

        return {
            title,
            description,
            image,
            servings,
            time: totalTime || null,
            ingredients,
            instructions: allLines,
            ...macroMap,
        };
    });
}

// ── SITE 3: GymBeam ───────────────────────────────────────────────────────────
// Strategy: DOM — .e-content text parsing, <table> macros, img.u-featured

async function getGymBeamLinks(page, max) {
    const links = new Set();
    let pageNum = 1;
    while (links.size < max && pageNum <= 3) {
        try {
            const url = pageNum === 1
                ? 'https://gymbeam.gr/blog/fitness-suntages/'
                : `https://gymbeam.gr/blog/fitness-suntages/page/${pageNum}/`;
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

            // Wait for at least one article to render (WordPress blog — no heavy JS)
            await page.waitForSelector('article', { timeout: 8000 }).catch(() => {});

            // Try multiple selectors — WordPress themes differ
            const found = await page.evaluate(() => {
                const hrefs = new Set();
                // Primary: u-url anchor inside articles
                document.querySelectorAll('article a.u-url, article a.entry-title-link').forEach(a => hrefs.add(a.href));
                // Fallback: any link inside article that goes to /blog/
                document.querySelectorAll('article a[href*="/blog/"]').forEach(a => {
                    if (a.href && !a.href.endsWith('/blog/') && !a.href.includes('/category/')
                        && !a.href.includes('/page/') && !a.href.endsWith('/fitness-suntages/')) {
                        hrefs.add(a.href);
                    }
                });
                // Fallback 2: heading links
                document.querySelectorAll('article h2 a, article h3 a').forEach(a => hrefs.add(a.href));
                return [...hrefs].filter(Boolean);
            });

            if (!found.length) break;
            found.forEach(l => links.add(l));
            pageNum++;
        } catch (e) {
            console.error(`  ⚠️  GymBeam page ${pageNum}:`, e.message);
            break;
        }
    }
    return [...links].slice(0, max);
}

async function parseGymBeamRecipe(page, url) {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

    return page.evaluate(() => {
        const title = document.querySelector('h1')?.innerText?.trim();
        if (!title) return null;
        // Skip non-recipe posts (GymBeam blog has mixed content)
        if (!/συνταγ/i.test(title) && !/υλικ|θα χρει/i.test(document.body.innerText.substring(0, 2000))) return null;

        const content = document.querySelector('.e-content, .entry-content, .post-content');
        const fullText = content?.innerText || '';

        // ── Parse ingredients & instructions from text ──────────────────────
        const ING_MARKERS  = ['Θα χρειαστούμε:', 'Θα χρειαστούμε', 'Υλικά:', 'Υλικά', 'Συστατικά:'];
        const EXEC_MARKERS = ['Οδηγίες:', 'Οδηγίες', 'Εκτέλεση:', 'Εκτέλεση', 'Παρασκευή:', 'Παρασκευή'];

        let ingText = '', execText = '';
        let ingIdx = -1;

        for (const kw of ING_MARKERS) {
            ingIdx = fullText.indexOf(kw);
            if (ingIdx > -1) { ingIdx += kw.length; break; }
        }

        if (ingIdx > -1) {
            let execIdx = fullText.length;
            for (const ek of EXEC_MARKERS) {
                const ei = fullText.indexOf(ek, ingIdx);
                if (ei > -1 && ei < execIdx) {
                    execIdx = ei;
                    execText = fullText.substring(ei + EXEC_MARKERS.find(m => fullText.startsWith(m, ei))?.length + 1 || ei + 10);
                }
            }
            ingText = fullText.substring(ingIdx, execIdx);
        }

        const ingredients = ingText.split('\n')
            .map(s => s.trim())
            .filter(s => s.length > 1 && s.length < 100 && !s.includes('€') && !/^(GymBeam|BIO [A-Z]|Από \d)/.test(s));

        // Split instructions at sentence boundaries
        const instructions = (execText || fullText.split('\n\n').slice(1).join('\n'))
            .split(/(?<=[.!?])\s+|\n/)
            .map(s => s.trim())
            .filter(s => s.length > 25);

        // ── Parse macros from table ─────────────────────────────────────────
        const macroMap = {};
        let servings = 1;

        document.querySelectorAll('table tr').forEach((row, i) => {
            const t = row.innerText;
            if (i === 0) {
                const sm = t.match(/ΣΥΝΟΛΙΚΑ\s+(\d+)|(\d+)\s+ΜΕΡΙΔ/i);
                if (sm) servings = parseInt(sm[1] || sm[2]);
            }
            const num = (re) => parseFloat(t.match(re)?.[1]) || null;
            if (num(/Ενεργειακ[^0-9]*(\d+)/i))            macroMap.calories = num(/Ενεργειακ[^0-9]*(\d+)/i);
            if (num(/Πρωτεΐν[^0-9]*(\d+(?:\.\d+)?)/i))   macroMap.protein  = num(/Πρωτεΐν[^0-9]*(\d+(?:\.\d+)?)/i);
            if (num(/Υδατάνθρακ[^0-9]*(\d+(?:\.\d+)?)/i)) macroMap.carbs   = num(/Υδατάνθρακ[^0-9]*(\d+(?:\.\d+)?)/i);
            if (num(/Λιπαρ[^0-9]*(\d+(?:\.\d+)?)/i))      macroMap.fat     = num(/Λιπαρ[^0-9]*(\d+(?:\.\d+)?)/i);
            if (num(/Φυτικές[^0-9]*(\d+(?:\.\d+)?)/i))    macroMap.fiber   = num(/Φυτικές[^0-9]*(\d+(?:\.\d+)?)/i);
        });

        const img    = document.querySelector('img.u-featured, img[class*="featured"]');
        const ogImg  = document.querySelector('meta[property="og:image"]')?.content;
        const description = fullText.split('\n\n')[0]?.trim().substring(0, 300) || '';

        return {
            title,
            description,
            image:    img?.src || ogImg || '',
            servings: servings || 1,
            ingredients,
            instructions,
            ...macroMap,
        };
    });
}

// ── SITE 4: NutriRoots (WordPress) ────────────────────────────────────────────
// Strategy: JSON-LD when available (WP Recipe plugins emit it), DOM fallback
// Listing page: /recipes/  —  recipe URLs: /συνταγές/slug/

const WP_SITES = {
    nutriroots: {
        label: 'NutriRoots',
        listUrls: ['https://www.nutriroots.gr/recipes/'],
        // Recipe links are under /συνταγές/ (URL-encoded %cf%83%cf%85%ce%bd%cf%84%ce%b1%ce%b3%ce%ad%cf%82)
        linkSelector: 'a[href*="nutriroots.gr"]',
        linkFilter: h => h.includes('nutriroots.gr/')
                      && (h.includes('%cf%83%cf%85%ce%bd%cf%84%ce%b1%ce%b3') || h.includes('/συνταγές/'))
                      && !h.endsWith('/recipes/')
                      && !h.includes('/category/')
                      && !h.includes('/tag/')
                      && !h.includes('/page/'),
    },
};

async function getWpLinks(page, siteKey, max) {
    const cfg = WP_SITES[siteKey];
    const links = new Set();

    for (const listUrl of cfg.listUrls) {
        if (links.size >= max) break;
        try {
            await page.goto(listUrl, { waitUntil: 'networkidle2', timeout: 30000 });

            // Dismiss cookie popup if present
            for (const sel of ['.cmplz-accept', '.cookiebot-accept', '#acceptBtn', 'button[class*="accept"]']) {
                const btn = await page.$(sel);
                if (btn) { await btn.click(); await delay(600); break; }
            }

            const found = await page.$$eval(
                cfg.linkSelector,
                (els, filterSrc) => {
                    const fn = new Function('h', `return (${filterSrc})(h);`);
                    return [...new Set(els.map(el => el.href))].filter(h => {
                        try { return fn(h); } catch { return false; }
                    });
                },
                cfg.linkFilter.toString()
            );
            found.forEach(l => links.add(l));
        } catch (e) {
            console.error(`  ⚠️  ${cfg.label} links error:`, e.message);
        }
    }
    return [...links].slice(0, max);
}

async function parseWpRecipe(page, url) {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

    return page.evaluate(() => {
        // ── Try JSON-LD first (WP Recipe plugins output this) ──────────────
        const ld = [...document.querySelectorAll('script[type="application/ld+json"]')]
            .map(s => { try { return JSON.parse(s.textContent); } catch { return null; } })
            .filter(Boolean)
            .find(l => l['@type'] === 'Recipe' || l['@graph']?.find?.(n => n['@type'] === 'Recipe'));

        const recipe = ld?.['@type'] === 'Recipe' ? ld : ld?.['@graph']?.find(n => n['@type'] === 'Recipe');
        const clean = s => (s || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();

        const title = document.querySelector('h1')?.innerText?.trim();
        const ogImg = document.querySelector('meta[property="og:image"]')?.content;
        const postImg = document.querySelector('.wp-post-image, .post-thumbnail img, img[class*="attachment-large"]');

        if (recipe) {
            // Full data from JSON-LD
            const nutri = recipe.nutrition || {};
            return {
                title:        recipe.name || title,
                description:  clean(recipe.description).substring(0, 300),
                image:        ogImg || (Array.isArray(recipe.image) ? recipe.image[0] : recipe.image?.url || recipe.image || postImg?.src || ''),
                servings:     parseInt(recipe.recipeYield) || 4,
                timeRaw:      recipe.totalTime || recipe.cookTime || recipe.prepTime,
                ingredients:  (recipe.recipeIngredient || []).map(clean).filter(Boolean),
                instructions: (recipe.recipeInstructions || []).map(s => clean(s.text || s)).filter(s => s.length > 5),
                cuisine:      recipe.recipeCuisine || '',
                keywords:     Array.isArray(recipe.keywords) ? recipe.keywords : String(recipe.keywords || '').split(',').map(k => k.trim()).filter(Boolean),
                calories: parseFloat(nutri.calories)            || null,
                protein:  parseFloat(nutri.proteinContent)      || null,
                carbs:    parseFloat(nutri.carbohydrateContent) || null,
                fat:      parseFloat(nutri.fatContent)          || null,
                fiber:    parseFloat(nutri.fiberContent)        || null,
            };
        }

        // ── Generic WordPress fallback (no recipe plugin) ──────────────────
        if (!title) return null;
        const content = document.querySelector('.entry-content, .post-content, article .content');
        const lines = (content?.innerText || '').split('\n').map(s => s.trim()).filter(s => s.length > 20);

        return {
            title,
            description: lines[0] || '',
            image: ogImg || postImg?.src || '',
            servings: 4,
            ingredients: [],
            instructions: lines.slice(1, 12),
        };
    });
}

// ── Site registry ─────────────────────────────────────────────────────────────

const SITES = {
    akis: {
        label:       'Άκης Πετρετζίκης',
        maxRecipes:  30,
        getLinks:    getAkisLinks,
        parseRecipe: parseAkisRecipe,
    },
    panos: {
        label:       'Πάνος Ιωαννίδης',
        maxRecipes:  15,
        getLinks:    getPanosLinks,
        parseRecipe: parsePanosRecipe,
    },
    gymbeam: {
        label:       'GymBeam',
        maxRecipes:  15,
        getLinks:    getGymBeamLinks,
        parseRecipe: parseGymBeamRecipe,
    },
    nutriroots: {
        label:       'NutriRoots',
        maxRecipes:  15,
        getLinks:    (page, max) => getWpLinks(page, 'nutriroots', max),
        parseRecipe: parseWpRecipe,
    },
};

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Scrape recipes from Greek recipe sites and save to MongoDB.
 * @param {string} siteKey  — 'akis' | 'panos' | 'gymbeam' | 'nutriroots' | 'all'
 */
async function scrapeWebRecipes(siteKey = 'all') {
    const keys = siteKey === 'all' ? Object.keys(SITES) : [siteKey];
    const browser = await launchBrowser();
    let totalAdded = 0, totalSkipped = 0, totalErrors = 0;

    try {
        for (const key of keys) {
            const cfg = SITES[key];
            if (!cfg) { console.error(`❌ Unknown site key: ${key}`); continue; }

            console.log(`\n🍳 [${cfg.label}] Collecting recipe links...`);
            const page = await browser.newPage();
            await page.setUserAgent(
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            );

            let links = [];
            try {
                links = await cfg.getLinks(page, cfg.maxRecipes);
                console.log(`  📋 Found ${links.length} links`);
            } catch (e) {
                console.error(`  ❌ Failed to collect links:`, e.message);
                await page.close();
                continue;
            }

            let added = 0, skipped = 0, errors = 0;

            for (const url of links) {
                try {
                    // Skip already-scraped URLs
                    if (await Recipe.findOne({ url })) {
                        skipped++;
                        continue;
                    }

                    const raw = await cfg.parseRecipe(page, url);

                    // Require at least a title + some ingredients or instructions
                    if (!raw?.title || (!raw.ingredients?.length && !raw.instructions?.length)) {
                        errors++;
                        continue;
                    }

                    const time       = parseDuration(raw.timeRaw) || raw.time || null;
                    const difficulty = getDifficulty(time, raw.ingredients?.length || 0);
                    const category   = mapCategory([raw.title, ...(raw.keywords || [])]);
                    const tags       = buildTags({ ...raw, time });

                    await Recipe.create({
                        title:        cleanStr(raw.title),
                        description:  cleanStr(raw.description || ''),
                        image:        raw.image       || '',
                        servings:     raw.servings    || 4,
                        time,
                        difficulty,
                        calories:     raw.calories || null,
                        protein:      raw.protein  || null,
                        carbs:        raw.carbs    || null,
                        fat:          raw.fat      || null,
                        fiber:        raw.fiber    || null,
                        isHealthy:    (raw.calories || 999) < 600,
                        ingredients:  (raw.ingredients  || []).map(cleanStr).filter(s => s.length > 1),
                        instructions: (raw.instructions || []).map(s => cleanStr(s).replace(/^\d+[\.\)]\s*/, '')).filter(s => s.length > 5),
                        tags,
                        cuisine:      raw.cuisine || 'Ελληνική',
                        category,
                        sourceApi:    key,           // 'akis' | 'panos' | 'gymbeam' | etc.
                        url,
                        translated:   false,         // already Greek — no translation needed
                    });

                    added++;
                    console.log(`  ✅ ${raw.title.substring(0, 60)}`);

                    // Polite crawl delay
                    await delay(800 + Math.random() * 700);

                } catch (e) {
                    if (e.code === 11000) {
                        skipped++; // duplicate URL
                    } else {
                        console.error(`  ❌ ${url.split('/').slice(-2, -1)[0]}:`, e.message);
                        errors++;
                    }
                }
            }

            console.log(`  📊 ${cfg.label}: +${added} added, ${skipped} skipped, ${errors} errors`);
            totalAdded   += added;
            totalSkipped += skipped;
            totalErrors  += errors;
            await page.close();
        }
    } finally {
        await browser.close();
    }

    console.log(`\n🍳 Web recipes done! Total: +${totalAdded} added, ${totalSkipped} skipped, ${totalErrors} errors`);
    return { added: totalAdded, skipped: totalSkipped, errors: totalErrors };
}

module.exports = { scrapeWebRecipes, SITES };
