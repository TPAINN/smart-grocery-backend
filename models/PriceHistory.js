// models/PriceHistory.js
// One price snapshot per (product, supermarket, day). The scraper appends a
// point each run; the unique day index keeps it to one point per day so the
// series stays clean and grows into a real price-history graph over time.
const mongoose = require('mongoose');

const priceHistorySchema = new mongoose.Schema({
  normalizedName: { type: String, required: true },
  supermarket:    { type: String, required: true },
  price:          { type: Number, required: true },
  day:            { type: String, required: true }, // YYYY-MM-DD (client-agnostic UTC day)
  date:           { type: Date,   default: Date.now },
}, { timestamps: false });

// One snapshot per product/store/day
priceHistorySchema.index({ normalizedName: 1, supermarket: 1, day: 1 }, { unique: true });
// Fast series lookups
priceHistorySchema.index({ normalizedName: 1, day: 1 });

module.exports = mongoose.model('PriceHistory', priceHistorySchema);
