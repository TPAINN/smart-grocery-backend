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
});

module.exports = mongoose.model('Product', productSchema);