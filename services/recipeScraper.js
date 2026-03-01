// services/recipeScraper.js
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const cheerio = require('cheerio');
const Recipe = require('../models/Recipe');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const parseISO8601Duration = (duration) => {
    if (!duration) return 0;
    const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
    if (!match) return 0;
    return ((parseInt(match[1]) || 0) * 60) + (parseInt(match[2]) || 0);
};

function textContainsOven(instructions) {
    const text = instructions.join(' ').toLowerCase();
    return text.includes('φούρν') || text.includes('ψήνουμε') || text.includes('αντιστάσεις') || text.includes('στους 180') || text.includes('στους 200');
}

// 🟢 ΕΠΙΠΕΔΟ 3: Ο Γενικός Εξαγωγέας JSON-LD (Λειτουργεί για ΟΛΑ τα sites)
async function extractRecipeData(page, url, chefName) {
    try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        const html = await page.content();
        const $ = cheerio.load(html);
        
        let recipeData = null;

        $('script[type="application/ld+json"]').each((i, el) => {
            try {
                const json = JSON.parse($(el).html());
                const findRecipe = (obj) => {
                    if (Array.isArray(obj)) {
                        for (let item of obj) {
                            if (item['@type'] === 'Recipe') return item;
                            if (item['@graph']) {
                                const res = item['@graph'].find(g => g['@type'] === 'Recipe');
                                if (res) return res;
                            }
                        }
                    } else if (obj['@type'] === 'Recipe') return obj;
                    else if (obj['@graph']) return obj['@graph'].find(g => g['@type'] === 'Recipe');
                    return null;
                };
                const found = findRecipe(json);
                if (found) recipeData = found;
            } catch(e) {}
        });

        if (!recipeData) return null;

        const title = recipeData.name;
        const image = Array.isArray(recipeData.image) ? recipeData.image[0] : (recipeData.image?.url || recipeData.image);
        const ingredients = recipeData.recipeIngredient || [];
        
        let instructions =[];
        if (recipeData.recipeInstructions) {
            if (Array.isArray(recipeData.recipeInstructions)) {
                instructions = recipeData.recipeInstructions.map(step => step.text ? step.text.replace(/<[^>]*>?/gm, '') : step).filter(Boolean);
            } else if (typeof recipeData.recipeInstructions === 'string') {
                instructions = [recipeData.recipeInstructions.replace(/<[^>]*>?/gm, '')];
            }
        }

        const totalTime = parseISO8601Duration(recipeData.totalTime) || 45;
        const caloriesStr = recipeData.nutrition?.calories || "450";
        const calories = parseInt(caloriesStr.replace(/\D/g, ''));

        let estimatedCost = 0;
        ingredients.forEach(ing => {
            const text = ing.toLowerCase();
            if (text.includes('κρέας') || text.includes('κοτόπουλο') || text.includes('σολομ') || text.includes('κιμά') || text.includes('μοσχάρ')) estimatedCost += 3.5;
            else if (text.includes('τυρί') || text.includes('λάδι') || text.includes('βούτυρο')) estimatedCost += 1.2;
            else estimatedCost += 0.4;
        });

        const isHealthy = calories < 550;
        const isBudget = estimatedCost < 10.0;
        const ovenTemp = textContainsOven(instructions) ? 180 : null; 
        const ovenTime = ovenTemp ? Math.floor(totalTime * 0.7) : null; 

        return { title, chef: chefName, image, time: totalTime, calories, cost: estimatedCost, isHealthy, isBudget, ovenTemp, ovenTime, ingredients, instructions, url };
    } catch (error) {
        return null;
    }
}

