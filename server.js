// server.js
require('dotenv').config();
const dns = require("node:dns/promises");
dns.setServers(["1.1.1.1", "1.0.0.1", "8.8.8.8"]);

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

// Εισαγωγή των Scrapers και του Status
const { startCronJobs, runWebScraper, getScrapingStatus } = require('./services/scraper');
const { populateRecipes } = require('./services/recipeScraper');

const app = express(); // Πρώτη και μοναδική δήλωση
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// --- MIDDLEWARES ---
app.use(cors()); 
app.use(express.json()); 

app.use((req, res, next) => {
    console.log(`🌍 [ΡΑΝΤΑΡ] Ήρθε αίτημα: ${req.method} ${req.url}`);
    next();
});

// --- 2. ΣΥΝΔΕΣΗ ΜΕ ΤΗ ΒΑΣΗ ΔΕΔΟΜΕΝΩΝ ---
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

// Β. Έλεγχος Κατάστασης Scraper
app.get('/api/status', (req, res) => {
    res.status(200).json({ isScraping: getScrapingStatus() });
});

// Γ. Αυτοματοποίηση: Εκκίνηση Supermarket Scraper
app.get('/api/force-scrape', (req, res) => {
    if (req.query.secret !== (process.env.CRON_SECRET || 'MySecretRunKey123')) {
        return res.status(403).json({ message: 'Απαγορεύεται η πρόσβαση.' });
    }
    runWebScraper(); 
    res.status(200).send('🚀 Το Master Scraper ξεκίνησε!');
});

// Δ. Αυτοματοποίηση: Εκκίνηση Recipe Scraper
app.get('/api/force-recipes', (req, res) => {
    if (req.query.secret !== (process.env.CRON_SECRET || 'MySecretRunKey123')) {
        return res.status(403).json({ message: 'Απαγορεύεται η πρόσβαση.' });
    }
    populateRecipes(); 
    res.status(200).send('👨‍🍳 Το Recipe Scraper ξεκίνησε!');
});

// 🟢 Health Check για Render (Cron-job.org)
app.get('/api/health', (req, res) => res.status(200).send('OK'));

// 🚀 WebSockets / Shared Cart Logic
io.on('connection', (socket) => {
  console.log('🔌 Νέα σύνδεση WebSocket:', socket.id);

  socket.on('join_cart', (shareKey) => {
    socket.join(shareKey);
    console.log(`👥 Ο χρήστης μπήκε στο δωμάτιο: ${shareKey}`);
  });
  
  socket.on('send_item', (data) => {
    // Broadcast σε όλους στο δωμάτιο ΕΚΤΟΣ από τον εαυτό του
    socket.to(data.shareKey).emit('receive_item', data.item);
  });
});

// Ε. Λοιπά Routes
const authRoutes = require('./routes/auth');
const listRoutes = require('./routes/lists');
const recipeRoutes = require('./routes/recipes');

app.use('/api/auth', authRoutes);
app.use('/api/lists', listRoutes);
app.use('/api/recipes', recipeRoutes);

// DevTools bypass
app.get('/.well-known/appspecific/com.chrome.devtools.json', (req, res) => {
    res.status(200).json({});
});

// --- 5. ΕΚΚΙΝΗΣΗ ---
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Ο Server τρέχει στη θύρα: ${PORT}`);
});