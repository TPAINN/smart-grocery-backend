#!/usr/bin/env node
/*
 * Storage maintenance for the Atlas cluster.
 *
 * WHY THIS EXISTS
 * On 2026-08-24 the daily scraper was still running and reporting success while
 * every single write failed with:
 *
 *   "you are over your space quota, using 512 MB of 512 MB. Writes are blocked"
 *
 * The newest product in the database was 2026-07-31 — three and a half weeks of
 * scrapes that scraped fine and saved nothing.
 *
 * The cause is `pricehistories`. It stores one snapshot per product per
 * supermarket per day and has no TTL index, so it grows without limit:
 * ~66k products x 8 chains x every day the scraper runs. Nothing ever removed
 * a row. Meanwhile the frontend no longer renders price history at all, so the
 * collection is pure storage cost against zero current use.
 *
 * MODES
 *   node scripts/storage-maintenance.js
 *       Report only. Per-database and per-collection storage. Changes nothing.
 *
 *   node scripts/storage-maintenance.js --prune --keep-days=60
 *       Dry run. Says exactly what it would delete.
 *
 *   node scripts/storage-maintenance.js --prune --keep-days=60 --confirm
 *       Executes: deletes price history older than the window, then creates a
 *       TTL index so this can never silently recur.
 *
 * Requires MONGO_URI in the environment. Never printed, never logged.
 */
const mongoose = require('mongoose');

const argv = process.argv.slice(2);
const has = (f) => argv.includes(`--${f}`);
const val = (f) => argv.find((a) => a.startsWith(`--${f}=`))?.split('=')[1];

const PRUNE = has('prune');
const DROP_INDEX = has('drop-unused-indexes');
const REINDEX = has('reindex');
const CONFIRM = has('confirm');
const KEEP_DAYS = Number(val('keep-days') ?? 60);
const SET_TTL_DAYS = val('set-ttl-days') ? Number(val('set-ttl-days')) : null;
const PRUNE_DELISTED = has('prune-delisted');
const STALE_DAYS = Number(val('stale-days') ?? 30);

const uri = process.env.MONGO_URI;
if (!uri) {
  console.error('MONGO_URI is not set.');
  process.exit(1);
}
if (!Number.isFinite(KEEP_DAYS) || KEEP_DAYS < 1) {
  console.error(`--keep-days must be a positive number, got: ${val('keep-days')}`);
  process.exit(1);
}

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const QUOTA_MB = 512;

