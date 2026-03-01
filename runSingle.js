const dns = require("node:dns/promises");
dns.setServers(["1.1.1.1", "1.0.0.1", "8.8.8.8"]);
require('dotenv').config();
const mongoose = require('mongoose');
const { runWebScraper } = require('./services/scraper');

// Παίρνουμε τη λέξη που γράφεις στο τερματικό
const target = process.argv[2];

(async () => {
    if (!target) {
        console.log("❌ ΠΡΟΣΟΧΗ: Πρέπει να γράψεις το όνομα του καταστήματος!");
        console.log("👉 Παράδειγμα: node runSingle.js mymarket");
        process.exit(1);
    }

    const dbURI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/smart_grocery';
    await mongoose.connect(dbURI);
    console.log("📦 Συνδέθηκε στη βάση (Atlas)...");

    await runWebScraper(target); // Το περνάμε στον Scraper!

    console.log("\n✅ Το Test ολοκληρώθηκε.");
    process.exit(0);
})();