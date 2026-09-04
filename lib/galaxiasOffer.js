/*
 * Γαλαξίας applies its offers through Magento catalog rules, and its GraphQL
 * `price_range` never reflects them: a product the site shows at 2,76 € with a
 * -30% badge comes back as 3,95 € with `discount.percent_off: 0`. Reading the
 * price alone therefore stored the PRE-offer price for every product on offer
 * and found no discounts at all in a 6,000-product catalogue.
 *
 * The rules carry it instead, in three shapes:
 *   percent      amount 30    -> 30% off the listed price
 *   fixed        amount 0.3   -> 0,30 € off the listed price
 *   final_price  amount 5.36  -> the price becomes 5,36 €
 *
 * Each rule has its own from/to window and expired ones are still returned, so
 * they are filtered against today before use. Where several are live, the one
 * that costs the shopper least wins — which is what their storefront shows.
 *
 * Prices are floored to the cent, not rounded. Verified against three live
 * products: 3,95 x 0.7 is 2,765 and the site shows 2,76; 1,57 x 0.7 is 1,099
 * and the site shows 1,09. Rounding would have been a cent high on both.
 */
function galaxiasOffer(listed, rules) {
    if (!Array.isArray(rules) || !rules.length || !(listed > 0)) return null;
    const today = new Date().toISOString().slice(0, 10);

    let best = null;
    for (const rule of rules) {
        const from = (rule && rule.from && rule.from[0]) || null;
        const to = (rule && rule.to && rule.to[0]) || null;
        if (from && from > today) continue;
        if (to && to < today) continue;

        const amount = parseFloat(rule && rule.actions && rule.actions.amount);
        if (!Number.isFinite(amount) || amount <= 0) continue;

        let price = null, badge = null;
        if (rule.action_name === 'percent') {
            if (amount >= 100) continue;                 // a 100% rule is not a price
            price = Math.floor(listed * (1 - amount / 100) * 100) / 100;
            badge = '-' + Math.round(amount) + '%';
        } else if (rule.action_name === 'fixed') {
            price = Math.floor((listed - amount) * 100) / 100;
        } else if (rule.action_name === 'final_price') {
            price = Math.floor(amount * 100) / 100;
        } else {
            continue;                                     // free-product rules are not a markdown
        }

        if (!(price > 0) || price >= listed) continue;
        if (!best || price < best.price) best = { price, badge };
    }
    return best;
}

module.exports = { galaxiasOffer };
