// renderRunAll.js — Smart Grocery Daily Scraper
// Render Cron Job entry point  (committed to git, runs in Render containers)
//
// Differences from local runAll.js:
//   • NO dotenv — Render injects env vars directly into the container
//   • Forces SCRAPER_PROFILE=render (no-sandbox, headless, low memory)
//   • Structured ISO-timestamp logging for Render log viewer
//   • Watchdog timer kills the process after 3h to prevent runaway billing
//   • Memory monitor logs heap every 10 min
//   • Validates required env vars before doing anything
//   • Lean Mongoose connection pool (cron = single run, not a long-lived server)
//
// Required Render env vars (set in Render dashboard):
//   MONGO_URI                  — MongoDB Atlas SRV string (mark as Secret)
//
// Optional tuning vars (defaults work for Starter plan):
//   SCRAPER_MAX_CONCURRENCY    — parallel Chrome browsers (default: 3)
//   NODE_OPTIONS               — e.g. "--max-old-space-size=400"

'use strict';

// ─── DNS: fix MongoDB Atlas SRV ECONNREFUSED inside containers ──────────────
const dns = require('node:dns/promises');
dns.setServers(['1.1.1.1', '1.0.0.1', '8.8.8.8']);

const mongoose = require('mongoose');
const { runWebScraper, savedPerStore } = require('./services/scraper');
const { delistedPlan, unsellableIds } = require('./lib/catalogueSweep.js');

// ─── Set scraper profile (respect env var so GitHub Actions can pass 'github') ──
// Workflow env: SCRAPER_PROFILE=github  → no --single-process (7GB RAM, full Chrome)
// Render env:   SCRAPER_PROFILE=render  → --single-process (512MB RAM)
// Default (unset): render (safe conservative choice)
if (!process.env.SCRAPER_PROFILE) process.env.SCRAPER_PROFILE = 'render';
if (!process.env.SCRAPER_MAX_CONCURRENCY) process.env.SCRAPER_MAX_CONCURRENCY = '3';

// ─── Structured logger ───────────────────────────────────────────────────────
const ts  = () => new Date().toISOString();
const log = {
    info : (...a) => console.log (`[${ts()}] ℹ️  `, ...a),
    ok   : (...a) => console.log (`[${ts()}] ✅ `, ...a),
    warn : (...a) => console.warn(`[${ts()}] ⚠️  `, ...a),
    err  : (...a) => console.error(`[${ts()}] ❌ `, ...a),
    mem  : ()     => {
        const m  = process.memoryUsage();
        const mb = (b) => `${(b / 1048576).toFixed(1)}MB`;
        console.log(`[${ts()}] 📊 heap ${mb(m.heapUsed)}/${mb(m.heapTotal)} | rss ${mb(m.rss)} | ext ${mb(m.external)}`);
    },
};

// ─── Validate required env vars immediately ──────────────────────────────────
const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
    log.err('MONGO_URI is not set. Cannot connect to database. Aborting.');
    process.exit(1);
}

// ─── Watchdog: force-exit after 3 hours (prevents runaway billing on Render) ─
const WATCHDOG_LIMIT_MS = 3 * 60 * 60 * 1000; // 3 hours
const watchdog = setTimeout(() => {
    log.err('WATCHDOG TRIGGERED — scraper exceeded 3-hour limit. Forcing exit(2).');
    process.exit(2);
}, WATCHDOG_LIMIT_MS);
watchdog.unref(); // won't prevent clean exit when job finishes normally

// ─── Memory monitor every 10 min ─────────────────────────────────────────────
const memTimer = setInterval(() => log.mem(), 10 * 60 * 1000);
memTimer.unref();

// ─── Graceful shutdown helper ─────────────────────────────────────────────────
async function shutdown(code) {
    clearTimeout(watchdog);
    clearInterval(memTimer);
    try { await mongoose.disconnect(); } catch { /* ignore */ }
    process.exit(code);
}

// ─── Main ────────────────────────────────────────────────────────────────────
const JOB_START = Date.now();

log.info('══════════════════════════════════════════════════════');
log.info('  Καλαθάκι — Daily Scraper  (Render Cron Job)');
log.info(`  Profile     : ${process.env.SCRAPER_PROFILE}`);
log.info(`  Concurrency : ${process.env.SCRAPER_MAX_CONCURRENCY} Chrome browsers`);
log.info(`  Node.js     : ${process.version}`);
log.info(`  Started at  : ${ts()}`);
log.info('══════════════════════════════════════════════════════');
log.mem();

/* Kept next to the runner rather than in the scraper: it is a property of a
   completed run over every chain, not of scraping one of them. */
const STALE_DAYS = Number(process.env.DELIST_STALE_DAYS || 30);

