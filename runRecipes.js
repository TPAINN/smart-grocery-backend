// runRecipes.js
require('dotenv').config();
const dns = require("node:dns/promises");
dns.setServers(["1.1.1.1", "1.0.0.1", "8.8.8.8"]);
const mongoose = require('mongoose');
const { populateRecipes } = require('./services/recipeScraper');

const dbURI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/smart_grocery';

mongoose.connect(dbURI).then(async () => {
    console.log("📦 Συνδέθηκε στη βάση. Ξεκινάει η λήψη Συνταγών...");
    await populateRecipes();
    process.exit(0);
}).catch(err => console.log(err));