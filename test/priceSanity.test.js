const test = require('node:test');
const assert = require('node:assert/strict');
const { priceSanity } = require('../lib/priceSanity.js');

/*
 * The last check before a price is published.
 *
 * A price-comparison app that shows a wrong price is worse than one that shows
 * nothing, so this rejects rather than repairs: a price it cannot vouch for is
 * dropped and counted, not quietly rounded into something plausible. Rounding
 * would have hidden the bug this was written for.
 *
 * That bug: MyMarket's analytics attribute holds the estimated price of one
 * PIECE for anything sold by weight, so onions displayed at 0,79 €/kg were
 * stored at 0,0948 — 0.79 x the 120 g piece. It was invisible in the numbers
 * themselves and obvious in their shape: euro retail prices carry at most two
 * decimals, and 12.8% of sampled MyMarket rows carried four, against none at
 * all from the other seven chains.
 */

test('an ordinary price passes through untouched', () => {
  assert.deepEqual(priceSanity({ price: 1.29 }), { price: 1.29, oldPrice: null });
});

test('more than two decimals is rejected, not rounded', () => {
  // The exact shape of the MyMarket bug: 0.79 x a 120 g piece.
  assert.equal(priceSanity({ price: 0.0948 }), null);
  assert.equal(priceSanity({ price: 0.1188 }), null);
  assert.equal(priceSanity({ price: 0.3042 }), null);
});

test('two decimals or fewer is fine', () => {
  assert.equal(priceSanity({ price: 0.79 }).price, 0.79);
  assert.equal(priceSanity({ price: 3 }).price, 3);
  assert.equal(priceSanity({ price: 12.5 }).price, 12.5);
});

test('real shelf extremes are not mistaken for errors', () => {
  // A 195 € whisky and a 10-cent lemon both exist in the catalogue.
  assert.equal(priceSanity({ price: 195.5 }).price, 195.5);
  assert.equal(priceSanity({ price: 0.1 }).price, 0.1);
});

test('a price outside any plausible band is rejected', () => {
  assert.equal(priceSanity({ price: 0 }), null);
  assert.equal(priceSanity({ price: -1 }), null);
  assert.equal(priceSanity({ price: 0.01 }), null);
  assert.equal(priceSanity({ price: 5000 }), null);
});

test('a non-number is rejected rather than coerced', () => {
  assert.equal(priceSanity({ price: null }), null);
  assert.equal(priceSanity({ price: 'γάλα' }), null);
  assert.equal(priceSanity({}), null);
  assert.equal(priceSanity(null), null);
});

test('an old price that does not beat the price is dropped, keeping the product', () => {
  // A discount is a bonus; losing it must never cost the shopper the product.
  assert.deepEqual(priceSanity({ price: 2, oldPrice: 2 }), { price: 2, oldPrice: null });
  assert.deepEqual(priceSanity({ price: 2, oldPrice: 1.5 }), { price: 2, oldPrice: null });
  assert.deepEqual(priceSanity({ price: 2, oldPrice: null }), { price: 2, oldPrice: null });
});

test('a genuine old price survives', () => {
  assert.deepEqual(priceSanity({ price: 1.5, oldPrice: 2 }), { price: 1.5, oldPrice: 2 });
});

test('a malformed old price is dropped on its own', () => {
  assert.deepEqual(priceSanity({ price: 1.5, oldPrice: 2.0001 }), { price: 1.5, oldPrice: null });
  assert.deepEqual(priceSanity({ price: 1.5, oldPrice: 99999 }), { price: 1.5, oldPrice: null });
  assert.deepEqual(priceSanity({ price: 1.5, oldPrice: 'x' }), { price: 1.5, oldPrice: null });
});
