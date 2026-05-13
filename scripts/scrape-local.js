#!/usr/bin/env node
/**
 * scripts/scrape-local.js
 * ─────────────────────────────────────────────────────────────────────────────
 * High-performance scraper runner for your LOCAL machine.
 * Sets env vars BEFORE requiring scraper.js, so the cluster picks up
 * the laptop profile (more concurrency, headed browser, larger memory).
 *
 * Usage:
 *   node scripts/scrape-local.js              # scrape all stores
 *   node scripts/scrape-local.js Lidl         # scrape only Lidl
 *   node scripts/scrape-local.js AB           # scrape only ΑΒ
 *
 * Laptop profile vs Render free tier:
 *   SCRAPER_PROFILE=local      → headed Chrome (you can watch it), more RAM
 *   SCRAPER_MAX_CONCURRENCY=8  → 8 parallel browsers (vs 3 on Render)
 *   SCRAPER_CONCURRENCY_MODE=context → shared browser, separate contexts (faster)
 *   headless=false             → visible browser windows (easier debugging)
 * ─────────────────────────────────────────────────────────────────────────────
 */

require('dotenv').config();

// ── Override cluster settings for laptop ─────────────────────────────────────
process.env.SCRAPER_PROFILE          = 'local';
process.env.SCRAPER_MAX_CONCURRENCY  = process.env.SCRAPER_MAX_CONCURRENCY  || '8';
process.env.SCRAPER_CONCURRENCY_MODE = process.env.SCRAPER_CONCURRENCY_MODE || 'context';

// ── MongoDB & app setup ───────────────────────────────────────────────────────
const mongoose = require('mongoose');
const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!MONGO_URI) {
  console.error('❌ MONGO_URI not set in .env');
  process.exit(1);
}

const targetStore = process.argv[2] || null; // e.g. "Lidl", "AB", null = all

async function main() {
  console.log('🔌 Connecting to MongoDB...');
  await mongoose.connect(MONGO_URI);
  console.log('✅ MongoDB connected\n');

  // Require AFTER env vars are set so the cluster reads the right profile
  const { runWebScraper } = require('../services/scraper');

  const start = Date.now();
  console.log(`🚀 Starting LOCAL scrape${targetStore ? ` [${targetStore}]` : ' [ALL stores]'}...\n`);

  await runWebScraper(targetStore);

  const elapsed = ((Date.now() - start) / 1000 / 60).toFixed(1);
  console.log(`\n✅ Done in ${elapsed} minutes`);
  await mongoose.disconnect();
  process.exit(0);
}

main().catch(err => {
  console.error('❌ Fatal:', err);
  process.exit(1);
});
