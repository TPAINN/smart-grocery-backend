const test = require('node:test');
const assert = require('node:assert/strict');
const { discountPct } = require('../lib/discountPct.js');

/*
 * One numeric discount, computed once at scrape time.
 *
 * Until now the only discount figure lived in `discountPercent`, a STRING
 * holding whatever the retailer's badge said ("-20%", "20%", "έως 30%"), and
 * every consumer re-derived a number from it at read time. That has two
 * consequences worth a test each:
 *
 *   - Sorting a string sorts lexicographically, so "9" ranks above "50".
 *   - parseInt('-20%') is -20, so the existing offers endpoint ranks a real
 *     20% markdown BELOW every product with no discount at all.
 *
 * Storing a number means the sort is an index lookup instead of an aggregation,
 * and the sign bug cannot come back.
 */

test('a percentage badge is read as a positive number whatever its sign', () => {
  assert.equal(discountPct({ discountPercent: '20%' }), 20);
  assert.equal(discountPct({ discountPercent: '-20%' }), 20);
});

test('a decimal badge is rounded to a whole percent', () => {
  assert.equal(discountPct({ discountPercent: '19,5%' }), 20);
});

test('buy-one-get-one is half price per unit', () => {
  assert.equal(discountPct({ is1plus1: true }), 50);
});

test('the badge wins over the arithmetic when both are available', () => {
  // The shelf label is what the shopper sees, and it covers offers whose old
  // price was never published.
  assert.equal(discountPct({ discountPercent: '30%', oldPrice: 2, price: 1.9 }), 30);
});

test('a discount is derived from the prices when there is no badge', () => {
  assert.equal(discountPct({ oldPrice: 2, price: 1 }), 50);
  assert.equal(discountPct({ oldPrice: 3.99, price: 2.99 }), 25);
});

test('no discount yields null, not zero', () => {
  // A `$gt: 0` filter must exclude non-offers rather than rank tens of
  // thousands of them.
  assert.equal(discountPct({ price: 1.5 }), null);
  assert.equal(discountPct({ oldPrice: 1, price: 1 }), null, 'equal prices are not a discount');
  assert.equal(discountPct({ oldPrice: 1, price: 2 }), null, 'a price rise is not a discount');
  assert.equal(discountPct({}), null);
});

test('an unparseable badge falls through instead of poisoning the field', () => {
  assert.equal(discountPct({ discountPercent: 'ΠΡΟΣΦΟΡΑ' }), null);
  assert.equal(discountPct({ discountPercent: 'ΠΡΟΣΦΟΡΑ', oldPrice: 2, price: 1 }), 50);
});

test('implausible values are rejected rather than stored', () => {
  // 0% and 100%-plus are parse artefacts, not markdowns.
  assert.equal(discountPct({ discountPercent: '0%' }), null);
  assert.equal(discountPct({ discountPercent: '120%' }), null);
  assert.equal(discountPct({ oldPrice: 100, price: 0.01 }), null);
});

test('a zero or negative old price cannot produce a discount', () => {
  // Dividing by it would give Infinity or a negative percentage.
  assert.equal(discountPct({ oldPrice: 0, price: 1 }), null);
  assert.equal(discountPct({ oldPrice: -5, price: 1 }), null);
});

test('prices arriving as strings still compute', () => {
  // Some chains yield stringified numbers, and a silent null here would drop
  // every offer from that chain.
  assert.equal(discountPct({ oldPrice: '2.00', price: '1.00' }), 50);
});
