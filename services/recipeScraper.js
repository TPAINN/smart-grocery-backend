// services/recipeScraper.js
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const cheerio = require('cheerio');
const Recipe = require('../models/Recipe');
const decodeHTMLEntities = (text) => {
    if (!text) return '';
    return text.replace(/&nbsp;/g, ' ')
               .replace(/&deg;/gi, '°')
               .replace(/&amp;/g, '&')
               .replace(/&quot;/g, '"')
               .replace(/&#039;/g, "'")
               .replace(/<[^>]*>?/gm, '') // Αφαιρεί εντελώς orphan HTML tags (<br>, <strong>)
               .trim();
};

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

// 🟢 ΒΑΘΥΣ ΑΛΓΟΡΙΘΜΟΣ ΑΝΑΖΗΤΗΣΗΣ JSON-LD (Λύνει το πρόβλημα του Τσούλη)
const findRecipeInJson = (obj) => {
    if (!obj || typeof obj !== 'object') return null;
    
    // Αν είναι Array, ψάξε σε κάθε στοιχείο
    if (Array.isArray(obj)) {
        for (let item of obj) {
            const res = findRecipeInJson(item);
            if (res) return res;
        }
    } else {
        // Αν βρήκαμε τον τύπο Recipe (είτε string είτε array που το περιέχει)
        let type = obj['@type'];
        if (type === 'Recipe' || (Array.isArray(type) && type.includes('Recipe'))) {
            return obj;
        }
        // Αν το site χρησιμοποιεί Yoast SEO (έχει @graph array)
        if (obj['@graph']) {
            return findRecipeInJson(obj['@graph']);
        }
        // Recursive σκάψιμο σε όλα τα κλειδιά
        for (let key in obj) {
            if (typeof obj[key] === 'object') {
                const res = findRecipeInJson(obj[key]);
                if (res) return res;
            }
        }
    }
    return null;
};

// 🟢 ΕΠΙΠΕΔΟ 3: Ο Γενικός Εξαγωγέας
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

        // 🟢 NΕΟ: Fallback Parser (Αν το Site δεν έχει JSON-LD Schema)
        if (!recipeData) {
            const fbTitle = $('h1').first().text() || $('h3').first().text();
            if (!fbTitle) return null;

            const fbImage = $('.single_recipe__main_image img').attr('src') || 
                            $('img[src*="recipe"]').attr('src') || 
                            $('img[src*="storage/media"]').attr('src');
            
            let fbIng =[];
            $('.ingredients__item label, .ingredients li, .ingredient-list li, .field--name-field-ingredients li').each((i, el) => {
                fbIng.push($(el).text());
            });

            let fbInstr =[];
            $('.instructions li, .preparation li, .recipe-steps p, .step-title').each((i, el) => {
                fbInstr.push($(el).text());
            });

            let timeText = $('.cook-time, .cooking_time, .time').text() || '45';
            let fbTime = parseInt(timeText.replace(/\D/g, '')) || 45;

            recipeData = {
                name: fbTitle,
                image: fbImage,
                recipeIngredient: fbIng,
                recipeInstructions: fbInstr,
                totalTime: fbTime
            };
        }

        if (!recipeData || !recipeData.name) return null;

        const title = decodeHTMLEntities(recipeData.name);
        
        let image = null;
        if (recipeData.image) {
            if (Array.isArray(recipeData.image)) image = recipeData.image[0];
            else if (typeof recipeData.image === 'object') image = recipeData.image.url;
            else image = recipeData.image;
        }

        const ingredients = (recipeData.recipeIngredient ||[]).map(decodeHTMLEntities);
        
        let instructions =[];
        if (recipeData.recipeInstructions) {
            const rawInstr = Array.isArray(recipeData.recipeInstructions) 
                ? recipeData.recipeInstructions.map(step => step.text || step) 
                : [recipeData.recipeInstructions];
            instructions = rawInstr.map(decodeHTMLEntities).filter(Boolean);
        }

        const totalTime = (typeof recipeData.totalTime === 'string') 
            ? (parseISO8601Duration(recipeData.totalTime) || 45) 
            : (recipeData.totalTime || 45);

        const calories = 450; // Μπορεί να κρατηθεί στατικό ανλείπουν tags

        let estimatedCost = 0;
        ingredients.forEach(ing => {
            const text = String(ing).toLowerCase();
            if (text.includes('κρέας') || text.includes('κοτόπουλο') || text.includes('σολομ') || text.includes('κιμά')) estimatedCost += 3.5;
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

// 🟢 ΕΠΙΠΕΔΟ 1 & 2: MULTI-CHEF ORCHESTRATOR (Deep Crawl - Βάθος 2 για ΟΛΟΥΣ)
async function populateRecipes() {
    console.log("🚀 Εκκίνηση Multi-Chef Recipe Omni-Spider (Βάθος 2 για όλους)...");
    
    // 🎯 Ρυθμίσεις Στόχευσης ανά Σεφ
    const TARGET_SITES =[
        {
            chef: 'Άκης Πετρετζίκης',
            startUrls:['https://akispetretzikis.com/'],
            base: 'https://akispetretzikis.com',
            recipePattern: '/recipe/',
            listPattern:['/categories', '/tags/']
        },
        {
            chef: 'Αργυρώ Μπαρμπαρίγου',
            startUrls:['https://www.argiro.gr/category/syntages/'],
            base: '', 
            recipePattern: '/recipe/',
            listPattern: ['/category/']
        },
        {
            chef: 'Γιώργος Τσούλης',
            startUrls:['https://www.giorgostsoulis.com/syntages'],
            base: 'https://www.giorgostsoulis.com',
            recipePattern: '/syntages/',
            listPattern:['/katigories/']
        },
        {
            chef: 'Γιάννης Λουκάκος',
            startUrls:['https://yiannislucacos.gr/recipes/pantry'],
            base: 'https://yiannislucacos.gr',
            recipePattern: '/recipe/',
            listPattern:['/recipes/']
        },
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
            console.log(`\n👨‍🍳 [Σεφ: ${site.chef}] Εκκίνηση σάρωσης...`);
            let directRecipeLinks = new Set();
            let listLinks = new Set();

            // 🕸️ ΒΗΜΑ 1: Σάρωση των Αρχικών Σελίδων (Depth 1)
            for (const startUrl of site.startUrls) {
                console.log(`   🕸️ [Βάθος 1] Σκανάρω Αρχική: ${startUrl}`);
                try {
                    await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
                    await sleep(2000); 

                    // Ελαφρύ Scroll για Lazy Loading
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

                        // 1. Είναι Συνταγή; (Και σιγουρευόμαστε ότι δεν είναι κατά λάθος λίστα)
                        if (href.includes(site.recipePattern) && !href.includes('category') && !href.includes('tag')) {
                            directRecipeLinks.add(href);
                        } 
                        // 2. Είναι Λίστα/Κατηγορία; (Για το Βάθος 2)
                        else if (site.listPattern.some(p => href.includes(p))) {
                            listLinks.add(href);
                        }
                    });
                } catch(e) {}
            }

            console.log(`   ✔️ Βρέθηκαν ${listLinks.size} Κατηγορίες & ${directRecipeLinks.size} Συνταγές στην Αρχική.`);

            // 🕸️ ΒΗΜΑ 2: Βουτιά στις Κατηγορίες (Depth 2)
            // Επιλέγουμε 4 δυναμικές κατηγορίες (για να μην κρασάρει ο server από το βάρος)
            const targetLists = Array.from(listLinks).slice(0, 4); 
            
            for (const listUrl of targetLists) {
                console.log(`   🔍 [Βάθος 2] Αντλώ από: ${listUrl.replace(site.base, '')}`);
                try {
                    await page.goto(listUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
                    await sleep(1500);

                    // Scroll μέσα στην κατηγορία
                    for(let i=0; i<3; i++) {
                        await page.keyboard.press('PageDown');
                        await sleep(400);
                    }

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

            // 💾 ΒΗΜΑ 3: Εξαγωγή JSON-LD
            // Παίρνουμε μέχρι 12 συνταγές από κάθε σεφ (Σύνολο: ~72 συνταγές ανά run)
            const finalLinks = Array.from(directRecipeLinks).slice(0, 12); 
            console.log(`   ⏳ Ξεκινάει η Εξαγωγή για ${finalLinks.length} Μοναδικές Συνταγές...`);

            let chefSavedCount = 0;
            for (const url of finalLinks) {
                const data = await extractRecipeData(page, url, site.chef);
                if (data && data.ingredients && data.ingredients.length > 0) {
                    await Recipe.findOneAndUpdate({ url: data.url }, { $set: data }, { upsert: true });
                    process.stdout.write(`\r      💾 Αποθηκεύτηκε: ${data.title.substring(0, 20)}... (~${data.cost.toFixed(2)}€)        `);
                    chefSavedCount++;
                    globalSavedCount++;
                }
                await sleep(800); // Ήπιος ρυθμός για να μην μας μπλοκάρουν
            }
            console.log(`\n   ✅ Ολοκληρώθηκε ο/η ${site.chef} με ${chefSavedCount} επιτυχείς εξαγωγές.`);
        }

        console.log(`\n\n🎉 ΤΕΛΟΣ! Η Βάση Δεδομένων εμπλουτίστηκε με ${globalSavedCount} Premium Συνταγές.`);

    } catch (error) {
        console.error("\n❌ Κρίσιμο Σφάλμα Omni-Spider:", error.message);
    } finally {
        if (browser) await browser.close();
    }
}

module.exports = { populateRecipes };