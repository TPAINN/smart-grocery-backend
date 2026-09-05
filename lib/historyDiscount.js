/*
 * A discount derived from our own price history, for the chains that publish
 * none of their own.
 *
 * Four of the eight do not: Σκλαβενίτης renders no strikethrough anywhere and
 * its offer facet only filters which products are on offer; Μασούτης shows no
 * percentage and no previous price across 100 products on its own offers page;
 * MyMarket's listing carries none; Market In's offers URL redirects away. For
 * those, "this is cheaper than it has been" is the only honest signal available
 * — and it is the signal a price-tracking app exists to produce.
 *
 * It is a weaker claim than a shelf label, so the bar is set high on purpose.
 */

/* Enough prior days that "usual" means something. At two points a median is
   just the average of two readings, and a single bad scrape would become half
   the baseline. */
const MIN_DAYS = 3;

/* Both floors must clear. The percentage alone would call 3 cents off a 40-cent
   item a 7% offer; the absolute alone would call 5 cents off a €40 bottle an
   offer. Together they only fire on something a shopper would notice. */
const MIN_PCT = 5;
const MIN_ABS = 0.05;

/* Above this a "discount" is a data error — a decimal point in the wrong place
   or a weight-priced item read as a unit price. Same ceiling discountPct uses. */
const MAX_PCT = 95;

/*
 * The median of the prior days, not the maximum.
 *
 * A maximum makes any single high reading the baseline, so one mis-scrape turns
 * every later day into a permanent fake discount. A median needs most of the
 * window to agree before it moves.
 */
function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * @param {number} todayPrice    what the product costs now
 * @param {number[]} priorPrices one price per earlier day, today excluded
 * @returns {{oldPrice:number, pct:number}|null}
 */
function historyDiscount(todayPrice, priorPrices) {
    const today = Number(todayPrice);
    if (!Number.isFinite(today) || today <= 0) return null;
    if (!Array.isArray(priorPrices)) return null;

    const prior = priorPrices
        .map(Number)
        .filter((n) => Number.isFinite(n) && n > 0);
    if (prior.length < MIN_DAYS) return null;

    const usual = Math.round(median(prior) * 100) / 100;
    if (!(usual > today)) return null;

    const abs = usual - today;
    const pct = Math.round((abs / usual) * 100);
    if (abs < MIN_ABS - 1e-9) return null;
    if (pct < MIN_PCT || pct > MAX_PCT) return null;

    return { oldPrice: usual, pct };
}

module.exports = { historyDiscount, MIN_DAYS, MIN_PCT, MIN_ABS };
