// runAll.js
const dns = require("node:dns/promises");
dns.setServers(["1.1.1.1", "1.0.0.1", "8.8.8.8"]);
require('dotenv').config();
const mongoose = require('mongoose');

const { runLinkCrawler }    = require('./services/linkCrawler');
const { runWebScraper }     = require('./services/scraper');
const { populateRecipes }   = require('./services/recipeScraper');
const { scrapeWebRecipes }  = require('./services/webRecipeScraper');

(async () => {
    console.log("🚀 ΕΚΚΙΝΗΣΗ ΤΟΥ ΑΠΟΛΥΤΟΥ MASTER ORCHESTRATOR 🚀\n");

    const dbURI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/smart_grocery';
    await mongoose.connect(dbURI);
    console.log("📦 [1/5] Συνδέθηκε στη MongoDB (Atlas) επιτυχώς.");

    // Βάζουμε πρώτες τις συνταγές γιατί είναι ελαφριές και γρήγορες
    console.log("\n👨‍🍳 [2/6] Εκκίνηση Multi-Chef Recipe Scraper (Spoonacular)...");
    await populateRecipes();

    console.log("\n🍳 [3/6] Εκκίνηση Web Recipe Scraper (Ελληνικά sites)...");
    await scrapeWebRecipes('all');

    console.log("\n🕸️ [4/6] Εκκίνηση Omni-Spider (Εύρεση Links για ΑΒ Βασιλόπουλο)...");
    await runLinkCrawler();

    console.log("\n🛒 [5/6] Εκκίνηση Stealth Cluster (ΜΟΝΟ για ΑΒ Βασιλόπουλο)...");
    await runWebScraper('ab');

    console.log("\n🛒 [6/6] Εκκίνηση Stealth Cluster (Για τα υπόλοιπα 6 Supermarkets)...");
    await runWebScraper('rest');

    console.log("\n✅ ΟΛΕΣ ΟΙ ΔΙΕΡΓΑΣΙΕΣ ΟΛΟΚΛΗΡΩΘΗΚΑΝ ΕΠΙΤΥΧΩΣ. Κλείσιμο Συστήματος.");
    process.exit(0);
})();