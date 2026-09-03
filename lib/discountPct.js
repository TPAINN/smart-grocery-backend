/*
 * One numeric discount for a product, computed once at scrape time.
 *
 * Before this, the only discount figure was `discountPercent` — a STRING
 * holding whatever the retailer's badge said ("-20%", "20%") — and every reader
 * re-derived a number from it. Two things went wrong with that:
 *
 *   - Sorting a string sorts lexicographically, so "9" ranks above "50".
 *   - parseInt('-20%') is -20, so a real 20% markdown ranked below every
 *     product carrying no discount at all.
 *
 * A stored number makes the offers sort an index lookup instead of an
 * aggregation, and keeps both bugs from coming back.
 *
 * Returns null rather than 0 when there is no discount, so a `$gt: 0` filter
 * excludes non-offers instead of ranking tens of thousands of them.
 */

/* Anything outside this band is a parse artefact rather than a real markdown:
   supermarkets do not sell at 99% off, and a "1%" badge is usually a fragment
   of something else. The offers endpoint already applied 5..70 at read time;
   this is deliberately wider so the stored value stays honest and the
   presentation layer keeps its own opinion. */
const MIN = 1;
const MAX = 95;

function discountPct(product = {}) {
  const { discountPercent, is1plus1, oldPrice, price } = product;

  /* The retailer's own badge wins: it is what the shelf says, and it covers
     offers whose old price was never published. The sign is discarded — "-20%"
     and "20%" both mean twenty percent off. */
  if (discountPercent != null) {
    const m = /(\d+(?:[.,]\d+)?)/.exec(String(discountPercent));
    if (m) {
      const n = Math.round(parseFloat(m[1].replace(',', '.')));
      if (n >= MIN && n <= MAX) return n;
    }
  }

  /* Buy-one-get-one is half price per unit. Matches what the offers endpoint
     has always shown for these, so the two cannot disagree. */
  if (is1plus1) return 50;

  /* Fall back to the arithmetic when both prices are present and real. */
  const from = Number(oldPrice);
  const to = Number(price);
  if (Number.isFinite(from) && Number.isFinite(to) && from > 0 && to >= 0 && from > to) {
    const n = Math.round(((from - to) / from) * 100);
    if (n >= MIN && n <= MAX) return n;
  }

  return null;
}

module.exports = { discountPct };
