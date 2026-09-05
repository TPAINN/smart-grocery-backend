// models/Product.js
const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  name: { type: String, required: true },
  normalizedName: { type: String, required: true },
  supermarket: { type: String, required: true },
  price: { type: Number, required: true },
  oldPrice: { type: Number, default: null },
  pricePerUnit: { type: String, default: null }, // ΝΕΟ: Π.χ. "2,98€/κιλό"
  validityDate: { type: String, default: null }, // ΝΕΟ: Π.χ. "από 26.02. - 04.03."
  isOnSale: { type: Boolean, default: false },
  is1plus1: { type: Boolean, default: false },
  discountPercent: { type: String, default: null },
  // Numeric companion to discountPercent, computed once at scrape time by
  // lib/discountPct.js. discountPercent is the retailer's badge text, so it
  // sorts lexicographically ("9" above "50") and parseInt('-20%') is negative.
  // null rather than 0 when there is no offer, so `$gt: 0` excludes non-offers.
  discountPct: { type: Number, default: null },
  // 'chain' when the shop published the offer itself, 'history' when we
  // inferred it from our own price series because the shop publishes none —
  // half the chains do not. The app can then say "cheaper than usual" rather
  // than claiming the shop advertised a discount, which is a different claim.
  discountSource: { type: String, default: null },
  imageUrl: { type: String, default: null },
  dateScraped: { type: Date, default: Date.now }
}, { timestamps: false });

// Text index on name for full-text search (default_language 'none' for Greek support)
productSchema.index({ name: 'text' }, { default_language: 'none' });
// Compound index for store-filtered name queries
productSchema.index({ name: 1, supermarket: 1 });
// Compound index for store + price sort queries
productSchema.index({ supermarket: 1, price: 1 });
// Ingredient/price lookups (findBestPrice, substitute, price comparison) + price sort.
// Without this, those queries ran full collection scans of ~62k docs each.
productSchema.index({ normalizedName: 1, price: 1 });
// Recency window for top-offers + scrape-status + latest-scrape lookups.
// (sort/range on dateScraped was previously a full scan.)
productSchema.index({ dateScraped: -1 });
// Offers sort. Partial so the index holds only the rows that actually carry a
// discount — a few thousand entries rather than one per product — which is both
// smaller and exactly the set the `discountPct > 0` query asks for.
productSchema.index({ discountPct: -1, _id: 1 }, { partialFilterExpression: { discountPct: { $gt: 0 } } });

module.exports = mongoose.model('Product', productSchema);