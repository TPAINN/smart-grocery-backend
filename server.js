// server.js
require('dotenv').config();
const dns = require("node:dns/promises");
dns.setServers(["1.1.1.1", "1.0.0.1", "8.8.8.8"]);
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

// Εισαγωγή των Scrapers και του Status
const { startCronJobs, runWebScraper, getScrapingStatus } = require('./services/scraper');
const { populateRecipes } = require('./services/recipeScraper');
const Product = require('./models/Product');

const app = express();

// --- 1. MIDDLEWARES & ΡΑΝΤΑΡ ---
app.use(cors()); 
app.use(express.json()); 

app.use((req, res, next) => {
    console.log(`🌍 [ΡΑΝΤΑΡ] Ήρθε αίτημα: ${req.method} ${req.url}`);
    next();
});

// --- 2. ΣΥΝΔΕΣΗ ΜΕ ΤΗ ΒΑΣΗ ΔΕΔΟΜΕΝΩΝ (CLOUD ATLAS) ---
const dbURI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/smart_grocery';
mongoose.connect(dbURI)
    .then(() => console.log('📦 Συνδέθηκε επιτυχώς στη MongoDB Atlas!'))
    .catch(err => console.error('❌ Αποτυχία σύνδεσης στη MongoDB:', err));

// --- 3. BACKGROUND ΕΡΓΑΣΙΕΣ ---
startCronJobs();

// --- 4. API ROUTES ---

// Α. Τιμές Supermarkets
const pricesRoutes = require('./routes/prices');
app.use('/api/prices', pricesRoutes);

// Β. Έλεγχος Κατάστασης Scraper (Αυτό ρωτάει το React κάθε 15 δευτερόλεπτα)
app.get('/api/status', (req, res) => {
    res.status(200).json({ isScraping: getScrapingStatus() });
});

// Γ. Αυτοματοποίηση: Εκκίνηση Supermarket Scraper (Από cron-job.org)
app.get('/api/force-scrape', (req, res) => {
    if (req.query.secret !== (process.env.CRON_SECRET || 'MySecretRunKey123')) {
        return res.status(403).json({ message: 'Απαγορεύεται η πρόσβαση. Λάθος Κωδικός Ασφαλείας.' });
    }
    
    runWebScraper(); 
    res.status(200).send('🚀 Το Master Scraper ξεκίνησε αυτόματα στο παρασκήνιο!');
});

// Δ. Αυτοματοποίηση: Εκκίνηση Recipe Scraper (Από cron-job.org)
app.get('/api/force-recipes', (req, res) => {
    if (req.query.secret !== (process.env.CRON_SECRET || 'MySecretRunKey123')) {
        return res.status(403).json({ message: 'Απαγορεύεται η πρόσβαση. Λάθος Κωδικός Ασφαλείας.' });
    }
    
    populateRecipes(); 
    res.status(200).send('👨‍🍳 Το Recipe Scraper ξεκίνησε αυτόματα στο παρασκήνιο!');
});

// DevTools bypass
app.get('/.well-known/appspecific/com.chrome.devtools.json', (req, res) => {
    res.status(200).json({});
});

// Ε. Users, Lists & Recipes
const authRoutes = require('./routes/auth');
const listRoutes = require('./routes/lists');
const recipeRoutes = require('./routes/recipes');

app.use('/api/auth', authRoutes);
app.use('/api/lists', listRoutes);
app.use('/api/recipes', recipeRoutes);

// --- 5. ΕΚΚΙΝΗΣΗ SERVER ---
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`🚀 Ο Server τρέχει στη διεύθυνση: http://localhost:${PORT}`);
});