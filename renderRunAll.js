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
