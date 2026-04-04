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
const { estimateMacros }  = require('./services/macroEstimator');
const Recipe              = require('./models/Recipe');

// ── In-memory cache (reduces MongoDB load) ───────────────────────────────────
const NodeCache = require('node-cache');
const apiCache  = new NodeCache({ stdTTL: 300, checkperiod: 60 }); // 5 min default TTL

function cacheMiddleware(ttl = 300) {
  return (req, res, next) => {
    // Only cache GET requests; skip if query has auth-specific params
    if (req.method !== 'GET') return next();
    const key = req.originalUrl;
    const hit = apiCache.get(key);
    if (hit !== undefined) return res.json(hit);
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode === 200) apiCache.set(key, body, ttl);
      return originalJson(body);
    };
    next();
  };
}

// ── App ───────────────────────────────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);

// ── Trust Proxy (ΚΡΙΣΙΜΟ για Render / nginx) ──────────────────────────────────
// Χωρίς αυτό, το rate-limit βλέπει την IP του proxy σαν IP ΟΛΩΝ των χρηστών
app.set('trust proxy', 1);

// ── Security headers ──────────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// ── CORS ──────────────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173').split(',');

// Προσθέτουμε πάντα τα Capacitor origins για το Android APK
const CAPACITOR_ORIGINS = [
  'capacitor://localhost',
  'http://localhost',
  'ionic://localhost',
];

const isOriginAllowed = (origin) => {
  if (!origin) return true; // server-to-server ή native app χωρίς origin header
  if (allowedOrigins.includes(origin)) return true;
  if (CAPACITOR_ORIGINS.includes(origin)) return true;
  return false;
};

const io = new Server(server, {
  cors: { origin: (origin, cb) => cb(null, isOriginAllowed(origin)), methods: ['GET', 'POST'] },
  transports: ['websocket', 'polling'],
});

app.use(cors({
  origin: (origin, callback) => {
    if (isOriginAllowed(origin)) return callback(null, true);
    return callback(new Error('Not allowed by CORS'));
  },
}));

// ── Stripe webhook needs raw body — mount BEFORE express.json() ────────────
const stripeRoutes = require('./routes/stripe');
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }), (req, res, next) => {
  // Forward to the webhook handler in stripe routes
  next();
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ── Gzip compression ──────────────────────────────────────────────────────────
try {
  const compression = require('compression');
  app.use(compression({ threshold: 1024, level: 6 }));
  console.log('✅ Gzip compression enabled');
} catch { /* compression not installed — skip */ }

// ── Rate Limiting ─────────────────────────────────────────────────────────────

// Για /me, /friends, /refresh-premium, /by-key, /search κτλ — χαλαρό
const generalAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Πολλές προσπάθειες. Δοκίμασε ξανά σε 15 λεπτά.' },
});

// ── Request timing (only log slow requests ≥500ms) ────────────────────────────
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    if (ms >= 500 || res.statusCode >= 400) {
      console.log(`${res.statusCode >= 400 ? '⚠️' : '🐢'} [${req.method}] ${req.url} — ${ms}ms ${res.statusCode}`);
    }
  });
  next();
});

// ── MongoDB ───────────────────────────────────────────────────────────────────
mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/smart_grocery', {
  maxPoolSize: 10,
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
})
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
const barcodeRoutes      = require('./routes/barcode');
const mealsRoutes        = require('./routes/meals');
const pushRoutes         = require('./routes/push');
const plateScannerRoutes = require('./routes/platescanner');
const aiMealPlanLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Πολλά αιτήματα AI. Δοκίμασε ξανά σε 1 ώρα.' },
});

// Wire io to auth so notify-friend can emit socket events
if (typeof authRoutes.setIO === 'function') authRoutes.setIO(io);

// Το strictLimiter για register/login ορίζεται μέσα στο routes/auth.js
app.use('/api/auth',      generalAuthLimiter, authRoutes);
app.use('/api/prices',    cacheMiddleware(300),  pricesRoutes);  // 5 min cache
app.use('/api/lists',     listRoutes);
app.use('/api/recipes',   cacheMiddleware(600),  recipeRoutes);  // 10 min cache
app.use('/api/chat',      chatRoutes);
app.use('/api/meal-plan', aiMealPlanLimiter, mealPlanRoutes);
app.use('/api/favorites', favoritesRoutes);
app.use('/api/stripe',    stripeRoutes);
app.use('/api/barcode',   barcodeRoutes);  // USDA + Edamam fallback for barcode scanner
app.use('/api/meals',          mealsRoutes);         // TheMealDB proxy (Greek + Mediterranean recipes)
app.use('/api/push',           pushRoutes);          // Web Push subscriptions
app.use('/api/plate-scanner',  plateScannerRoutes);  // AI Plate Macro Scanner (Vision AI)

