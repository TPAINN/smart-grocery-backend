// services/akisCrawler.js
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');

puppeteer.use(StealthPlugin());

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function runAkisCrawler() {
    console.log("🕷️ ΕΚΚΙΝΗΣΗ AKIS LINK-SPIDER (V4 - Correct Routes)");
    
    const browser = await puppeteer.launch({
        headless: "new",
        args: [
            '--no-sandbox', '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--single-process', '--disable-dev-shm-usage',
            '--window-size=1920,1080'
        ]
    });

    try {
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

        // 🟢 FIX: Η σωστή σελίδα κατηγοριών
        const rootUrl = 'https://akispetretzikis.com/recipes/categories';
        console.log(`🔗 Σκανάρω τη ρίζα: ${rootUrl}`);
        
        await page.goto(rootUrl, { waitUntil: 'networkidle2', timeout: 60000 });

        // Περιμένουμε να εμφανιστούν οι κάρτες των κατηγοριών
        console.log("⏳ Αναμονή για φόρτωση περιεχομένου...");
        await sleep(5000); 

        // Εξαγωγή όλων των κατηγοριών (π.χ. /recipes/nistia, /recipes/air-fryer κτλ)
        const categories = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('a'))
                .map(a => a.href)
                .filter(href => 
                    href.includes('/recipes/') && 
                    !href.includes('/categories') && 
                    !href.includes('/recipe/') // Δεν θέλουμε μεμονωμένες συνταγές ακόμα
                );
        });

        const uniqueCategories = [...new Set(categories)];
        console.log(`📂 Βρέθηκαν ${uniqueCategories.length} βασικές κατηγορίες.`);

        if (uniqueCategories.length === 0) {
            console.log("❌ Δεν βρέθηκαν κατηγορίες. Δοκιμάζω εναλλακτικό selector...");
            // Fallback αν το παραπάνω αποτύχει
            const fallbackLinks = await page.evaluate(() => {
                return Array.from(document.querySelectorAll('a[href*="/recipes/"]'))
                    .map(a => a.href);
            });
            console.log(`📂 Fallback: Βρέθηκαν ${fallbackLinks.length} links.`);
        }

        let allRecipeLinks = new Set();

        // Σκανάρουμε τις πρώτες 10 κατηγορίες για να γεμίσει η βάση
        for (const catUrl of uniqueCategories.slice(0, 10)) {
            console.log(`   📂 Σκανάρω κατηγορία: ${catUrl.split('/').pop()}`);
            try {
                await page.goto(catUrl, { waitUntil: 'networkidle2', timeout: 40000 });
                
                // Δυναμικό σκρολάρισμα για Lazy Loading των συνταγών
                await page.evaluate(() => window.scrollBy(0, 2000));
                await sleep(2000);

                const found = await page.evaluate(() => {
                    return Array.from(document.querySelectorAll('a'))
                        .map(a => a.href)
                        .filter(href => href.includes('/recipe/')); // Εδώ παίρνουμε τις συνταγές
                });

                found.forEach(l => {
                    const cleanUrl = l.split('?')[0].split('#')[0];
                    allRecipeLinks.add(cleanUrl);
                });
                console.log(`      ✨ Βρέθηκαν ${found.length} συνταγές.`);
            } catch (e) {
                console.log(`      ⚠️ Παράκαμψη λόγω timeout.`);
            }
        }

        // Αποθήκευση στο JSON
        const resultPath = path.join(__dirname, '../akis_links.json');
        const finalLinks = Array.from(allRecipeLinks);
        
        fs.writeFileSync(resultPath, JSON.stringify(finalLinks, null, 2));
        console.log(`\n✅ ΟΛΟΚΛΗΡΩΘΗΚΕ! Σώθηκαν ${finalLinks.length} συνταγές στο 'akis_links.json'`);

    } catch (error) {
        console.error("❌ Σφάλμα Crawler:", error.message);
    } finally {
        await browser.close();
    }
}

if (require.main === module) {
    runAkisCrawler();
}

module.exports = { runAkisCrawler };