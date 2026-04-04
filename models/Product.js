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
  imageUrl: { type: String, default: null },
  dateScraped: { type: Date, default: Date.now }
}, { timestamps: false });

// Text index on name for full-text search (default_language 'none' for Greek support)
productSchema.index({ name: 'text' }, { default_language: 'none' });
// Compound index for store-filtered name queries
productSchema.index({ name: 1, supermarket: 1 });
// Compound index for store + price sort queries
productSchema.index({ supermarket: 1, price: 1 });

module.exports = mongoose.model('Product', productSchema);