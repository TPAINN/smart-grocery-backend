// services/linkCrawler.js
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');
puppeteer.use(StealthPlugin());

const BASE_URLS =[
    { name: 'ΑΒ Βασιλόπουλος', url: 'https://www.ab.gr/el/eshop' }
];

// --- TO ΣΗΜΑΝΤΙΚΟΤΕΡΟ: ΤΟ ΒΑΘΟΣ (DEPTH) ---
const MAX_DEPTH = 2; 

async function runLinkCrawler() {
    console.log(`\n🕷️ Εκκίνηση OMNI-SPIDER (Recursive Crawl | Max Depth: ${MAX_DEPTH})`);
    let browser;
    let allFoundLinks = {};

    try {
        browser = await puppeteer.launch({ 
            headless: "new", 
            args:['--no-sandbox', '--disable-setuid-sandbox'] 
        }); 
        
        const page = await browser.newPage();
        
        // Ακραία βελτιστοποίηση: Θέλουμε ΜΟΝΟ το HTML για να βρούμε τα links (<a> tags)
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            if (['image', 'font', 'stylesheet', 'media'].includes(req.resourceType())) req.abort();
            else req.continue();
        });

        for (const store of BASE_URLS) {
            console.log(`\n🔍 Ρίχνω τα δίχτυα μου στο: ${store.name}`);
            
            let queue =[{ url: store.url, depth: 0 }];
            let visited = new Set([store.url]);
            let validCategories = new Set(); 

            while (queue.length > 0) {
                const current = queue.shift(); 
                
                // --- ΕΛΕΓΧΟΣ ΒΑΘΟΥΣ ---
                if (current.depth > MAX_DEPTH) continue;

                console.log(`   🕸️[Βάθος: ${current.depth}] Σκανάρω: ${current.url}`);
                
                try {
                    await page.goto(current.url, { waitUntil: 'domcontentloaded', timeout: 30000 });

                    // Εξάγουμε ΟΛΑ τα links της σελίδας
                    const linksOnPage = await page.evaluate(() => {
                        return Array.from(document.querySelectorAll('a')).map(a => a.href).filter(h => h);
                    });

                    for (let rawUrl of linksOnPage) {
                        const cleanUrl = rawUrl.split('#')[0].split('?')[0]; // Βγάζουμε σκουπίδια και tracking

                        if (visited.has(cleanUrl)) continue;

                        let isCategory = false;
                        
                        // ΦΙΛΤΡΟ ΜΟΝΟ ΓΙΑ ΑΒ ΒΑΣΙΛΟΠΟΥΛΟ
                        // Αν το link περιέχει '/c/' (Category), είναι η "φλέβα" δεδομένων μας!
                        if (store.name === 'ΑΒ Βασιλόπουλος' && cleanUrl.includes('/c/')) {
                            isCategory = true;
                        }

                        // Αν είναι Κατηγορία, τη σώζουμε
                        if (isCategory) {
                            validCategories.add(cleanUrl);
                            visited.add(cleanUrl);
                            
                            // Πάμε πιο βαθιά?
                            if (current.depth + 1 <= MAX_DEPTH) {
                                queue.push({ url: cleanUrl, depth: current.depth + 1 });
                            }
                        } else {
                            visited.add(cleanUrl);
                        }
                    }
                } catch (e) {
                    console.log(`   ⚠️ Αποτυχία φόρτωσης: ${current.url}`);
                }
            }

            const finalArray = Array.from(validCategories);
            console.log(`✔️ Ολοκληρώθηκε! Βρέθηκαν ${finalArray.length} κατηγορίες (Depth ${MAX_DEPTH}) για το ${store.name}.`);
            allFoundLinks[store.name] = finalArray; 
        }

        // Σώζουμε τα links στο JSON που διαβάζει ο V3 Scraper μας
        const jsonPath = path.join(__dirname, '../category_links.json');
        fs.writeFileSync(jsonPath, JSON.stringify(allFoundLinks, null, 2), 'utf-8');
        console.log(`💾 Τα links εγγράφηκαν επιτυχώς στο 'category_links.json'!`);

    } catch (error) {
        console.error("❌ Σφάλμα Omni-Spider:", error);
    } finally {
        if (browser) await browser.close();
    }
}

// Αυτό επιτρέπει στο αρχείο να τρέξει μόνο του αν το καλέσουμε με "node"
if (require.main === module) {
    runLinkCrawler().then(() => process.exit(0));
}

module.exports = { runLinkCrawler };