const test = require('node:test');
const assert = require('node:assert/strict');
const { unsellableIds, delistedPlan } = require('../lib/catalogueSweep.js');

/*
 * Two ways a stored product stops being true, and what to do about each.
 *
 * A price that priceSanity would refuse to write must not survive because it
 * was written before the check existed. Three MyMarket rows still carried a
 * four-decimal price — 0.3021 for beetroot, the per-piece estimate their
 * analytics attribute reports for anything sold by weight — six weeks after the
 * scraper stopped producing them. The gate only ever guarded new writes; the
 * old rows sat there being wrong.
 *
 * And a product the chain no longer lists keeps whatever price it had the last
 * time we saw it. Lidl's site exposes about 220 items at a time; the collection
 * had grown to 2,421, so three quarters of what the app showed for Lidl had not
 * been on a shelf in over a month, the oldest since April.
 */

test('a price with more than two decimals is unsellable', () => {
  // Exactly the MyMarket shape: 0.79/kg times a 120g piece.
  assert.deepEqual(
    unsellableIds([{ _id: 'a', price: 0.3021 }, { _id: 'b', price: 1.29 }]),
    ['a'],
  );
});

test('ordinary prices and real shelf extremes are left alone', () => {
  assert.deepEqual(
    unsellableIds([
      { _id: 'a', price: 0.1 }, { _id: 'b', price: 195.5 },
      { _id: 'c', price: 3 },   { _id: 'd', price: 12.5 },
    ]),
    [],
  );
});

test('a price outside any plausible band is unsellable too', () => {
  assert.deepEqual(
    unsellableIds([
      { _id: 'a', price: 0 }, { _id: 'b', price: -1 },
      { _id: 'c', price: 5000 }, { _id: 'd', price: null }, { _id: 'e' },
      { _id: 'f', price: 2.5 },
    ]),
    ['a', 'b', 'c', 'd', 'e'],
  );
});

test('an unusable old price does not condemn the product', () => {
  // Losing a discount must never cost the shopper the product itself.
  assert.deepEqual(unsellableIds([{ _id: 'a', price: 2, oldPrice: 1.5 }]), []);
});

test('a healthy chain has its unlisted products removed', () => {
  const plan = delistedPlan({
    chains: [{ chain: 'Lidl', total: 2421, stale: 1851, lastScraped: new Date() }],
    census: new Map([['Lidl', [220, 251, 249, 253]]]),
  });
  assert.equal(plan[0].remove, true);
  assert.equal(plan[0].stale, 1851);
});

test('a chain whose scrape collapsed keeps everything', () => {
  /* The failure this guards: a selector breaks, the run saves a handful, and
     the sweep deletes the rest of the chain. */
  const plan = delistedPlan({
    chains: [{ chain: 'ΑΒ Βασιλόπουλος', total: 12090, stale: 9000, lastScraped: new Date() }],
    census: new Map([['ΑΒ Βασιλόπουλος', [300, 11692, 11700, 11650]]]),
  });
  assert.equal(plan[0].remove, false);
  assert.match(plan[0].reason, /partial scrape/);
});

test('a chain that has not scraped recently is never swept', () => {
  // Its rows being old says nothing while we cannot see the shelves.
  const old = new Date(Date.now() - 5 * 86400000);
  const plan = delistedPlan({
    chains: [{ chain: 'Lidl', total: 2421, stale: 1851, lastScraped: old }],
    census: new Map([['Lidl', [220, 251, 249]]]),
  });
  assert.equal(plan[0].remove, false);
  assert.match(plan[0].reason, /not proven healthy/);
});

test('a chain with nothing stale is reported and skipped', () => {
  const plan = delistedPlan({
    chains: [{ chain: 'Μασούτης', total: 10583, stale: 0, lastScraped: new Date() }],
    census: new Map([['Μασούτης', [10522, 10023, 10100]]]),
  });
  assert.equal(plan[0].remove, false);
  assert.match(plan[0].reason, /nothing stale/);
});

test('every chain gets a line, so a skip is never silent', () => {
  const plan = delistedPlan({
    chains: [
      { chain: 'A', total: 10, stale: 5, lastScraped: new Date() },
      { chain: 'B', total: 10, stale: 0, lastScraped: new Date() },
      { chain: 'C', total: 10, stale: 5, lastScraped: null },
    ],
    census: new Map([['A', [10, 10, 10]]]),
  });
  assert.equal(plan.length, 3);
  for (const p of plan) assert.ok(p.reason, `${p.chain} must carry a reason`);
});
