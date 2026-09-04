const test = require('node:test');
const assert = require('node:assert/strict');
const { galaxiasOffer } = require('../lib/galaxiasOffer.js');

/*
 * Γαλαξίας hides its offers in Magento catalog rules; its GraphQL price_range
 * reports the pre-offer price with percent_off 0 even for a product the site
 * badges at -30%. Reading the price alone therefore stored the WRONG price for
 * every product on offer and found no discounts at all in 6,000 products.
 *
 * The three expectations below were taken from the live site on 2026-09-04 and
 * are why this floors rather than rounds.
 */

const LIVE = { from: ['2026-01-01'], to: ['2099-01-01'] };
const rule = (action_name, amount, extra = {}) =>
  ({ action_name, actions: { amount: String(amount) }, ...LIVE, ...extra });

test('a percentage rule matches what the shop charges, to the cent', () => {
  // Site: 2,76 € from 3,95 €. 3.95 x 0.7 is 2.765 — rounding gives 2,77, a cent high.
  assert.deepEqual(galaxiasOffer(3.95, [rule('percent', 30)]), { price: 2.76, badge: '-30%' });
  // Site: 1,09 € from 1,57 €. 1.57 x 0.7 is 1.099.
  assert.equal(galaxiasOffer(1.57, [rule('percent', 30)]).price, 1.09);
  // Exact division needs no flooring at all.
  assert.equal(galaxiasOffer(4.8, [rule('percent', 30)]).price, 3.36);
});

test('a fixed rule takes euros off the listed price', () => {
  assert.equal(galaxiasOffer(4.49, [rule('fixed', 0.3)]).price, 4.19);
});

test('a final_price rule replaces the price outright', () => {
  assert.equal(galaxiasOffer(8.44, [rule('final_price', 5.36)]).price, 5.36);
});

test('expired and future rules are ignored', () => {
  assert.equal(galaxiasOffer(10, [rule('percent', 30, { from: ['2020-01-01'], to: ['2020-02-01'] })]), null);
  assert.equal(galaxiasOffer(10, [rule('percent', 30, { from: ['2099-01-01'], to: ['2099-02-01'] })]), null);
});

test('a rule with no window at all still counts', () => {
  // Some rules come back with empty from/to arrays rather than dates.
  assert.equal(galaxiasOffer(10, [{ action_name: 'percent', actions: { amount: '10' }, from: [], to: [] }]).price, 9);
});

test('when several rules are live the shopper gets the cheapest', () => {
  const r = galaxiasOffer(10, [rule('percent', 10), rule('percent', 40), rule('fixed', 1)]);
  assert.equal(r.price, 6);
  assert.equal(r.badge, '-40%');
});

test('rules that are not markdowns are skipped', () => {
  // Buy-one-get-one and similar arrive as other action names; treating them as
  // a price cut would invent a discount that does not exist.
  assert.equal(galaxiasOffer(10, [{ action_name: 'buy_x_get_y', actions: { amount: '1' }, ...LIVE }]), null);
  assert.equal(galaxiasOffer(10, [rule('percent', 100)]), null, '100% off is not a price');
});

test('a rule that would not actually save anything is refused', () => {
  assert.equal(galaxiasOffer(10, [rule('final_price', 10)]), null, 'same price is not an offer');
  assert.equal(galaxiasOffer(10, [rule('final_price', 12)]), null, 'higher price is not an offer');
  assert.equal(galaxiasOffer(10, [rule('fixed', 10)]), null, 'free is a data error, not an offer');
});

test('missing or malformed input yields no offer rather than throwing', () => {
  assert.equal(galaxiasOffer(10, null), null);
  assert.equal(galaxiasOffer(10, []), null);
  assert.equal(galaxiasOffer(0, [rule('percent', 30)]), null);
  assert.equal(galaxiasOffer(10, [{ action_name: 'percent', actions: {}, ...LIVE }]), null);
});
