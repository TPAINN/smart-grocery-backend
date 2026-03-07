// clearRecipes.js
require('dotenv').config();
const dns = require("node:dns/promises");
dns.setServers(["1.1.1.1", "1.0.0.1", "8.8.8.8"]);
const mongoose = require('mongoose');
const Recipe = require('./models/Recipe');

const dbURI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/smart_grocery';

mongoose.connect(dbURI).then(async () => {
    console.log("📦 Συνδέθηκε στη βάση δεδομένων.");
    console.log("🧹 Διαγραφή όλων των συνταγών...");
    
    try {
        const result = await Recipe.deleteMany({});
        console.log(`✅ Η βάση καθάρισε! Διαγράφηκαν ${result.deletedCount} συνταγές.`);
    } catch (error) {
        console.error("❌ Σφάλμα κατά τη διαγραφή:", error);
    } finally {
        process.exit(0);
    }
}).catch(err => {
    console.error("❌ Αποτυχία σύνδεσης στη MongoDB:", err);
    process.exit(1);
});