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
app.disable('x-powered-by'); // don't advertise Express
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Force HTTPS for 180 days (Render terminates TLS in front of us).
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }
  next();
});

// ── CORS ──────────────────────────────────────────────────────────────────────
// Known-good origins are ALWAYS allowed (so a stale ALLOWED_ORIGINS env on the
// host can never silently break the production frontend). ALLOWED_ORIGINS may
// add more (e.g. preview deploys) but can never remove these.
const DEFAULT_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5175',
  'https://kalathaki.vercel.app',              // canonical public app
  'https://smart-grocery-frontend-six.vercel.app', // Vercel project default domain
  'https://smart-grocery-frontend.vercel.app', // legacy alias (back-compat)
];
const ENV_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);
const allowedOrigins = [...new Set([...DEFAULT_ORIGINS, ...ENV_ORIGINS])];

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
  maxHttpBufferSize: 1e6, // 1MB cap per WS message — blocks memory-exhaustion DoS
});

// Respond with the allowed origin or false (never throw — throwing causes 500 on pre-flight)
const corsOptions = {
  origin: (origin, callback) => callback(null, isOriginAllowed(origin) ? origin : false),
  credentials: true,
  optionsSuccessStatus: 200,
};

// Handle pre-flight OPTIONS for ALL routes before any other middleware
// Note: bare '*' breaks path-to-regexp v8+ — use regex instead
app.options(/.*/, cors(corsOptions));
app.use(cors(corsOptions));

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
const { startTrialReminderCron } = require('./services/trialReminder');
startTrialReminderCron();

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
const diagnosticsRoutes  = require('./routes/diagnostics');
// Admin diagnostics (AI-key health etc.) — tight limit; each probe hits AI APIs.
const diagLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too many diagnostics requests' },
});
// Admin/debug ops launch Puppeteer / bulk DB writes — throttle hard even though
// they are CRON_SECRET-gated (defence in depth if the secret ever leaks).
const adminOpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 6,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Πολλά admin αιτήματα. Δοκίμασε ξανά αργότερα.' },
});
// Public endpoints that call paid AI providers — cap per IP to stop cost-drain.
const aiPublicLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Πολλά αιτήματα AI. Δοκίμασε ξανά σε λίγο.' },
});
const aiMealPlanLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Πολλά αιτήματα AI. Δοκίμασε ξανά σε 1 ώρα.' },
});

// Wire io to auth so notify-friend can emit socket events
if (typeof authRoutes.setIO === 'function') authRoutes.setIO(io);

// ── Targeted rate limits — MUST register before the routers/handlers below ───
app.use('/api/recipes/estimate-macros', aiPublicLimiter); // public AI → cost guard
app.use('/api/prices/substitute',       aiPublicLimiter); // public AI → cost guard
app.use('/api/auth/by-key',             adminOpLimiter);  // throttle user enumeration
app.use(['/api/debug-scrape', '/api/force-scrape', '/api/force-recipes', '/api/backfill-macros'], adminOpLimiter);

// Το strictLimiter για register/login ορίζεται μέσα στο routes/auth.js

