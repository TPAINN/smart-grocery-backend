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

// Models & Services
const { startCronJobs, runWebScraper, getScrapingStatus } = require('./services/scraper');
const { populateRecipes } = require('./services/recipeScraper');
const Message = require('./models/Message');

// Initializations
const app    = express();
const server = http.createServer(app);

// Routes
const pricesRoutes    = require('./routes/prices');
const authRoutes      = require('./routes/auth');
const listRoutes      = require('./routes/lists');
const recipeRoutes    = require('./routes/recipes');
const chatRoutes      = require('./routes/chat');
const splitBillRoutes = require('./routes/splitbill');
const mealPlanRoutes  = require('./routes/mealplan');

// 🔴 FIX: CORS whitelist
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173').split(',');

const io = new Server(server, {
  cors: { origin: allowedOrigins }
});

// ── CORS & Middleware ────────────────────────────────────
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Not allowed by CORS'));
  },
}));

app.use(express.json());

// ── Rate Limiting ─────────────────────────────────────────
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

// ── Routes Registration ───────────────────────────────────
app.use('/api/prices',    pricesRoutes);
app.use('/api/auth',      authLimiter, authRoutes);
app.use('/api/lists',     listRoutes);
app.use('/api/recipes',   recipeRoutes);
app.use('/api/chat',      chatRoutes);
app.use('/api/split',     splitBillRoutes);
app.use('/api/meal-plan', mealPlanRoutes);

// ── Status & Actions ──────────────────────────────────────
app.get('/api/status', (req, res) => {
  res.status(200).json({ isScraping: getScrapingStatus() });
});

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

  socket.on('send_message', async (data) => {
    try {
        const newMessage = new Message({
          shareKey: data.shareKey,
          senderName: data.senderName,
          text: data.text
        });
        await newMessage.save();
        socket.to(data.shareKey).emit('receive_message', newMessage);
    } catch (err) {
        console.error("❌ Σφάλμα αποθήκευσης μηνύματος:", err);
    }
  });

  // ── Split Bill real-time events ───────────────────────────
  socket.on('split_join', (sessionId) => {
    socket.join(`split_${sessionId}`);
    console.log(`💸 Split room joined: split_${sessionId}`);
  });

  // Notify all participants when someone accepts/rejects
  socket.on('split_consent_update', (data) => {
    socket.to(`split_${data.sessionId}`).emit('split_consent_update', {
      userId:   data.userId,
      username: data.username,
      status:   data.status,    // 'accepted' | 'rejected'
      allAccepted: data.allAccepted,
    });
  });

  // Notify when payment is executed
  socket.on('split_payment_complete', (data) => {
    socket.to(`split_${data.sessionId}`).emit('split_payment_complete', {
      sessionId: data.sessionId,
      results:   data.results,
    });
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