(async () => {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 20000 });
  const admin = mongoose.connection.db.admin();
  const conn = mongoose.connection;

  /* Every database on the cluster counts against the same M0 quota, so a
     report scoped to smart_grocery alone would hide the real consumer. */
  const { databases } = await admin.listDatabases();
  console.log('\n── Cluster storage ──────────────────────────────────────');
  let clusterTotal = 0;
  for (const d of databases) {
    clusterTotal += d.sizeOnDisk || 0;
    console.log(`  ${d.name.padEnd(20)} ${mb(d.sizeOnDisk || 0).padStart(10)}`);
  }
  console.log(`  ${'TOTAL'.padEnd(20)} ${mb(clusterTotal).padStart(10)}  of ${QUOTA_MB} MB`);

  const db = conn.useDb('smart_grocery', { useCache: true }).db;

  /* listDatabases' sizeOnDisk under-reports what Atlas bills against the M0
     quota: it misses index bytes and, crucially, space WiredTiger has
     allocated but not returned after deletes. A daily scrape that replaces
     66k rows churns heavily, so the gap between "data" and "allocated" is
     where a cluster can be full at 512 MB while the documents only account
     for half that. Print both so a prune is aimed at the real consumer. */
  const st = await db.command({ dbStats: 1, freeStorage: 1 });
  console.log('\n── smart_grocery, allocated vs used ─────────────────────');
  console.log(`  data (uncompressed)  ${mb(st.dataSize || 0).padStart(10)}`);
  console.log(`  storage allocated    ${mb(st.storageSize || 0).padStart(10)}`);
  console.log(`  indexes              ${mb(st.indexSize || 0).padStart(10)}`);
  console.log(`  reusable (freed)     ${mb(st.freeStorageSize || 0).padStart(10)}`);
  console.log(`  ON-DISK TOTAL        ${mb((st.storageSize || 0) + (st.indexSize || 0)).padStart(10)}`);

  const cols = await db.listCollections().toArray();

  console.log('\n── smart_grocery collections ────────────────────────────');
  const rows = [];
  for (const c of cols) {
    const s = await db.command({ collStats: c.name }).catch(() => null);
    if (!s) continue;
    rows.push({
      name: c.name, count: s.count || 0,
      size: (s.storageSize || 0) + (s.totalIndexSize || 0),
      idx: s.totalIndexSize || 0,
      free: s.wiredTiger?.['block-manager']?.['file bytes available for reuse'] || 0,
    });
  }
  rows.sort((a, b) => b.size - a.size);
  for (const r of rows) {
    console.log(`  ${r.name.padEnd(22)} ${String(r.count).padStart(9)} docs  ${mb(r.size).padStart(10)}  (idx ${mb(r.idx)}, reusable ${mb(r.free)})`);
  }

  const ph = db.collection('pricehistories');

  /* The retention window is measured from the NEWEST row, not from today.
     Writes have been blocked for weeks, so the freshest history is already
     24 days old — counting back from now would make "keep 14 days" mean
     "delete everything", silently, on a collection that took months to
     build. Anchored to the data, it keeps the N most recent days that exist. */
  const newestPH = await ph.find({}).sort({ day: -1 }).limit(1).project({ day: 1 }).next();
  const anchorDate = newestPH?.day ? new Date(`${newestPH.day}T00:00:00Z`) : new Date();
  const cutoffDay = new Date(anchorDate.getTime() - KEEP_DAYS * 86400000).toISOString().slice(0, 10);
  console.log(`\n  retention anchored to newest row: ${newestPH?.day || '(none)'}`);
  const [phTotal, phOld] = await Promise.all([
    ph.estimatedDocumentCount(),
    ph.countDocuments({ day: { $lt: cutoffDay } }),
  ]);

  console.log('\n── pricehistories ───────────────────────────────────────');
  console.log(`  total            ${phTotal}`);
  console.log(`  older than ${String(KEEP_DAYS).padStart(3)}d   ${phOld}   (day < ${cutoffDay})`);
  /* The number, not just the presence. The schema declares 7 days, but Mongo
     silently ignores a changed expireAfterSeconds on an index that already
     exists, so the live window is the only one that matters — and the whole
     512 MB budget rests on it. */
  const liveTtl = (await ph.indexes()).find((i) => i.expireAfterSeconds != null);
  console.log(`  TTL index        ${liveTtl ? `${liveTtl.expireAfterSeconds / 86400} days (\`${liveTtl.name}\`)` : 'MISSING — grows forever'}`);
  if (liveTtl) {
    const perDay = phTotal / Math.max(1, liveTtl.expireAfterSeconds / 86400);
    console.log(`  at steady state  ~${Math.round(perDay).toLocaleString('en-US')} rows/day × window`);
  }

  /* Indexes are 29% of this cluster's quota, and `pricehistories` carries
     115 MB of them across two. The unique {normalizedName, supermarket, day}
     enforces one snapshot per product/chain/day and must stay. The second,
     {normalizedName, day}, exists purely to read a price series back — a
     feature the frontend no longer has. Dropping it frees index bytes without
     touching a single document, and it can be recreated in one command if
     price history ever returns. */
  const phIndexes = await ph.indexes();
  console.log('\n── pricehistories indexes ────────────────────────');
  for (const i of phIndexes) {
    console.log(`  ${String(i.name).padEnd(34)} ${JSON.stringify(i.key)}`);
  }

  const REDUNDANT = 'normalizedName_1_day_1';
  const hasRedundant = phIndexes.some((i) => i.name === REDUNDANT);

  if (DROP_INDEX && hasRedundant) {
    if (!CONFIRM) {
      console.log(`\n  Dry run: would drop \`${REDUNDANT}\` (no documents affected).`);
    } else {
      await ph.dropIndex(REDUNDANT);
      console.log(`\n  Dropped \`${REDUNDANT}\` — no documents touched.`);
      const after = await db.command({ dbStats: 1 });
      console.log(`  indexes now ${mb(after.indexSize || 0)} (was ${mb(st.indexSize || 0)})`);
    }
  }

  /* Rebuilding an index reclaims space a mass delete left stranded.
     WiredTiger does not return freed index pages to the OS, and M0 does not
     permit compact, so after deleting 1.2M rows `pricehistories` still held
     ~138 MB of index for 31k documents. Dropping and recreating writes a
     fresh, compact B-tree sized to what is actually there.

     The unique index is briefly absent while this runs, so it must not
     overlap the scraper — during that window nothing enforces one snapshot
     per product/chain/day. */
  if (REINDEX) {
    const UNIQ = 'normalizedName_1_supermarket_1_day_1';
    const spec = { normalizedName: 1, supermarket: 1, day: 1 };
    if (!CONFIRM) {
      console.log(`\n  Dry run: would rebuild \`${UNIQ}\` to reclaim stranded index space.`);
    } else {
      const before = (await db.command({ dbStats: 1 })).indexSize || 0;
      await ph.dropIndex(UNIQ).catch(() => console.log('  (index already absent)'));
      await ph.createIndex(spec, { unique: true, name: UNIQ });
      const after = (await db.command({ dbStats: 1 })).indexSize || 0;
      console.log(`\n  Rebuilt \`${UNIQ}\` — indexes ${mb(before)} -> ${mb(after)}`);
    }
  }

  /* Changing expireAfterSeconds in the Mongoose schema is not enough: MongoDB
     silently keeps the existing index when the option differs, so the old window
     stays in force forever. collMod moves it in place without dropping the index
     or touching a document. */
  if (SET_TTL_DAYS != null) {
    if (!Number.isFinite(SET_TTL_DAYS) || SET_TTL_DAYS < 1) {
      console.error(`--set-ttl-days must be a positive number, got: ${val('set-ttl-days')}`);
      process.exitCode = 2;
      await mongoose.disconnect();
      return;
    }
    const seconds = SET_TTL_DAYS * 86_400;
    const ttl = (await ph.indexes()).find((i) => i.expireAfterSeconds != null);
    if (!ttl) {
      console.error('  No TTL index on `pricehistories` — run a prune first, which creates it.');
      process.exitCode = 2;
    } else if (ttl.expireAfterSeconds === seconds) {
      console.log(`  TTL already ${SET_TTL_DAYS} days. Nothing to do.`);
    } else if (!CONFIRM) {
      console.log(`  Dry run: would move \`${ttl.name}\` from ${(ttl.expireAfterSeconds / 86400).toFixed(0)}d to ${SET_TTL_DAYS}d.`);
      console.log('  Add --confirm to apply. Rows past the new window expire over the following minutes.');
    } else {
      await db.command({ collMod: 'pricehistories', index: { name: ttl.name, expireAfterSeconds: seconds } });
      console.log(`  TTL moved ${(ttl.expireAfterSeconds / 86400).toFixed(0)}d -> ${SET_TTL_DAYS}d on \`${ttl.name}\`.`);
      console.log('  MongoDB removes newly-expired rows on its next background pass (up to ~60s).');
    }
  }

  /* Delisted products.
   *
   * The scraper upserts what a chain currently sells; it never removes what a
   * chain stopped selling. Sampled on 2026-08-26, 28% of the catalogue had not
   * been touched by that morning's run and the oldest rows were 147 days old —
   * items that left the shelves in spring and are still searchable.
   *
   * Two guards, because deleting by absence is only safe if absence is real:
   *   · a chain is only pruned if it scraped within the last 48 hours, so a
   *     chain that is currently broken (as ΑΒ was for 27 days) never has its
   *     catalogue deleted for failing to report;
   *   · a chain that would lose more than 40% of its rows is skipped and
   *     reported, since that means the scrape was partial rather than the
   *     products delisted.
   */
  if (PRUNE_DELISTED) {
    if (!Number.isFinite(STALE_DAYS) || STALE_DAYS < 7) {
      console.error(`--stale-days must be at least 7, got: ${val('stale-days')}`);
      process.exitCode = 2;
      await mongoose.disconnect();
      return;
    }
    const products = db.collection('products');
    const cutoff = new Date(Date.now() - STALE_DAYS * 86_400_000);
    const recent = new Date(Date.now() - 48 * 3_600_000);

    const chains = await products.aggregate([
      { $group: { _id: '$supermarket', total: { $sum: 1 }, newest: { $max: '$dateScraped' } } },
      { $sort: { total: -1 } },
    ]).toArray();

    console.log(`\n── Delisted sweep (older than ${STALE_DAYS} days) ────────`);
    let removedTotal = 0;
    for (const c of chains) {
      const chain = c._id;
      const stale = await products.countDocuments({ supermarket: chain, dateScraped: { $lt: cutoff } });
      const label = String(chain ?? '(none)').padEnd(22);

      if (!c.newest || new Date(c.newest) < recent) {
        console.log(`  ${label} SKIP — last scraped ${c.newest ? new Date(c.newest).toISOString().slice(0, 10) : 'never'}, not proven healthy`);
        continue;
      }
      if (stale === 0) { console.log(`  ${label} nothing stale`); continue; }
      const share = stale / c.total;
      if (share > 0.4) {
        console.log(`  ${label} SKIP — ${stale}/${c.total} (${(share * 100).toFixed(0)}%) looks like a partial scrape, not delisting`);
        continue;
      }
      if (!CONFIRM) {
        console.log(`  ${label} would remove ${stale} of ${c.total} (${(share * 100).toFixed(0)}%)`);
        continue;
      }
      const r = await products.deleteMany({ supermarket: chain, dateScraped: { $lt: cutoff } });
      removedTotal += r.deletedCount;
      console.log(`  ${label} removed ${r.deletedCount} of ${c.total}`);
    }
    console.log(CONFIRM
      ? `\n  removed ${removedTotal} delisted rows`
      : '\n  Dry run. Add --confirm to apply.');
  }

  if (!PRUNE) {
    console.log('\nReport only. Nothing changed.');
    console.log(`Next:  --prune --keep-days=${KEEP_DAYS}\n`);
    await mongoose.disconnect();
    return;
  }

  console.log('\n── Plan ─────────────────────────────────────────────────');
  console.log(`  delete ${phOld} price-history rows older than ${cutoffDay}`);
  console.log(`  create TTL index on \`date\` expiring after ${KEEP_DAYS} days`);

  if (!CONFIRM) {
    console.log('\nDry run. Nothing changed. Add --confirm to execute.\n');
    await mongoose.disconnect();
    return;
  }

  if (phOld >= phTotal) {
    console.error(`\n  REFUSING: that window removes every row.`);
    console.error('  Widen --keep-days, or drop the collection deliberately if that is the intent.');
    await mongoose.disconnect();
    process.exitCode = 2;
    return;
  }

  if (phOld > 0) {
    /* Batched: one deleteMany over ~1.2M documents on an M0 can outlive the
       connection, and a half-finished bulk delete is hard to reason about. */
    let removed = 0;
    for (;;) {
      const batch = await ph.find({ day: { $lt: cutoffDay } })
        .limit(50000).project({ _id: 1 }).toArray();
      if (!batch.length) break;
      const r = await ph.deleteMany({ _id: { $in: batch.map((d) => d._id) } });
      removed += r.deletedCount;
      console.log(`  deleted ${removed}/${phOld}`);
    }
    console.log(`\n  removed ${removed} rows`);
  }

  /* The durable fix. Without this the collection refills and blocks writes
     again in a few weeks, and the scraper will once more report success while
     saving nothing. */
  await ph.createIndex({ date: 1 }, { expireAfterSeconds: KEEP_DAYS * 86_400, name: 'ttl_date' });
  console.log(`  TTL index created — rows now expire automatically after ${KEEP_DAYS} days`);

  /* Reclaiming disk needs a compact; on M0 that is not permitted, so Atlas
     frees the space itself over the next few minutes. Say so rather than
     leaving someone staring at an unchanged storage figure. */
  console.log('\n  Note: Atlas reclaims the freed space in the background.');
  console.log('  Storage in the dashboard can take several minutes to drop.\n');

  await mongoose.disconnect();
})().catch(async (err) => {
  console.error('\nFailed:', err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