// ── Health & Admin ────────────────────────────────────────────────────────────
app.get('/api/health',  (req, res) => res.status(200).send('OK'));
app.get('/api/status',  (req, res) => res.json({ isScraping: getScrapingStatus() }));

app.get('/api/force-scrape', (req, res) => {
  if (!process.env.CRON_SECRET || req.query.secret !== process.env.CRON_SECRET)
    return res.status(403).json({ message: 'Απαγορεύεται.' });
  runWebScraper().then(() => {
    // Bust prices cache so next request fetches fresh data
    apiCache.flushAll();
    console.log('🗑️  API cache flushed after scrape');
  }).catch(() => {});
  res.send('🚀 Scraper started!');
});

app.get('/api/force-recipes', (req, res) => {
  if (!process.env.CRON_SECRET || req.query.secret !== process.env.CRON_SECRET)
    return res.status(403).json({ message: 'Απαγορεύεται.' });
  populateRecipes().then(() => {
    const recipeKeys = apiCache.keys().filter(k => k.startsWith('/api/recipes'));
    if (recipeKeys.length) apiCache.del(recipeKeys);
    console.log('🗑️  Recipes cache flushed');
  }).catch(() => {});
  res.send('👨‍🍳 Recipe scraper started!');
});

// Backfill AI macros for existing recipes that are missing nutrition data
app.get('/api/backfill-macros', async (req, res) => {
  if (!process.env.CRON_SECRET || req.query.secret !== process.env.CRON_SECRET)
    return res.status(403).json({ message: 'Απαγορεύεται.' });

  res.send('🧮 Macro backfill started — check server logs.');

  (async () => {
    const recipes = await Recipe.find({ calories: null, ingredients: { $exists: true, $not: { $size: 0 } } }).lean();
    console.log(`🧮 [backfill-macros] Found ${recipes.length} recipes without calories`);
    let updated = 0;
    for (const r of recipes) {
      try {
        const est = await estimateMacros(r.ingredients, r.servings || 4);
        if (est?.calories) {
          await Recipe.updateOne({ _id: r._id }, { $set: est });
          updated++;
          console.log(`  ✅ ${r.title?.substring(0, 50)} → ${est.calories}kcal`);
        }
      } catch { /* skip individual failures */ }
    }
    console.log(`🧮 [backfill-macros] Done — updated ${updated}/${recipes.length}`);
  })().catch(err => console.error('backfill-macros error:', err));
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

  // ── Typing indicators ────────────────────────────────────────────────────
  // data = { shareKey, senderName, friendShareKeys[] }
  socket.on('typing_start', (data) => {
    if (!data?.shareKey || !data?.senderName) return;
    (data.friendShareKeys || []).forEach(fKey => {
      if (fKey !== data.shareKey) {
        socket.to(fKey).emit('friend_typing', { senderName: data.senderName, shareKey: data.shareKey });
      }
    });
  });

  socket.on('typing_stop', (data) => {
    if (!data?.shareKey) return;
    (data.friendShareKeys || []).forEach(fKey => {
      if (fKey !== data.shareKey) {
        socket.to(fKey).emit('friend_stopped_typing', { shareKey: data.shareKey });
      }
    });
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

// ── 404 Catch-all (after all routes) ─────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ message: `Route not found: ${req.method} ${req.path}` });
});

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error('❌ Unhandled error:', err.message);
  res.status(err.status || 500).json({ message: err.message || 'Εσωτερικό σφάλμα διακομιστή.' });
});

// ── Startup env validation ────────────────────────────────────────────────────
const REQUIRED_ENV = ['MONGO_URI', 'JWT_SECRET', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'];
const missing = REQUIRED_ENV.filter(k => !process.env[k]);
if (missing.length > 0) {
  console.error(`❌ FATAL: Missing required environment variables: ${missing.join(', ')}`);
  console.error('   Set these in your Render environment before deploying.');
  // Don't exit in dev so the developer can still work; warn loudly in prod
  if (process.env.NODE_ENV === 'production') process.exit(1);
}

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