async function sweepCatalogue() {
    const db = mongoose.connection.db;
    const products = db.collection('products');
    const cutoff = new Date(Date.now() - STALE_DAYS * 86_400_000);

    const census = new Map();
    for (const row of await db.collection('pricehistories').aggregate([
        { $group: { _id: { chain: '$supermarket', day: '$day' }, n: { $sum: 1 } } },
        { $sort: { '_id.day': -1 } },
    ]).toArray()) {
        const list = census.get(row._id.chain) || [];
        list.push(row.n);
        census.set(row._id.chain, list);
    }

    const chains = [];
    for (const c of await products.aggregate([
        { $group: { _id: '$supermarket', total: { $sum: 1 }, newest: { $max: '$dateScraped' } } },
    ]).toArray()) {
        chains.push({
            chain: c._id,
            total: c.total,
            lastScraped: c.newest,
            stale: await products.countDocuments({ supermarket: c._id, dateScraped: { $lt: cutoff } }),
        });
    }

    log.info(`── Delisted sweep (not listed in ${STALE_DAYS} days) ────`);
    let removed = 0;
    for (const p of delistedPlan({ chains, census })) {
        const label = String(p.chain ?? '(none)').padEnd(22);
        if (!p.remove) { log.info(`  ${label} skip — ${p.reason}`); continue; }
        const r = await products.deleteMany({ supermarket: p.chain, dateScraped: { $lt: cutoff } });
        removed += r.deletedCount;
        log.info(`  ${label} removed ${r.deletedCount} of ${p.total} — ${p.reason}`);
    }

    const rows = await products.find({}, { projection: { price: 1, oldPrice: 1 } }).toArray();
    const doomed = unsellableIds(rows);
    if (doomed.length) {
        const r = await products.deleteMany({ _id: { $in: doomed } });
        removed += r.deletedCount;
        log.info(`  unsellable prices    removed ${r.deletedCount} of ${rows.length}`);
    } else {
        log.info(`  unsellable prices    none among ${rows.length}`);
    }
    log.info(`  swept ${removed} rows in total`);
}

(async () => {

    // ── Step 1: Connect to MongoDB ────────────────────────────────────────────
    log.info('Connecting to MongoDB Atlas…');
    try {
        await mongoose.connect(MONGO_URI, {
            maxPoolSize         : 3,     // cron job doesn't need a large pool
            serverSelectionTimeoutMS: 15_000,
            connectTimeoutMS    : 15_000,
            socketTimeoutMS     : 60_000,
        });
        log.ok('MongoDB connected.');
    } catch (err) {
        log.err(`MongoDB connection failed: ${err.message}`);
        await shutdown(1);
    }

    // ── Step 2: Run the full scraper ──────────────────────────────────────────
    log.info('Launching scraper — ALL stores…');
    log.mem();

    try {
        await runWebScraper(null); // null = scrape all stores
        const elapsed = ((Date.now() - JOB_START) / 60_000).toFixed(1);

        /* What each chain actually saved. Printed every run, because the useful
           question after a scrape is never "did it finish" — it is "did anyone
           come back empty". */
        const tally = [...savedPerStore.entries()].sort((a, b) => b[1] - a[1]);
        log.info('── Saved per chain ──────────────────────────');
        for (const [store, n] of tally) {
            log.info(`  ${store.padEnd(22)} ${String(n).padStart(6)}`);
        }

        /* ΑΒ Βασιλόπουλος spent 27 days returning zero products while this job
           reported success every single morning, because nothing ever checked.
           A chain that saves nothing means its site changed and the app is now
           serving that chain's prices from whenever it last worked — that is a
           failed run, and it should look like one. */
        const empty = tally.filter(([, n]) => n === 0).map(([store]) => store);
        if (empty.length) {
            log.err(`Chains that saved nothing: ${empty.join(', ')}`);
            log.err('Their prices in the app are now stale. Failing the run so this is visible.');
            await shutdown(1);
        }

        /* Housekeeping, only after a run that proved itself above.
         *
         * Two ways a stored product stops being true, and neither heals on its
         * own. A price this scraper would refuse to write today survives if it
         * was written before that check existed — three MyMarket rows still
         * carried the four-decimal per-piece estimate six weeks on. And a
         * product a chain no longer lists keeps whatever price it had when we
         * last saw it: Lidl shows about 220 items at a time, the collection had
         * grown to 2,421, and three quarters of what the app served for Lidl
         * had not been on a shelf in a month, the oldest since April.
         *
         * Both are decided in lib/catalogueSweep.js, which is tested, and a
         * chain whose own run looks thin against its recent history is skipped
         * rather than emptied. */
        try {
            await sweepCatalogue();
        } catch (err) {
            log.err(`Catalogue sweep failed: ${err.message}`);
        }

        log.ok(`All stores scraped successfully in ${elapsed} min.`);
    } catch (err) {
        log.err(`Scraper error: ${err.message}`);
        if (err.stack) log.err(err.stack);
        await shutdown(1);
    }

    // ── Step 3: Clean up ─────────────────────────────────────────────────────
    log.mem();
    const total = ((Date.now() - JOB_START) / 60_000).toFixed(1);
    log.ok(`════ Render cron job COMPLETE — total time: ${total} min ════`);
    await shutdown(0);

})();