// 🟢 ΕΠΙΠΕΔΟ 1 & 2: MULTI-CHEF ORCHESTRATOR (Αλεξίσφαιρος BFS Crawler)
async function populateRecipes() {
    console.log("🚀 Εκκίνηση Multi-Chef Recipe Omni-Spider...");
    
    // Οι στόχοι μας με τους κανόνες πλοήγησης του καθενός
    const TARGET_SITES =[
        {
            chef: 'Άκης Πετρετζίκης',
            startUrl: 'https://akispetretzikis.com/',
            base: 'https://akispetretzikis.com',
            recipePattern: '/recipe/',
            listPattern: ['/categories', '/tags/']
        },
        {
            chef: 'Αργυρώ Μπαρμπαρίγου',
            startUrl: 'https://www.argiro.gr/category/syntages/',
            base: '', // Η Αργυρώ έχει απόλυτα links (https://...)
            recipePattern: '/recipe/',
            listPattern: ['/category/']
        },
        {
            chef: 'Γιώργος Τσούλης',
            startUrl: 'https://www.giorgostsoulis.com/syntages',
            base: 'https://www.giorgostsoulis.com',
            recipePattern: '/syntages/',
            listPattern:[] // Ο Τσούλης τα έχει όλα χύμα, δεν χρειαζόμαστε βάθος 2
        }
    ];

    let browser;
    try {
        browser = await puppeteer.launch({
            headless: "new",
            args:['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
        });
        const page = await browser.newPage();
        await page.setViewport({ width: 1920, height: 1080 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

        let globalSavedCount = 0;

        for (const site of TARGET_SITES) {
            console.log(`\n🕸️ [Σεφ: ${site.chef}] Σκανάρω τη σελίδα: ${site.startUrl}`);
            let listLinks = new Set();
            let directRecipeLinks = new Set();

            try {
                await page.goto(site.startUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
                await sleep(2000); 

                // Scroll για να εμφανιστούν τα lazy-loaded links (Αργυρώ & Τσούλης)
                for(let i=0; i<4; i++) {
                    await page.keyboard.press('PageDown');
                    await sleep(500);
                }
                
                const html = await page.content();
                const $home = cheerio.load(html);
                
                $home('a').each((i, el) => {
                    let href = $home(el).attr('href');
                    if (!href || href.includes('#') || href.includes('?')) return;
                    
                    if (href.startsWith('/') && site.base !== '') href = site.base + href;

                    // Αν είναι URL συνταγής
                    if (href.includes(site.recipePattern) && !href.includes('/category/')) {
                        directRecipeLinks.add(href);
                    } 
                    // Αν είναι URL κατηγορίας (Βάθος 2)
                    else if (site.listPattern.some(p => href.includes(p))) {
                        listLinks.add(href);
                    }
                });

                console.log(`✔️ Βρέθηκαν ${listLinks.size} Σελίδες Λιστών και ${directRecipeLinks.size} Συνταγές στην Αρχική.`);

                // Αν δε βρήκε αρκετές συνταγές (π.χ. στον Άκη), μπαίνει στις Λίστες (ΒΑΘΟΣ 2)
                if (directRecipeLinks.size < 10 && listLinks.size > 0) {
                    const targetLists = Array.from(listLinks).slice(0, 4); // Ψάχνει σε 4 λίστες
                    for (const listUrl of targetLists) {
                        console.log(`   🔍 [Βάθος 2] Αντλώ από: ${listUrl.replace(site.base, '')}`);
                        try {
                            await page.goto(listUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
                            await sleep(1500);
                            const listHtml = await page.content();
                            const $list = cheerio.load(listHtml);

                            $list('a').each((i, el) => {
                                let href = $list(el).attr('href');
                                if (href && href.includes(site.recipePattern) && !href.includes('#')) {
                                    if (href.startsWith('/') && site.base !== '') href = site.base + href;
                                    directRecipeLinks.add(href);
                                }
                            });
                        } catch (e) {}
                    }
                }

                // Παίρνουμε μέχρι 15 φρέσκες συνταγές από κάθε σεφ
                const finalLinks = Array.from(directRecipeLinks).slice(0, 15); 
                console.log(`✔️ Θα σκανάρω ${finalLinks.length} συνταγές για τον/την ${site.chef}. Ξεκινάει η Εξαγωγή...`);

                let chefSavedCount = 0;
                for (const url of finalLinks) {
                    const data = await extractRecipeData(page, url, site.chef);
                    if (data && data.ingredients && data.ingredients.length > 0) {
                        await Recipe.findOneAndUpdate({ url: data.url }, { $set: data }, { upsert: true });
                        process.stdout.write(`\r   💾 [${site.chef}] Αποθηκεύτηκε: ${data.title.substring(0, 20)}... (~${data.cost.toFixed(2)}€)        `);
                        chefSavedCount++;
                        globalSavedCount++;
                    }
                    await sleep(800); 
                }
                console.log(`\n   ✅ Ολοκληρώθηκε ο/η ${site.chef} με ${chefSavedCount} συνταγές.`);

            } catch (e) {
                console.log(`\n❌ Σφάλμα στον σεφ ${site.chef}: ${e.message}`);
            }
        }

        console.log(`\n\n🎉 ΤΕΛΟΣ! Η Βάση Δεδομένων ενημερώθηκε με ${globalSavedCount} Premium Συνταγές (Από 3 διαφορετικούς Σεφ!).`);

    } catch (error) {
        console.error("\n❌ Κρίσιμο Σφάλμα Omni-Spider:", error.message);
    } finally {
        if (browser) await browser.close();
    }
}

module.exports = { populateRecipes };