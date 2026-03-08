// models/StarredPartner.js
const mongoose = require('mongoose');

const StarredPartnerSchema = new mongoose.Schema({
  userId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  partnerId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  partnerName: { type: String, required: true },
  nickname:    { type: String, default: '' },  // e.g. "Σύντροφος", "Φίλος"
  // Stripe tokenization: never raw card — only Stripe Customer ID
  stripeCustomerId: { type: String, default: null },
  // Auto-split default
  defaultSplitPercent: { type: Number, default: 50, min: 1, max: 99 },
  // Permissions
  autoAccept:  { type: Boolean, default: false }, // auto-accept splits under threshold
  autoAcceptThreshold: { type: Number, default: 20 }, // €
  status:      { type: String, enum: ['pending', 'active', 'blocked'], default: 'pending' },
  acceptedAt:  { type: Date, default: null },
}, { timestamps: true });

StarredPartnerSchema.index({ userId: 1, partnerId: 1 }, { unique: true });

module.exports = mongoose.model('StarredPartner', StarredPartnerSchema);