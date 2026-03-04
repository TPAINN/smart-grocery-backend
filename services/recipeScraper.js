// services/recipeScraper.js
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const cheerio = require('cheerio');
const Recipe = require('../models/Recipe');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const parseISO8601Duration = (duration) => {
    if (!duration) return null;
    if (typeof duration === 'number') return duration;
    
    // Handle ISO 8601: PT1H30M, PT45M, PT1H, etc.
    const isoMatch = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (isoMatch && (isoMatch[1] || isoMatch[2] || isoMatch[3])) {
        return ((parseInt(isoMatch[1]) || 0) * 60) + (parseInt(isoMatch[2]) || 0) + (isoMatch[3] ? 1 : 0);
    }
    
    // Handle plain number strings: "45", "90"
    const plainNum = parseInt(duration);
    if (!isNaN(plainNum) && plainNum > 0) return plainNum;
    
    // Handle text: "45 λεπτά", "1 ώρα", "1 ώρα και 30 λεπτά"
    const hoursMatch = duration.match(/(\d+)\s*(?:ώρ|ωρ|hour|hr)/i);
    const minsMatch = duration.match(/(\d+)\s*(?:λεπτ|min|minute)/i);
    if (hoursMatch || minsMatch) {
        return ((parseInt(hoursMatch?.[1]) || 0) * 60) + (parseInt(minsMatch?.[1]) || 0);
    }
    
    return null;
};

function textContainsOven(instructions) {
    const text = instructions.join(' ').toLowerCase();
    return text.includes('φούρν') || text.includes('ψήνουμε') || text.includes('αντιστάσεις') || text.includes('στους 180') || text.includes('στους 200');
}

// 🟢 RECURSIVE JSON-LD PARSER: Εντοπίζει το Recipe object σε οποιοδήποτε βάθος (Fix για Yoast/Graph)
const findRecipeInJson = (obj) => {
    if (!obj || typeof obj !== 'object') return null;
    if (Array.isArray(obj)) {
        for (let item of obj) {
            const res = findRecipeInJson(item);
            if (res) return res;
        }
    } else {
        let type = obj['@type'];
        if (type === 'Recipe' || (Array.isArray(type) && type.includes('Recipe'))) {
            return obj;
        }
        if (obj['@graph']) return findRecipeInJson(obj['@graph']);
        for (let key in obj) {
            if (typeof obj[key] === 'object') {
                const res = findRecipeInJson(obj[key]);
                if (res) return res;
            }
        }
    }
    return null;
};

// 🟢 ΕΠΙΠΕΔΟ 3: DATA EXTRACTION (Individual Recipe Page)
async function extractRecipeData(page, url, chefName) {
    try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        const html = await page.content();
        const $ = cheerio.load(html);
        
        let recipeData = null;
        $('script[type="application/ld+json"]').each((i, el) => {
            try {
                const json = JSON.parse($(el).html());
                const found = findRecipeInJson(json);
                if (found) recipeData = found;
            } catch(e) {}
        });

        if (!recipeData) return null;

        const title = recipeData.name;
        if (!title) return null;

        let image = null;
        if (recipeData.image) {
            if (Array.isArray(recipeData.image)) image = recipeData.image[0];
            else if (typeof recipeData.image === 'object') image = recipeData.image.url;
            else image = recipeData.image;
        }

        const ingredients = recipeData.recipeIngredient || [];
        
        let instructions = [];
        if (recipeData.recipeInstructions) {
            if (Array.isArray(recipeData.recipeInstructions)) {
                instructions = recipeData.recipeInstructions.map(step => step.text ? step.text.replace(/<[^>]*>?/gm, '') : step).filter(Boolean);
            } else if (typeof recipeData.recipeInstructions === 'string') {
                instructions = [recipeData.recipeInstructions.replace(/<[^>]*>?/gm, '')];
            }
        }

        // ⏱️ Robust time extraction: totalTime → prepTime+cookTime → fallback
        let totalTime = parseISO8601Duration(recipeData.totalTime);
        if (!totalTime) {
            const prep = parseISO8601Duration(recipeData.prepTime) || 0;
            const cook = parseISO8601Duration(recipeData.cookTime) || 0;
            if (prep + cook > 0) totalTime = prep + cook;
        }
        if (!totalTime) totalTime = parseISO8601Duration(recipeData.performTime);
        if (!totalTime) totalTime = 45; // last resort fallback

        const caloriesStr = recipeData.nutrition?.calories || "450";
        const calories = parseInt(String(caloriesStr).replace(/\D/g, '')) || 450;

        // 💰 Dynamic Cost Estimator (SaaS Logic)
        let estimatedCost = 0;
        ingredients.forEach(ing => {
            const text = String(ing).toLowerCase();
            if (text.includes('κρέας') || text.includes('κοτόπουλο') || text.includes('σολομ') || text.includes('κιμά') || text.includes('μοσχάρ')) estimatedCost += 3.5;
            else if (text.includes('τυρί') || text.includes('λάδι') || text.includes('βούτυρο')) estimatedCost += 1.2;
            else estimatedCost += 0.4;
        });

        const isHealthy = calories < 550;
        const isBudget = estimatedCost < 10.0;
        const ovenTemp = textContainsOven(instructions) ? 180 : null; 
        const ovenTime = ovenTemp ? Math.floor(totalTime * 0.7) : null; 

        return { 
            title, chef: chefName, image, time: totalTime, calories, 
            cost: estimatedCost, isHealthy, isBudget, ovenTemp, ovenTime, 
            ingredients, instructions, url 
        };
    } catch (error) {
        return null;
    }
}

