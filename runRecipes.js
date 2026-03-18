// runRecipes.js — Τρέχει μόνο τους recipe scrapers (API + Web sites)
// Χρήση: node runRecipes.js
require('dotenv').config();
const dns = require('node:dns/promises');
dns.setServers(['1.1.1.1', '1.0.0.1', '8.8.8.8']);
const mongoose = require('mongoose');

const { populateRecipes }  = require('./services/recipeScraper');
const { scrapeWebRecipes } = require('./services/webRecipeScraper');

const dbURI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/smart_grocery';

(async () => {
    console.log('🍳 ΕΚΚΙΝΗΣΗ RECIPE SCRAPER\n');

    await mongoose.connect(dbURI);
    console.log('📦 [1/3] Συνδέθηκε στη MongoDB επιτυχώς.\n');

    console.log('👨‍🍳 [2/3] Spoonacular API...');
    await populateRecipes();

    console.log('\n🌐 [3/3] Ελληνικά Sites (Άκης, Πάνος, GymBeam, NutriRoots)...');
    await scrapeWebRecipes('all');

    console.log('\n✅ Έτοιμο!');
    process.exit(0);
})().catch(err => { console.error('❌', err); process.exit(1); });