// ── GET /api/stats — the numbers the header states as fact ───────────────────
//
// Mirrors the same-origin Vercel function. It exists here because the client
// falls back to this service when the Vercel function is unavailable, and
// /api/stats answered 404 — so the header's product count, chain count and
// "last scraped" line all went blank precisely when something was already
// wrong. Verified against the deployed service before adding it.
//
// countDocuments rather than estimatedDocumentCount: the estimate reads
// collection metadata, which goes stale after a bulk delete or a restore and
// then reports a number that has not been true for weeks — exactly the
// confident-but-wrong figure this endpoint exists to prevent. The response is
// cached, so the scan is not paid per request.
app.get('/api/stats', async (req, res) => {
  try {
    const Product = require('./models/Product');
    const Recipe  = require('./models/Recipe');

    const [priced, documents, byChain, newest, recipes] = await Promise.all([
      Product.countDocuments({ price: { $gt: 0 } }),
      Product.countDocuments({}),
      Product.aggregate([
        { $group: { _id: '$supermarket', n: { $sum: 1 }, newest: { $max: '$dateScraped' } } },
        { $sort: { n: -1 } },
      ]),
      Product.findOne({ dateScraped: { $exists: true } }).sort({ dateScraped: -1 }).select('dateScraped').lean(),
      Recipe.countDocuments({ 'ingredients.0': { $exists: true } }),
    ]);

    res.set('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=3600');
    res.json({
      // Only rows with a usable price: a row without one is not a product
      // anyone can look up, and counting it inflates the headline for free.
      products: priced,
      documents,
      chains: byChain.map((c) => c._id).filter(Boolean).length,
      recipes,
      newestScrape: newest?.dateScraped ?? null,
      byChain: byChain.map((c) => ({ chain: c._id ?? null, count: c.n, newest: c.newest ?? null })),
    });
  } catch {
    res.set('Cache-Control', 'no-store');
    res.status(500).json({ message: 'Σφάλμα στατιστικών.' });
  }
});

app.use('/api/auth',      generalAuthLimiter, authRoutes);
app.use('/api/prices',    cacheMiddleware(600),  pricesRoutes);  // 10 min — prices change ~1x/day; scrape flushes cache
app.use('/api/lists',     listRoutes);
app.use('/api/recipes',   cacheMiddleware(1800), recipeRoutes);  // 30 min — recipes change rarely
app.use('/api/chat',      chatRoutes);
app.use('/api/meal-plan', aiMealPlanLimiter, mealPlanRoutes);
app.use('/api/favorites', favoritesRoutes);
app.use('/api/stripe',    stripeRoutes);
app.use('/api/barcode',   barcodeRoutes);  // USDA + Edamam fallback for barcode scanner
app.use('/api/meals',          mealsRoutes);         // TheMealDB proxy (Greek + Mediterranean recipes)
app.use('/api/push',           pushRoutes);          // Web Push subscriptions
app.use('/api/plate-scanner',  plateScannerRoutes);  // AI Plate Macro Scanner (Vision AI)
app.use('/api/diag',           diagLimiter, diagnosticsRoutes); // admin-only ops diagnostics

// ── Health & Admin ────────────────────────────────────────────────────────────
app.get('/api/health',  (req, res) => res.status(200).send('OK'));
app.get('/api/status',  (req, res) => res.json({ isScraping: getScrapingStatus() }));