// 🟢 ΕΠΙΠΕΔΟ 1 & 2: MASTER ORCHESTRATOR (Resilient BFS Crawler)
async function populateRecipes() {
    console.log("🚀 Εκκίνηση Multi-Chef Recipe Omni-Spider (Depth 2)...");
    
    const TARGET_SITES = [
        {
            chef: 'Άκης Πετρετζίκης',
            startUrls: ['https://akispetretzikis.com/'],
            base: 'https://akispetretzikis.com',
            recipePattern: '/recipe/',
            listPattern: ['/categories', '/tags/']
        }
        // Προσθήκη επιπλέον chefs εδώ με τα αντίστοιχα patterns
    ];

    let browser;
    try {
        browser = await puppeteer.launch({
            headless: "new",
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
        });
        const page = await browser.newPage();
        await page.setViewport({ width: 1920, height: 1080 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

        let globalSavedCount = 0;

        for (const site of TARGET_SITES) {
            console.log(`\n👨‍🍳 [Σεφ: ${site.chef}] Σάρωση αρχικών σελίδων...`);
            let directRecipeLinks = new Set();
            let listLinks = new Set();

            for (const startUrl of site.startUrls) {
                try {
                    await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
                    await sleep(2000); 

                    for(let i=0; i<4; i++) {
                        await page.keyboard.press('PageDown');
                        await sleep(400);
                    }
                    
                    const html = await page.content();
                    const $home = cheerio.load(html);
                    
                    $home('a').each((i, el) => {
                        let href = $home(el).attr('href');
                        if (!href || href.includes('#') || href.includes('?')) return;
                        if (href.startsWith('/') && site.base !== '') href = site.base + href;

                        if (href.includes(site.recipePattern) && !href.includes('category') && !href.includes('tag')) {
                            directRecipeLinks.add(href);
                        } else if (site.listPattern.some(p => href.includes(p))) {
                            listLinks.add(href);
                        }
                    });
                } catch(e) {}
            }

            // 🕸️ Βάθος 2: Crawling σε κατηγορίες
            const targetLists = Array.from(listLinks).slice(0, 4); 
            for (const listUrl of targetLists) {
                console.log(`   🔍 [Depth 2] Σάρωση κατηγορίας: ${listUrl.replace(site.base, '')}`);
                try {
                    await page.goto(listUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
                    await sleep(1500);
                    const listHtml = await page.content();
                    const $list = cheerio.load(listHtml);

                    $list('a').each((i, el) => {
                        let href = $list(el).attr('href');
                        if (href && href.includes(site.recipePattern) && !href.includes('#')) {
                            if (href.startsWith('/') && site.base !== '') href = site.base + href;
                            if (!href.includes('category') && !href.includes('tag')) {
                                directRecipeLinks.add(href);
                            }
                        }
                    });
                } catch (e) {}
            }

            // 💾 Final Extraction & Upsert
            const finalLinks = Array.from(directRecipeLinks).slice(0, 15); 
            console.log(`   ⏳ Εξαγωγή ${finalLinks.length} συνταγών...`);

            for (const url of finalLinks) {
                const data = await extractRecipeData(page, url, site.chef);
                if (data && data.ingredients && data.ingredients.length > 0) {
                    await Recipe.findOneAndUpdate({ url: data.url }, { $set: data }, { upsert: true });
                    process.stdout.write(`\r      💾 Αποθηκεύτηκε: ${data.title.substring(0, 20)}...`);
                    globalSavedCount++;
                }
                await sleep(800); 
            }
        }
        console.log(`\n\n🎉 Η Βάση ενημερώθηκε με ${globalSavedCount} συνταγές.`);
    } catch (error) {
        console.error("\n❌ Σφάλμα Scraper:", error.message);
    } finally {
        if (browser) await browser.close();
    }
}

module.exports = { populateRecipes };