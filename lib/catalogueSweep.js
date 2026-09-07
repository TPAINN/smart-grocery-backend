/*
 * Removing stored products that have stopped being true.
 *
 * Two different failures, deliberately kept apart.
 *
 * A price priceSanity would refuse to WRITE must not survive merely because it
 * was written before that check existed. Three MyMarket rows still carried a
 * four-decimal price six weeks on — 0.3021 for beetroot, which is their
 * analytics estimate for one piece rather than the shelf price per kilo. The
 * gate only ever guarded new writes.
 *
 * And a product the chain no longer lists keeps whatever price it had the last
 * time we saw it. Lidl's site exposes about 220 items at a time while the
 * collection had grown to 2,421, so three quarters of what the app showed for
 * Lidl had not been on a shelf in over a month and the oldest row was from
 * April — in a price-comparison app, a five-month-old price shown as current.
 *
 * The decisions live here, free of the database, so they can be tested. The
 * queries that act on them live in the callers.
 */
const { priceSanity } = require('./priceSanity.js');
const { scrapeLooksHealthy } = require('./scrapeHealth.js');

/** Products whose stored price is one we would refuse to write today.
 * @param {{_id: any, price: any, oldPrice: any}[]} rows
 * @returns {any[]} the _ids to delete
 */
function unsellableIds(rows) {
  return (rows || []).filter(r => priceSanity(r) === null).map(r => r._id);
}

const RECENT_MS = 48 * 3600 * 1000;

/**
 * Decide, per chain, whether its products older than the window may go.
 *
 * @param {{chains: {chain: string, total: number, stale: number, lastScraped: Date|null}[],
 *          census: Map<string, number[]>, now?: number}} input
 *        census maps a chain to how many products each recent run found,
 *        newest first — pricehistories keeps one row per product per chain per
 *        day, so that collection IS a census of every run.
 * @returns {{chain: string, remove: boolean, stale: number, total: number, reason: string}[]}
 */
function delistedPlan({ chains, census, now = Date.now() }) {
  return (chains || []).map(c => {
    const base = { chain: c.chain, stale: c.stale, total: c.total, remove: false };

    /* Its rows being old says nothing about the shelves while we cannot see
       them. A chain that has not scraped in two days is not evidence. */
    if (!c.lastScraped || now - new Date(c.lastScraped).getTime() > RECENT_MS) {
      const when = c.lastScraped ? new Date(c.lastScraped).toISOString().slice(0, 10) : 'never';
      return { ...base, reason: `not proven healthy — last scraped ${when}` };
    }
    if (!c.stale) return { ...base, reason: 'nothing stale' };

    const days = (census && census.get(c.chain)) || [];
    const verdict = scrapeLooksHealthy({ newest: days[0], history: days.slice(1) });
    return verdict.healthy
      ? { ...base, remove: true, reason: verdict.reason }
      : { ...base, reason: verdict.reason };
  });
}

module.exports = { unsellableIds, delistedPlan, RECENT_MS };
