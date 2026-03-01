// runAll.js
const dns = require("node:dns/promises");
dns.setServers(["1.1.1.1", "1.0.0.1", "8.8.8.8"]);
require('dotenv').config();
const mongoose = require('mongoose');
const { runLinkCrawler } = require('./services/linkCrawler');
const { runWebScraper } = require('./services/scraper');

(async () => {
    console.log("🚀 ΕΚΚΙΝΗΣΗ ΤΟΥ ΑΠΟΛΥΤΟΥ ΑΥΤΟΜΑΤΙΣΜΟΥ (SEQUENTIAL MODE) 🚀\n");

    const dbURI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/smart_grocery';
    await mongoose.connect(dbURI);
    console.log("📦 [1/4] Συνδέθηκε στη MongoDB (Atlas) επιτυχώς.");

    // --- ΒΗΜΑ 2: CRAWLER ΤΟΥ ΑΒ ---
    console.log("\n🕸️ [2/4] Εκκίνηση Omni-Spider (Εύρεση Links για ΑΒ Βασιλόπουλο)...");
    await runLinkCrawler();

    // --- ΒΗΜΑ 3: SCRAPER ΑΠΟΚΛΕΙΣΤΙΚΑ ΓΙΑ ΤΟΝ ΑΒ ---
    console.log("\n🛒 [3/4] Εκκίνηση Stealth Cluster (ΜΟΝΟ για ΑΒ Βασιλόπουλο)...");
    await runWebScraper('ab');

    // --- ΒΗΜΑ 4: SCRAPER ΓΙΑ ΤΑ ΥΠΟΛΟΙΠΑ SUPERMARKETS ---
    console.log("\n🛒 [4/4] Εκκίνηση Stealth Cluster (Για τα υπόλοιπα 6 Supermarkets)...");
    await runWebScraper('rest');

    console.log("\n✅ ΟΛΕΣ ΟΙ ΔΙΕΡΓΑΣΙΕΣ ΟΛΟΚΛΗΡΩΘΗΚΑΝ ΕΠΙΤΥΧΩΣ. Κλείσιμο Συστήματος.");
    process.exit(0);
})();