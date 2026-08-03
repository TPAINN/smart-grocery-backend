// services/mealPlanPricing.js
// Ingredient → DB product price matching for the AI meal planner
// (routes/mealplan.js). Extracted during tidy-up — logic unchanged.

const Product = require('../models/Product');

/**
 * Lowercase, strip diacritics, and trim - canonical form for DB name matching.
 * @param {string} t
 * @returns {string}
 */
const normalize   = (t) => (t||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();
/**
 * Escape a string for safe use inside a RegExp constructor.
 * @param {string} s
 * @returns {string}
 */
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');

// Strip leading numbers/units from an ingredient string so search is cleaner
// e.g. "200γρ κοτόπουλο στήθος" → "κοτόπουλο στήθος"
/**
 * Strip a leading quantity/unit prefix from an ingredient string so the
 * remaining text is a clean search term, e.g. '200γρ κοτόπουλο στήθος' →
 * 'κοτόπουλο στήθος'.
 * @param {string} ingredient
 * @returns {string}
 */
function stripQuantity(ingredient) {
  return ingredient
    .replace(/^\s*\d+[\d.,]*\s*(γρ|gr|g|κιλ|kg|ml|lt|λίτρ|τεμ|τεμάχ|κ\.σ\.|κ\.γ\.|φλ\.?|μεγάλ[οα]|μεσαί[οα])\s*/i, '')
    .trim();
}

/**
 * Find the cheapest matching DB product for a free-text ingredient string,
 * trying progressively looser word-count queries until one matches.
 * @param {string} ingredient - raw ingredient text (may include qty/unit)
 * @returns {Promise<{name: string, price: number, store: string, unit: string|null}|null>}
 */
async function findBestPrice(ingredient) {
  const cleaned = stripQuantity(ingredient);
  const words = normalize(cleaned).split(/\s+/).filter(w => w.length > 2);
  if (!words.length) return null;

  // Try queries from most specific to least — stop on first hit
  const queries = [
    // All significant words must match
    words.slice(0, 3).map(w => ({ normalizedName: { $regex: escapeRegex(w), $options:'i' } })),
    // First two words
    words.slice(0, 2).map(w => ({ normalizedName: { $regex: escapeRegex(w), $options:'i' } })),
    // Just the first (most descriptive) word
    [{ normalizedName: { $regex: escapeRegex(words[0]), $options:'i' } }],
    // Second word as fallback (sometimes first is a quantity descriptor)
    words[1] ? [{ normalizedName: { $regex: escapeRegex(words[1]), $options:'i' } }] : null,
  ].filter(Boolean);

  for (const f of queries) {
    const r = await Product.find({ $and: f, price: { $gt: 0 } }).sort({ price:1 }).limit(3).lean();
    if (r.length) return { name:r[0].name, price:r[0].price, store:r[0].supermarket, unit:r[0].pricePerUnit||null };
  }
  return null;
}

// Extract grams from ingredient string like "200γρ κοτόπουλο στήθος" or "2 αυγά (120γρ)"
/**
 * Extract a gram quantity from an ingredient string, e.g. '200γρ κοτόπουλο' → 200.
 * @param {string} ingredientStr
 * @returns {number|null}
 */
function extractGrams(ingredientStr) {
  if (typeof ingredientStr !== 'string') return null;
  const match = ingredientStr.match(/(\d+)\s*[γg]ρ?/i);
  return match ? parseInt(match[1]) : null;
}

// Estimate per-use cost from full product price
// Most supermarket products are sold per kg or per unit
// If pricePerUnit contains "/κιλ" or similar, calculate proportionally
/**
 * Estimate the cost of the amount of a product actually used in a recipe.
 * Prefers a per-kilo unit price if available; otherwise assumes the product
 * is roughly 1kg and scales proportionally, capped at the full product price.
 * @param {number} productPrice - full product price as sold
 * @param {string|null} pricePerUnit - e.g. '3.20€/κιλ'
 * @param {number} gramsUsed
 * @returns {number}
 */
function estimateIngredientCost(productPrice, pricePerUnit, gramsUsed) {
  if (!productPrice || !gramsUsed) return productPrice;
  // If we have a per-kilo price, use it directly
  if (pricePerUnit) {
    const perKiloMatch = pricePerUnit.match(/([\d,.]+)\s*€?\s*\/\s*κιλ/i);
    if (perKiloMatch) {
      const pricePerKg = parseFloat(perKiloMatch[1].replace(',', '.'));
      return Math.round(pricePerKg * gramsUsed / 1000 * 100) / 100;
    }
  }
  // Fallback: assume product is ~1kg, estimate proportionally
  // Cap at full product price
  const estimated = Math.round(productPrice * gramsUsed / 1000 * 100) / 100;
  return Math.min(estimated, productPrice);
}

module.exports = { findBestPrice, extractGrams, estimateIngredientCost };
