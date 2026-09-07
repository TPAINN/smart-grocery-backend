const test = require('node:test');
const assert = require('node:assert/strict');
const { scrapeLooksHealthy } = require('../lib/scrapeHealth.js');

/*
 * Whether a chain's latest scrape can be trusted enough to delete the products
 * it did not find.
 *
 * The delisted sweep used a flat rule: skip any chain where more than 40% of
 * rows are stale, on the theory that such a share means the scrape collapsed
 * rather than that the chain stopped selling things. That is a reasonable guess
 * and it is wrong for Lidl, whose site only ever exposes about 220 products at
 * a time while the collection holds 2,421 — 72% of what we show for Lidl was
 * last seen more than thirty days ago, and the oldest row is from April. The
 * rule meant to protect the catalogue was preserving five-month-old prices.
 *
 * A share of the collection cannot tell those two situations apart. What can is
 * the chain's own recent history: `pricehistories` already keeps one row per
 * product per chain per day, which is a census of every run. If the newest run
 * found about as many products as that chain's runs usually find, the run is
 * healthy and whatever it missed really is gone from the shelves.
 */

test('a run in line with the chain norm is healthy', () => {
  assert.equal(scrapeLooksHealthy({ newest: 220, history: [218, 221, 219, 224] }).healthy, true);
});

test('a run far below the norm is a broken scrape, not a delisting', () => {
  // The failure this protects against: a selector changes, the run saves a
  // handful of products, and the sweep deletes the rest of the chain.
  const v = scrapeLooksHealthy({ newest: 300, history: [12000, 11800, 12100] });
  assert.equal(v.healthy, false);
  assert.match(v.reason, /partial scrape/);
  assert.match(v.reason, /3%/);
});

test('a small chain is not punished for being small', () => {
  /* The flat 40% rule blocked Lidl for having a small live catalogue behind a
     large accumulated one. Measured against its own history it is healthy. */
  assert.equal(scrapeLooksHealthy({ newest: 220, history: [222, 216, 225], stored: 2421 }).healthy, true);
});

test('a run above the norm is healthy, not suspicious', () => {
  assert.equal(scrapeLooksHealthy({ newest: 9000, history: [6000, 6200, 6100] }).healthy, true);
});

test('one bad day in the history cannot set the bar', () => {
  // The median ignores the outlier; a mean would let one collapsed run halve
  // the threshold and wave the next one through.
  assert.equal(scrapeLooksHealthy({ newest: 3000, history: [12000, 40, 11800, 12100] }).healthy, false);
});

test('too little history means no deletion at all', () => {
  // Nothing to compare against is not evidence of health.
  assert.equal(scrapeLooksHealthy({ newest: 220, history: [] }).healthy, false);
  assert.equal(scrapeLooksHealthy({ newest: 220, history: [220] }).healthy, false);
});

test('a run that found nothing is never healthy', () => {
  assert.equal(scrapeLooksHealthy({ newest: 0, history: [220, 218, 222] }).healthy, false);
});

test('the verdict says why, because it is printed', () => {
  const v = scrapeLooksHealthy({ newest: 220, history: [218, 221, 219] });
  assert.match(v.reason, /220/);
  assert.match(v.reason, /219/);
});

test('malformed input refuses rather than throws', () => {
  assert.equal(scrapeLooksHealthy(null).healthy, false);
  assert.equal(scrapeLooksHealthy({}).healthy, false);
  assert.equal(scrapeLooksHealthy({ newest: 'x', history: 'y' }).healthy, false);
});
