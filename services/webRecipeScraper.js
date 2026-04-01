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
            // FIX: clean execText extraction (old code had undefined?.length bug)
            let execIdx = fullText.length;
            let execMarkerLen = 0;
            for (const ek of EXEC_MARKERS) {
                const ei = fullText.indexOf(ek, ingIdx);
                if (ei > -1 && ei < execIdx) {
                    execIdx = ei;
                    execMarkerLen = ek.length;
                }
            }
            ingText  = fullText.substring(ingIdx, execIdx);
            execText = execIdx < fullText.length
                ? fullText.substring(execIdx + execMarkerLen).trim()
                : '';
        }

        // FIX: Filter ALL-CAPS lines — these are GymBeam section headers, not ingredients
        // e.g. "ΕΝΙΣΧΥΤΙΚΑ ΓΕΥΣΗΣ ΚΑΙ ΓΛΥΚΑΝΤΙΚΑ", "ΒΑΣΙΚΑ ΥΛΙΚΑ", "ΓΙΑ ΤΗΝ ΕΠΙΚΑΛΥΨΗ"
        const isAllCapsLine = (s) => {
            const letters = s.replace(/[^α-ωΑ-Ωa-zA-ZάέήίόύώΆΈΉΊΌΎΏ]/g, '');
            return letters.length > 0 && letters === letters.toUpperCase();
        };

        const ingredients = ingText.split('\n')
            .map(s => s.trim())
            .filter(s =>
                s.length > 1 &&
                s.length < 100 &&
                !s.includes('€') &&
                !/^(GymBeam|BIO [A-Z]|Από \d)/.test(s) &&
                !isAllCapsLine(s)   // ← removes section headers
            );

        // FIX: Remove "FITNESS ΣΥΝΤΑΓΗ :" type labels from instruction lines
        // and filter ALL-CAPS-only lines (GymBeam uses them as section dividers in steps too)
        const instructions = (execText || fullText.split('\n\n').slice(1).join('\n'))
            .split(/(?<=[.!?])\s+|\n/)
            .map(s => s.trim())
            // Strip fitness label prefix if present at start of a step
            .map(s => s.replace(/^(FITNESS\s+)?ΣΥΝΤΑΓ[ΗΉ]\s*(FITNESS\s*)?:\s*/i, '').trim())
            .filter(s =>
                s.length > 25 &&
                !isAllCapsLine(s)   // ← removes section dividers in steps
            );

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
        const clean = s => (s || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();

        // ── Try JSON-LD first (sites with a recipe plugin emit this) ─────────
        const allLd = [...document.querySelectorAll('script[type="application/ld+json"]')]
            .map(s => { try { return JSON.parse(s.textContent); } catch { return null; } })
            .filter(Boolean);

        const recipe = allLd.find(l => l['@type'] === 'Recipe')
            || allLd.flatMap(l => l['@graph'] || []).find(n => n['@type'] === 'Recipe');

        if (recipe && (recipe.recipeIngredient?.length || recipe.recipeInstructions?.length)) {
            const nutri = recipe.nutrition || {};
            const ogImg2 = document.querySelector('meta[property="og:image"]')?.content;
            return {
                title:        clean(recipe.name) || document.querySelector('.entry-title')?.innerText?.trim(),
                description:  clean(recipe.description).substring(0, 300),
                image:        ogImg2 || (Array.isArray(recipe.image) ? recipe.image[0] : recipe.image?.url || recipe.image || ''),
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

        // ── Elementor / generic WP fallback ──────────────────────────────────
        // Title: prefer .entry-title, fall back to document.title (strip site name)
        const entryTitle = document.querySelector('.entry-title, .post-title, h1.elementor-heading-title')?.innerText?.trim();
        const docTitle   = document.title.replace(/\s*[–—|-].*$/, '').trim();
        const title      = entryTitle || docTitle;
        if (!title) return null;

        // Image: skip logos, favicons and tiny icons — grab first real content image
        const imgs = [...document.querySelectorAll(
            '.elementor-widget-image img, article img, .entry-content img, .post-thumbnail img'
        )].filter(img => {
            const w = img.naturalWidth || img.width;
            const h = img.naturalHeight || img.height;
            const src = img.src || '';
            // skip logos / icons
            if (src.includes('Logo') || src.includes('logo') || src.includes('favicon')) return false;
            if (w && w < 150) return false;
            return true;
        });
        const image = imgs[0]?.src
            || document.querySelector('meta[property="og:image"], meta[name="twitter:image"]')?.content
            || '';

        // Content: collect all text-editor blocks
        const blocks = [...document.querySelectorAll('.elementor-widget-text-editor .elementor-widget-container')]
            .map(el => el.innerText?.trim())
            .filter(t => t && t.length > 20);

        // Combine blocks, then split on newlines for per-line processing
        const fullText = blocks.join('\n\n');
        const lines = fullText.split('\n').map(l => l.trim()).filter(Boolean);

        // Normalise: lowercase + strip diacritics + keep only letters
        const norm = s => s.toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-zα-ω]/g, '');

        // Detect section header lines (not actual content)
        const isIngrHeader = l => {
            const lo = norm(l);
            return lo.includes('χρειαστεις') || lo.includes('υλικα') || lo === 'ingredients';
        };
        const isInstHeader = l => {
            const lo = norm(l);
            return lo.includes('εκτελεση') || lo.includes('οδηγιες') || lo.includes('παρασκευη')
                || lo.includes('βηματα') || lo.includes('τροπος') || lo === 'instructions';
        };

        let ingredients = [];
        let instructions = [];
        let description = '';

        // Find section headers — match only short lines (< 50 chars) to avoid false
        // positives where the description sentence contains the same word (e.g. "4+2 υλικά")
        const ingrStart = lines.findIndex(l => l.length < 50 && isIngrHeader(l));
        const instStart = lines.findIndex(l => l.length < 50 && isInstHeader(l));

        if (ingrStart >= 0) {
            description = lines.slice(0, ingrStart).join(' ').substring(0, 300);
            const ingrEnd = instStart > ingrStart ? instStart : lines.length;
            ingredients = lines.slice(ingrStart + 1, ingrEnd)
                .filter(l => l.length > 1 && l.length < 100 && !isInstHeader(l));
            instructions = instStart >= 0
                ? lines.slice(instStart + 1).filter(l => l.length > 5)
                : [];
        } else {
            // No section markers — first line is description, rest split by length heuristic
            description = lines[0]?.substring(0, 300) || '';
            const rest = lines.slice(1);
            ingredients  = rest.filter(l => l.length < 80);
            instructions = rest.filter(l => l.length >= 80);
        }

        // Need at least a title + some content
        if (!ingredients.length && !instructions.length) return null;

        return { title, description, image, servings: 4, ingredients, instructions };
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
            const seenTitles = new Set(); // dedup within this run

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

                    const titleKey = cleanStr(raw.title).toLowerCase().trim();
                    // Skip duplicate titles within this scrape run
                    if (seenTitles.has(titleKey)) { skipped++; continue; }
                    // Skip if title already exists in DB for this source
                    if (await Recipe.findOne({ title: { $regex: `^${titleKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' }, sourceApi: key })) {
                        skipped++; seenTitles.add(titleKey); continue;
                    }
                    seenTitles.add(titleKey);

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