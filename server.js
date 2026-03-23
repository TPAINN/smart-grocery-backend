// server.js — Καλαθάκι Backend (Full Production)
require('dotenv').config();
const dns = require('node:dns/promises');
dns.setServers(['1.1.1.1', '1.0.0.1', '8.8.8.8']);

const express    = require('express');
const mongoose   = require('mongoose');
const cors       = require('cors');
const rateLimit  = require('express-rate-limit');
const http       = require('http');
const { Server } = require('socket.io');

// ── Models ────────────────────────────────────────────────────────────────────
const Message = require('./models/Message');

// ── Services ──────────────────────────────────────────────────────────────────
const { startCronJobs, runWebScraper, getScrapingStatus } = require('./services/scraper');
const { populateRecipes } = require('./services/recipeScraper');

// ── App ───────────────────────────────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);

// ── Trust Proxy (ΚΡΙΣΙΜΟ για Render / nginx) ──────────────────────────────────
// Χωρίς αυτό, το rate-limit βλέπει την IP του proxy σαν IP ΟΛΩΝ των χρηστών
app.set('trust proxy', 1);

// ── CORS ──────────────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173').split(',');

const io = new Server(server, {
  cors: { origin: allowedOrigins, methods: ['GET', 'POST'] },
  transports: ['websocket', 'polling'],
});

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Not allowed by CORS'));
  },
}));

app.use(express.json());

// ── Rate Limiting ─────────────────────────────────────────────────────────────

// Για /me, /friends, /refresh-premium, /by-key, /search κτλ — χαλαρό
const generalAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Πολλές προσπάθειες. Δοκίμασε ξανά σε 15 λεπτά.' },
});

// ── Logging ───────────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  console.log(`🌍 [${req.method}] ${req.url}`);
  next();
});

// ── MongoDB ───────────────────────────────────────────────────────────────────
mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/smart_grocery')
  .then(() => console.log('📦 MongoDB connected!'))
  .catch(err => console.error('❌ MongoDB error:', err));

// ── Background Jobs ───────────────────────────────────────────────────────────
startCronJobs();

// ── Routes ────────────────────────────────────────────────────────────────────
const authRoutes      = require('./routes/auth');
const pricesRoutes    = require('./routes/prices');
const listRoutes      = require('./routes/lists');
const recipeRoutes    = require('./routes/recipes');
const chatRoutes      = require('./routes/chat');
const mealPlanRoutes  = require('./routes/mealplan');
const favoritesRoutes = require('./routes/favorites');

// Wire io to auth so notify-friend can emit socket events
if (typeof authRoutes.setIO === 'function') authRoutes.setIO(io);

// Το strictLimiter για register/login ορίζεται μέσα στο routes/auth.js
app.use('/api/auth',      generalAuthLimiter, authRoutes);
app.use('/api/prices',    pricesRoutes);
app.use('/api/lists',     listRoutes);
app.use('/api/recipes',   recipeRoutes);
app.use('/api/chat',      chatRoutes);
app.use('/api/meal-plan', mealPlanRoutes);
app.use('/api/favorites', favoritesRoutes);

// ── Health & Admin ────────────────────────────────────────────────────────────
app.get('/api/health',  (req, res) => res.status(200).send('OK'));
app.get('/api/status',  (req, res) => res.json({ isScraping: getScrapingStatus() }));

app.get('/api/force-scrape', (req, res) => {
  if (!process.env.CRON_SECRET || req.query.secret !== process.env.CRON_SECRET)
    return res.status(403).json({ message: 'Απαγορεύεται.' });
  runWebScraper();
  res.send('🚀 Scraper started!');
});

app.get('/api/force-recipes', (req, res) => {
  if (!process.env.CRON_SECRET || req.query.secret !== process.env.CRON_SECRET)
    return res.status(403).json({ message: 'Απαγορεύεται.' });
  populateRecipes();
  res.send('👨‍🍳 Recipe scraper started!');
});

app.get('/.well-known/appspecific/com.chrome.devtools.json', (req, res) => res.json({}));

// ── WebSockets ────────────────────────────────────────────────────────────────
// Architecture:
//  • Each user joins room = their shareKey  (receives messages FROM friends)
//  • Each user joins room = `user_${shareKey}` (receives friend_added notifications)
//  • When A sends a message it broadcasts to ALL friends' shareKey rooms
//  • This way B sees A's messages because B joined A's room and vice-versa

io.on('connection', (socket) => {
  console.log('🔌 Socket connected:', socket.id);

  // ── Room join ────────────────────────────────────────────────────────────
  socket.on('join_cart', (shareKey) => {
    if (!shareKey) return;
    socket.join(shareKey);
    console.log(`👥 Joined cart room: ${shareKey}`);
  });

  // Personal notification room (e.g. `user_ABC123`)
  socket.on('join_user_room', (shareKey) => {
    if (!shareKey) return;
    socket.join(`user_${shareKey}`);
    console.log(`🔔 Joined user room: user_${shareKey}`);
  });

  // ── Send item to friend ───────────────────────────────────────────────────
  socket.on('send_item', (data) => {
    if (!data?.shareKey) return;
    socket.to(data.shareKey).emit('receive_item', data.item);
  });

  // ── Send message ──────────────────────────────────────────────────────────
  // data = { shareKey, senderName, text, friendShareKeys[], targetShareKey? }
  // If targetShareKey is set → private DM to one friend only
  // Otherwise → broadcast to all friend rooms (group chat)
  socket.on('send_message', async (data) => {
    try {
      const newMessage = await Message.create({
        shareKey:       data.shareKey,
        senderName:     data.senderName,
        text:           data.text,
        targetShareKey: data.targetShareKey || null,
      });

      if (data.targetShareKey) {
        // ── Private DM: send only to the target friend's room ──────────────
        socket.to(data.targetShareKey).emit('receive_message', newMessage);
        // Also echo back to sender's other sessions
        socket.to(data.shareKey).emit('receive_message', newMessage);
      } else {
        // ── Group message: broadcast to all friend rooms ────────────────────
        socket.to(data.shareKey).emit('receive_message', newMessage);
        if (Array.isArray(data.friendShareKeys)) {
          data.friendShareKeys.forEach(fKey => {
            if (fKey !== data.shareKey) {
              socket.to(fKey).emit('receive_message', newMessage);
            }
          });
        }
      }
    } catch (err) {
      console.error('❌ Message save error:', err);
    }
  });

  // ── Friend added notification ─────────────────────────────────────────────
  // When A adds B: emit to B's personal room so they auto-add A back
  socket.on('friend_added', (data) => {
    if (!data?.targetShareKey || !data?.from) return;
    // Emit to B's personal notification room
    io.to(`user_${data.targetShareKey}`).emit('friend_added', data);
    // Also make the sender join B's cart room on their socket
    socket.join(data.targetShareKey);
    console.log(`🤝 Friend notification: ${data.from.shareKey} → ${data.targetShareKey}`);
  });

  socket.on('disconnect', () => {
    console.log('🔌 Socket disconnected:', socket.id);
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));