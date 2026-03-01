const dns = require("node:dns/promises");
dns.setServers(["1.1.1.1", "1.0.0.1", "8.8.8.8"]);
require('dotenv').config();
const mongoose = require('mongoose');
const { runLinkCrawler } = require('./services/linkCrawler');
const { runWebScraper } = require('./services/scraper');

(async () => {
    console.log("🚀 ΕΚΚΙΝΗΣΗ ΤΟΥ ΑΠΟΛΥΤΟΥ ΑΥΤΟΜΑΤΙΣΜΟΥ 🚀\n");

    const dbURI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/smart_grocery';
    await mongoose.connect(dbURI);
    console.log("📦 [1/3] Συνδέθηκε στη MongoDB (Atlas) επιτυχώς.");

    // --- ΜΕΤΑ Ο CRAWLER ΤΟΥ ΑΒ ---
    console.log("\n🕸️ [2/3] Εκκίνηση Crawler (Για εύρεση Links του ΑΒ)...");
    await runLinkCrawler();

    // --- ΤΕΛΟΣ ΤΑ ΥΠΟΛΟΙΠΑ WEBSITES ---
    console.log("\n🛒 [3/3] Εκκίνηση Web Scraper (Για τα υπόλοιπα 6 Supermarkets)...");
    await runWebScraper();

    console.log("\n✅ ΟΛΕΣ ΟΙ ΔΙΕΡΓΑΣΙΕΣ ΟΛΟΚΛΗΡΩΘΗΚΑΝ. Κλείσιμο Συστήματος.");
    process.exit(0);
})();