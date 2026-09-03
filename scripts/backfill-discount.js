#!/usr/bin/env node
/*
 * One-off backfill for Product.discountPct.
 *
 * The numeric discount is computed at scrape time from now on, but the rows
 * already in the collection predate that field. Until they carry it, the offers
 * sort sees only products rescraped since the change — which would look like
 * the catalogue losing most of its offers rather than gaining a sort.
 *
 * Runs where MONGO_URI already exists as a secret, so the connection string
 * never has to be copied onto anyone's machine.
 *
 * Dry run unless --confirm is passed: it reports exactly what it would write,
 * including a sample, so the numbers can be checked before anything changes.
 */
const mongoose = require('mongoose');
const Product = require('../models/Product');
const { discountPct } = require('../lib/discountPct');

const CONFIRM = process.argv.includes('--confirm');
const BATCH = 1000;

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('MONGO_URI is not set.');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log(CONFIRM ? 'MODE: writing' : 'MODE: dry run (pass --confirm to write)');

  const total = await Product.estimatedDocumentCount();
  console.log('Products in collection: ' + total);

  /* Only the fields the computation needs, lean, and streamed with a cursor:
     loading 70k+ hydrated documents at once is how this kind of script gets
     OOM-killed halfway through and leaves the collection half-migrated. */
  const cursor = Product.find(
    {},
    { price: 1, oldPrice: 1, discountPercent: 1, is1plus1: 1, discountPct: 1 }
  ).lean().cursor();

  let seen = 0, willSet = 0, willClear = 0, unchanged = 0;
  const samples = [];
  let ops = [];

  const flush = async () => {
    if (!ops.length) return;
    if (CONFIRM) await Product.bulkWrite(ops, { ordered: false });
    ops = [];
  };

  for await (const doc of cursor) {
    seen++;
    const next = discountPct(doc);
    const prev = doc.discountPct ?? null;

    if (next === prev) {
      unchanged++;
    } else {
      if (next === null) willClear++; else willSet++;
      if (samples.length < 10 && next !== null) {
        samples.push({
          badge: doc.discountPercent, oldPrice: doc.oldPrice, price: doc.price,
          is1plus1: !!doc.is1plus1, computed: next,
        });
      }
      ops.push({
        updateOne: { filter: { _id: doc._id }, update: { $set: { discountPct: next } } },
      });
      if (ops.length >= BATCH) await flush();
    }

    if (seen % 10000 === 0) console.log('  ...' + seen + '/' + total);
  }
  await flush();

  console.log('\nSample of computed discounts:');
  for (const s of samples) console.log('  ' + JSON.stringify(s));

  console.log('\nscanned      ' + seen);
  console.log('would set    ' + willSet + '   (rows gaining a numeric discount)');
  console.log('would clear  ' + willClear + '   (rows whose stored value no longer holds)');
  console.log('unchanged    ' + unchanged);
  console.log(CONFIRM ? '\nWritten.' : '\nNothing written — rerun with --confirm.');

  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error('Backfill failed:', e.message);
  try { await mongoose.disconnect(); } catch { /* already down */ }
  process.exit(1);
});
