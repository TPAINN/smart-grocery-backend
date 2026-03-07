// server.js
require('dotenv').config();
const dns = require("node:dns/promises");
dns.setServers(["1.1.1.1", "1.0.0.1", "8.8.8.8"]);

const express    = require('express');
const mongoose   = require('mongoose');
const cors       = require('cors');
const rateLimit  = require('express-rate-limit');
const http       = require('http');
const { Server } = require('socket.io');

const { startCronJobs, runWebScraper, getScrapingStatus } = require('./services/scraper');
const { populateRecipes } = require('./services/recipeScraper');

const chatRoutes = require('./routes/chat');
app.use('/api/chat', chatRoutes);

const app    = express();
const server = http.createServer(app);

// 🔴 FIX: CORS whitelist
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173').split(',');

const io = new Server(server, {
  cors: { origin: allowedOrigins }
});

// ── CORS ──────────────────────────────────────────────────
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Not allowed by CORS'));
  },
}));

app.use(express.json());

// ── Rate Limiting ─────────────────────────────────────────
// 🔴 FIX: Brute force protection
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Πολλές προσπάθειες σύνδεσης. Δοκίμασε ξανά σε 15 λεπτά.' },
});

// ── Logging ───────────────────────────────────────────────
app.use((req, res, next) => {
  console.log(`🌍 [ΡΑΝΤΑΡ] Ήρθε αίτημα: ${req.method} ${req.url}`);
  next();
});

// ── MongoDB ───────────────────────────────────────────────
const dbURI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/smart_grocery';
mongoose.connect(dbURI)
  .then(() => console.log('📦 Συνδέθηκε επιτυχώς στη MongoDB Atlas!'))
  .catch(err => console.error('❌ Αποτυχία σύνδεσης στη MongoDB:', err));

// ── Background Jobs ───────────────────────────────────────
startCronJobs();

// ── Routes ────────────────────────────────────────────────
const pricesRoutes  = require('./routes/prices');
const authRoutes    = require('./routes/auth');
const listRoutes    = require('./routes/lists');
const recipeRoutes  = require('./routes/recipes');

app.use('/api/prices',  pricesRoutes);
app.use('/api/auth',    authLimiter, authRoutes); // 🔴 FIX: Rate limit
app.use('/api/lists',   listRoutes);
app.use('/api/recipes', recipeRoutes);

// ── Status ────────────────────────────────────────────────
app.get('/api/status', (req, res) => {
  res.status(200).json({ isScraping: getScrapingStatus() });
});

// ── Force Scrape (protected) ──────────────────────────────
// 🔴 FIX: Χωρίς hardcoded fallback secret
app.get('/api/force-scrape', (req, res) => {
  if (!process.env.CRON_SECRET || req.query.secret !== process.env.CRON_SECRET) {
    return res.status(403).json({ message: 'Απαγορεύεται η πρόσβαση.' });
  }
  runWebScraper();
  res.status(200).send('🚀 Το Master Scraper ξεκίνησε!');
});

app.get('/api/force-recipes', (req, res) => {
  if (!process.env.CRON_SECRET || req.query.secret !== process.env.CRON_SECRET) {
    return res.status(403).json({ message: 'Απαγορεύεται η πρόσβαση.' });
  }
  populateRecipes();
  res.status(200).send('👨‍🍳 Το Recipe Scraper ξεκίνησε!');
});

// ── Health Check ──────────────────────────────────────────
app.get('/api/health', (req, res) => res.status(200).send('OK'));

// ── WebSockets / Shared Cart & Chat ───────────────────────
io.on('connection', (socket) => {
  console.log('🔌 Νέα σύνδεση WebSocket:', socket.id);

  socket.on('join_cart', (shareKey) => {
    socket.join(shareKey);
    console.log(`👥 Ο χρήστης μπήκε στο δωμάτιο: ${shareKey}`);
  });

  socket.on('send_item', (data) => {
    socket.to(data.shareKey).emit('receive_item', data.item);
  });

  // ΝΕΟ: Λήψη και αποστολή μηνύματος CHAT
  socket.on('send_message', async (data) => {
    // 1. Αποθήκευση στη βάση (για να το βρουν όσοι μπουν αργότερα)
    const newMessage = new Message({
      shareKey: data.shareKey,
      senderName: data.senderName,
      text: data.text
    });
    await newMessage.save();

    // 2. Αποστολή στους υπόλοιπους που είναι online τώρα
    socket.to(data.shareKey).emit('receive_message', newMessage);
  });
});

// ── Chrome DevTools bypass ────────────────────────────────
app.get('/.well-known/appspecific/com.chrome.devtools.json', (req, res) => {
  res.status(200).json({});
});

// ── Start ─────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Ο Server τρέχει στη θύρα: ${PORT}`);
});