// 🔍 Debug: scrape a single URL synchronously and return results (secret-protected)
app.get('/api/debug-scrape', async (req, res) => {
  if (!process.env.CRON_SECRET || req.query.secret !== process.env.CRON_SECRET)
    return res.status(403).json({ message: 'Απαγορεύεται.' });
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'provide ?url=' });
  try {
    const puppeteer = require('puppeteer-extra');
    const StealthPlugin = require('puppeteer-extra-plugin-stealth');
    puppeteer.use(StealthPlugin());
    const fs = require('fs');
    const CHROME_PATHS = ['/usr/bin/google-chrome-stable','/usr/bin/google-chrome','/usr/bin/chromium-browser','/usr/bin/chromium','C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'];
    let executablePath;
    for (const p of CHROME_PATHS) { if (fs.existsSync(p)) { executablePath = p; break; } }
    const browser = await puppeteer.launch({ headless: 'new', executablePath: executablePath || undefined, args: ['--no-sandbox','--disable-setuid-sandbox','--disable-gpu','--disable-dev-shm-usage','--single-process','--js-flags=--max-old-space-size=512'] });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    // Try to wait for actual product cards (up to 15s), fall back to raw HTML snapshot
    let cardWaitMs = 0;
    try {
      const t0 = Date.now();
      await page.waitForSelector('[data-testid="product-block"], .odsc-tile[data-grid-data], product-card', { timeout: 15000 });
      cardWaitMs = Date.now() - t0;
    } catch(e) { cardWaitMs = -1; }
    const info = await page.evaluate((targetUrl) => {
      const isAB = targetUrl.includes('ab.gr');
      const isLidl = targetUrl.includes('lidl');
      // Detect Cloudflare/bot challenge
      const hasCF = !!document.querySelector('#challenge-running, #cf-wrapper, .cf-error-code');
      const bodySnippet = document.body.innerHTML.slice(0, 800);
      if (isAB) {
        const cards = document.querySelectorAll('[data-testid="product-block"]');
        const sample = cards[0] ? {
          name: cards[0].querySelector('[data-testid="product-name"],[data-testid="product-block-name-link"]')?.textContent?.trim(),
          price: cards[0].querySelector('[data-testid="product-block-price"]')?.textContent?.trim(),
          img: cards[0].querySelector('img[src*="static.ab.gr"],picture img')?.getAttribute('src')?.slice(0,80)
        } : null;
        return { store: 'AB', cardCount: cards.length, sample, title: document.title.slice(0,60), hasCF, bodySnippet: cards.length === 0 ? bodySnippet : null };
      }
      if (isLidl) {
        const tiles = document.querySelectorAll('.odsc-tile[data-grid-data]');
        let sample = null;
        if (tiles[0]) { try { const d = JSON.parse(tiles[0].getAttribute('data-grid-data')); sample = { name: d.fullTitle||d.title, price: d.price?.price }; } catch(e) {} }
        return { store: 'Lidl', tileCount: tiles.length, sample, title: document.title.slice(0,60), hasCF, bodySnippet: tiles.length === 0 ? bodySnippet : null };
      }
      return { title: document.title.slice(0,60), bodyLen: document.body.innerHTML.length, hasCF, bodySnippet };
    }, url);
    info.cardWaitMs = cardWaitMs;
    await browser.close();
    res.json({ url, chromeFound: !!executablePath, chromePath: executablePath || 'bundled', ...info });
  } catch(e) {
    console.error('debug-scrape error:', e.stack || e.message);
    res.status(500).json({ error: e.message }); // stack stays in server logs only
  }
});

app.get('/api/force-scrape', (req, res) => {
  if (!process.env.CRON_SECRET || req.query.secret !== process.env.CRON_SECRET)
    return res.status(403).json({ message: 'Απαγορεύεται.' });
  const targetStore = req.query.store || null;
  runWebScraper(targetStore).then(() => {
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

  // ── Per-socket event throttle (anti-flood / DoS) ──────────────────────────
  // Human usage stays well under these caps; only abusive bursts get dropped.
  const _rl = Object.create(null);
  const throttle = (key, max, windowMs) => {
    const now = Date.now();
    const b = _rl[key] || (_rl[key] = { n: 0, reset: now + windowMs });
    if (now > b.reset) { b.n = 0; b.reset = now + windowMs; }
    return ++b.n <= max;
  };

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
    if (!throttle('item', 60, 10000)) return; // anti-flood
    if (!data?.shareKey) return;
    socket.to(data.shareKey).emit('receive_item', data.item);
  });

  // ── Send message ──────────────────────────────────────────────────────────
  // data = { shareKey, senderName, text, friendShareKeys[], targetShareKey? }
  // If targetShareKey is set → private DM to one friend only
  // Otherwise → broadcast to all friend rooms (group chat)
  socket.on('send_message', async (data) => {
    if (!throttle('msg', 25, 10000)) return; // max ~25 msgs / 10s per socket
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
      console.error('❌ Message save error:', err.message);
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
  console.error('❌ Unhandled error:', err.stack || err.message);
  const status = err.status || 500;
  // Expose the message only for client errors (4xx) or in non-prod. Never leak
  // internal 5xx details/stacks to clients in production.
  const isClient = status >= 400 && status < 500;
  const message = (isClient || process.env.NODE_ENV !== 'production')
    ? (err.message || 'Σφάλμα')
    : 'Εσωτερικό σφάλμα διακομιστή.';
  res.status(status).json({ message });
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
