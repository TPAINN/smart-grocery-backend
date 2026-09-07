/*
 * Whether a chain's latest scrape can be trusted enough to delete the products
 * it did not find.
 *
 * The delisted sweep used to decide this from a share of the collection: skip
 * any chain where more than 40% of stored rows are stale, on the theory that
 * such a share means the run collapsed rather than that the chain stopped
 * selling things.
 *
 * That guess is wrong for a chain with a small rotating catalogue. Lidl's site
 * exposes about 220 products at a time; the collection holds 2,421, accumulated
 * over months of weekly offers. 72% of what the app showed for Lidl had not
 * been seen in over thirty days and the oldest row was from April — the rule
 * meant to protect the catalogue was preserving five-month-old prices as
 * current ones.
 *
 * A share of the collection cannot separate "the scrape broke" from "this chain
 * is small on purpose". The chain's own recent runs can, and we already record
 * them: pricehistories keeps one row per product per chain per day, which is a
 * census of every run. Compare the newest run against the median of the others.
 */

const MIN_HISTORY = 2;   // one prior day is a coincidence, not a norm
const MIN_SHARE = 0.5;   // a healthy run finds at least half the usual count

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * @param {{newest: number, history: number[]}} census
 *        newest  — products the latest run found for this chain
 *        history — products each earlier run found, one entry per day
 * @returns {{healthy: boolean, reason: string}}
 */
function scrapeLooksHealthy(census) {
  const newest = Number(census && census.newest);
  const history = Array.isArray(census && census.history)
    ? census.history.map(Number).filter(n => Number.isFinite(n) && n >= 0)
    : [];

  if (!Number.isFinite(newest) || newest <= 0) {
    return { healthy: false, reason: 'the latest run found nothing' };
  }
  if (history.length < MIN_HISTORY) {
    return { healthy: false, reason: `only ${history.length} earlier run(s) to compare against` };
  }

  /* Median, not mean: one collapsed run in the window would drag a mean down
     far enough to wave the next collapsed run through. */
  const usual = median(history);
  if (usual <= 0) return { healthy: false, reason: 'no usable history' };

  const share = newest / usual;
  const pct = Math.round(share * 100);
  return share >= MIN_SHARE
    ? { healthy: true,  reason: `found ${newest}, usually ${usual} (${pct}%)` }
    : { healthy: false, reason: `found ${newest}, usually ${usual} (${pct}%) — looks like a partial scrape` };
}

module.exports = { scrapeLooksHealthy };
