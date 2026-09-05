const test = require('node:test');
const assert = require('node:assert/strict');
const { historyDiscount } = require('../lib/historyDiscount.js');

/*
 * Four of the eight chains publish no old price anywhere a scraper can read it.
 * Checked directly on their own sites: Σκλαβενίτης renders no strikethrough
 * element at all and its offer facet only filters which products are on offer;
 * Μασούτης shows no percentage and no previous price across 100 products on its
 * own offers page, only the word «μόνo»; MyMarket's listing carries none; and
 * Market In's offers URL redirects to the homepage, which shows a new price and
 * no old one.
 *
 * So for those chains the discount cannot come from the shop. It has to come
 * from us — we already keep a price point per product per day, and a price that
 * has dropped below where it has been sitting IS the thing a price-tracking app
 * exists to notice.
 *
 * That is a weaker claim than a shelf label, so the bar is deliberately high:
 * enough history to know what "usual" means, a median rather than a maximum so
 * one bad reading cannot invent an offer, and a floor in both percent and cents.
 */

test('a sustained price that drops is reported against its usual level', () => {
  // Sat at 2,00 for four days, now 1,50 — a real 25% drop.
  assert.deepEqual(historyDiscount(1.5, [2, 2, 2, 2]), { oldPrice: 2, pct: 25 });
});

test('too little history means no claim at all', () => {
  // Day two of tracking is not evidence of a usual price.
  assert.equal(historyDiscount(1.5, [2, 2]), null);
  assert.equal(historyDiscount(1.5, [2]), null);
  assert.equal(historyDiscount(1.5, []), null);
});

test('one bad reading cannot invent an offer', () => {
  // A single 9,99 misread among 2,00s. A maximum-based baseline would report a
  // permanent 85% discount from then on; the median ignores it.
  assert.equal(historyDiscount(2, [2, 2, 9.99, 2]), null);
});

test('one bad reading cannot inflate a real offer either', () => {
  // Genuinely dropped to 1,50 from 2,00, with one 9,99 in the window. The
  // answer is 25%, not 85%.
  assert.deepEqual(historyDiscount(1.5, [2, 2, 9.99, 2]), { oldPrice: 2, pct: 25 });
});

test('a price that has not moved is not an offer', () => {
  assert.equal(historyDiscount(2, [2, 2, 2, 2]), null);
});

test('a price that went up is not an offer', () => {
  assert.equal(historyDiscount(2.5, [2, 2, 2]), null);
});

test('a drop too small to notice is ignored, by percent and by cents alike', () => {
  // 3 cents off 40 is 7% — over the percentage floor, under the cash floor.
  assert.equal(historyDiscount(0.37, [0.40, 0.40, 0.40]), null);
  // 50 cents off 40 euros is over the cash floor and only 1%.
  assert.equal(historyDiscount(39.5, [40, 40, 40]), null);
});

test('a drop that clears both floors is reported', () => {
  assert.deepEqual(historyDiscount(1.79, [1.99, 1.99, 1.99]), { oldPrice: 1.99, pct: 10 });
});

test('an implausible collapse is treated as a data error', () => {
  // A decimal point in the wrong place, or a kilo price read as a unit price.
  assert.equal(historyDiscount(0.05, [40, 40, 40]), null);
});

test('an even-length window averages the middle two', () => {
  assert.deepEqual(historyDiscount(1, [2, 2, 3, 3]), { oldPrice: 2.5, pct: 60 });
});

test('unusable readings are dropped before the count is checked', () => {
  // Three usable points remain, so this still qualifies.
  assert.deepEqual(historyDiscount(1.5, [2, null, 2, 'x', 2, -1, 0]), { oldPrice: 2, pct: 25 });
  // Only two usable points remain, so it does not.
  assert.equal(historyDiscount(1.5, [2, null, 2, 'x']), null);
});

test('malformed input yields no offer rather than throwing', () => {
  assert.equal(historyDiscount(null, [2, 2, 2]), null);
  assert.equal(historyDiscount(0, [2, 2, 2]), null);
  assert.equal(historyDiscount(1.5, null), null);
});
