require('dotenv').config();
const dns = require("node:dns/promises");
dns.setServers(["1.1.1.1", "1.0.0.1", "8.8.8.8"]);
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const { startCronJobs, runWebScraper } = require('./services/scraper');
const Product = require('./models/Product');


const app = express();

// --- 1. MIDDLEWARES & ΡΑΝΤΑΡ ---
app.use(cors()); 
app.use(express.json()); 

// Το Ραντάρ: Τυπώνει κάθε αίτημα που έρχεται από το React!
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
const pricesRoutes = require('./routes/prices');
app.use('/api/prices', pricesRoutes);

// ENDPOINT ΓΙΑ ΤΟ CRON-JOB (Το Κρυφό μας Όπλο για να τρέχει Δωρεάν)
app.get('/api/force-scrape', (req, res) => {
    // ΠΡΟΣΤΑΣΙΑ: Τρέχει ΜΟΝΟ αν δώσουμε -από τον αυτοματισμό- τον μυστικό κωδικό
    if (req.query.secret !== (process.env.CRON_SECRET || 'MySecretRunKey123')) {
        return res.status(403).json({ message: 'Απαγορεύεται η πρόσβαση. Λάθος Κωδικός Ασφαλείας.' });
    }
    
    // Ξεκινάει στο Background! ΔΕΝ βάζουμε `await` εδώ γιατί το Render θα κόψει...
    // ...τη σύνδεση με το cron-job web αν αργήσει! Επιστρέφουμε OK ακαριαία.
    runWebScraper(); 
    
    res.status(200).send('🚀 Το Master Scraper ξεκίνησε αυτόματα στο παρασκήνιο!');
});

app.get('/.well-known/appspecific/com.chrome.devtools.json', (req, res) => {
    res.status(200).json({});
});

// Φορτώνουμε τα Routes για Users & Lists
const authRoutes = require('./routes/auth');
const listRoutes = require('./routes/lists');

app.use('/api/auth', authRoutes);
app.use('/api/lists', listRoutes);

// --- 5. ΑΝΟΙΓΟΥΜΕ ΤΟΝ SERVER (Συμβατότητα με Render) ---
// Το Render δίνει δικό του PORT, άρα διαβάζουμε πρώτα το env.PORT.
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`🚀 Ο Server τρέχει στη διεύθυνση: http://localhost:${PORT}`);
});