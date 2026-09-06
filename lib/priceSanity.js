/*
 * The last check before a price is published.
 *
 * A price-comparison app that shows a wrong price is worse than one that shows
 * nothing, so this REJECTS rather than repairs: a price it cannot vouch for is
 * dropped and counted, never quietly rounded into something plausible.
 * Rounding would have hidden the bug this was written for.
 *
 * That bug: MyMarket's analytics attribute holds the estimated price of one
 * PIECE for anything sold by weight, so onions displayed at 0,79 €/kg were
 * stored at 0,0948 — 0.79 x the 120 g piece. Invisible in the numbers, obvious
 * in their shape: euro retail prices carry at most two decimals, and 12.8% of
 * sampled MyMarket rows carried four against none from the other seven chains.
 */

/* Every euro price a shop can charge has at most two decimals, and every price
   this codebase computes is rounded or floored to two. Anything longer is
   arithmetic that escaped — a unit price, a per-piece estimate, a division. */
function decimals(n) {
    const s = String(n);
    const dot = s.indexOf('.');
    return dot < 0 ? 0 : s.length - dot - 1;
}

/* Wide on purpose. Real shelves hold a 195 € whisky and a 0,10 € lemon, so a
   band this generous only catches a decimal point in the wrong place. */
const MIN = 0.02;
const MAX = 2000;

/**
 * @returns {{price:number, oldPrice:number|null}|null} null when the product
 *          should not be published at all.
 */
function priceSanity(product) {
    const price = Number(product && product.price);
    if (!Number.isFinite(price)) return null;
    if (price < MIN || price > MAX) return null;
    if (decimals(price) > 2) return null;

    /* An old price is a bonus, never a reason to drop the product: if it does
       not hold up it is discarded on its own and the price still ships. */
    let oldPrice = Number(product && product.oldPrice);
    if (!Number.isFinite(oldPrice) || oldPrice <= price
        || oldPrice > MAX || decimals(oldPrice) > 2) {
        oldPrice = null;
    }

    return { price, oldPrice };
}

module.exports = { priceSanity, MIN, MAX };
