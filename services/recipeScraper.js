// services/recipeScraper.js
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const Recipe = require('../models/Recipe');

puppeteer.use(StealthPlugin());

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Καθαρισμός κειμένου από σκουπίδια HTML
const cleanText = (t) => t ? t.replace(/&nbsp;/g, ' ').replace(/&deg;/g, '°').replace(/<[^>]*>?/gm, '').trim() : "";

/**
 * ΕΞΑΓΩΓΗ ΔΕΔΟΜΕΝΩΝ ΑΠΟ ΤΗ ΣΕΛΙΔΑ ΤΗΣ ΣΥΝΤΑΓΗΣ
 */
async function extractRecipeData(page, url) {
    try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
        await page.waitForSelector('h1', { timeout: 10000 });

        const recipeData = await page.evaluate(() => {
            const getCleanText = (el) => el ? el.innerText.trim() : "";
            
            const title = getCleanText(document.querySelector('h1'));
            const image = document.querySelector('meta[property="og:image"]')?.content;

            // 🟢 ΦΙΛΤΡΟ ΓΙΑ ΣΚΟΥΠΙΔΙΑ (Blacklist)
            const blacklist = [
                "συστατικά", "γραμμάρια", "γρ.", "ουγγιές", "usa cups", 
                "tip", "τσέκαρε", "αποθήκευσε", "υπόλοιπα", "σημείωσε"
            ];

            const isGarbage = (text) => {
                const t = text.toLowerCase();
                return blacklist.some(word => t.includes(word)) || t.length < 2;
            };

            // 🟢 ΕΞΥΠΝΗ ΣΥΛΛΟΓΗ ΥΛΙΚΩΝ
            // Στοχεύουμε μόνο στα πραγματικά κείμενα των υλικών
            const ingNodes = document.querySelectorAll('.ingredients-wrapper-inner .acc-item, .recipe-ingredients li');
            let ingredients = Array.from(ingNodes)
                .map(n => getCleanText(n))
                .filter(t => !isGarbage(t));

            // Αφαίρεση Διπλότυπων (Deduplicate)
            ingredients = [...new Set(ingredients)];

            // 🟢 ΣΥΛΛΟΓΗ ΟΔΗΓΙΩΝ
            const instrNodes = document.querySelectorAll('.directions-wrapper .acc-item, .recipe-steps p');
            let instructions = Array.from(instrNodes)
                .map(n => getCleanText(n))
                .filter(t => !isGarbage(t) && t.length > 10);
            
            instructions = [...new Set(instructions)];

            const timeNode = document.querySelector('.spec-item.time') || document.querySelector('.cook-time');
            const time = timeNode ? parseInt(timeNode.innerText.replace(/\D/g, '')) : 35;

            return { title, image, ingredients, instructions, time };
        });

        if (!recipeData.title || recipeData.ingredients.length === 0) return null;

        return {
            title: cleanText(recipeData.title),
            chef: 'Άκης Πετρετζίκης',
            image: recipeData.image,
            time: recipeData.time,
            // 🟢 Διόρθωση κόστους: 0.5€ ανά υλικό κατά μέσο όρο
            cost: recipeData.ingredients.length * 0.5, 
            ingredients: recipeData.ingredients.map(t => cleanText(t)),
            instructions: recipeData.instructions.map(t => cleanText(t)),
            url,
            isHealthy: true,
            isBudget: true
        };
    } catch (e) { return null; }
}

/**
 * Η ΚΥΡΙΑ ΣΥΝΑΡΤΗΣΗ ΠΟΥ ΚΑΛΕΙΤΑΙ ΑΠΟ ΤΟ RUNRECIPES.JS
 */
async function populateRecipes() {
    const linksPath = path.join(__dirname, '../akis_links.json');
    
    if (!fs.existsSync(linksPath)) {
        console.log("❌ Το αρχείο akis_links.json λείπει. Τρέξε πρώτα τον crawler.");
        return;
    }

    const recipeLinks = JSON.parse(fs.readFileSync(linksPath, 'utf8'));
    console.log(`🚀 Ξεκινάει το Scraping για ${recipeLinks.length} συνταγές.`);

    const browser = await puppeteer.launch({
        headless: "new",
        args: [
            '--no-sandbox', '--disable-setuid-sandbox', 
            '--single-process', '--disable-dev-shm-usage'
        ]
    });

    try {
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

        let saved = 0;
        // 🟢 ΣΗΜΑΝΤΙΚΟ: Σειριακή επεξεργασία (μία-μία) για να μην "σκάσει" η RAM του Render
        for (const url of recipeLinks) {
            const data = await extractRecipeData(page, url);
            
            if (data) {
                // Χρησιμοποιούμε το URL ως μοναδικό κλειδί για να μην έχουμε διπλότυπα
                await Recipe.findOneAndUpdate(
                    { url: data.url }, 
                    { $set: data }, 
                    { upsert: true, new: true }
                );
                saved++;
                console.log(`   ✅ [${saved}/${recipeLinks.length}] Αποθηκεύτηκε: ${data.title}`);
            }
            
            // Delay 2 δευτερόλεπτα ανά συνταγή για να είμαστε "ευγενικοί" με τον server
            await sleep(2000);
        }

        console.log(`\n🎉 ΟΛΟΚΛΗΡΩΘΗΚΕ! ${saved} συνταγές είναι πλέον διαθέσιμες στο App.`);

    } catch (error) {
        console.error("❌ Σφάλμα Harvester:", error.message);
    } finally {
        await browser.close();
    }
}

module.exports = { populateRecipes };