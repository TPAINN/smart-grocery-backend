// models/SplitSession.js — v2: supports quick split + receipt OCR
const mongoose = require('mongoose');

const SplitItemSchema = new mongoose.Schema({
  name:     { type: String, required: true },
  price:    { type: Number, required: true },
  quantity: { type: Number, default: 1 },
  store:    { type: String, default: '' },
}, { _id: false });

const ParticipantSchema = new mongoose.Schema({
  userId:          { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  username:        { type: String, required: true },
  shareAmount:     { type: Number, required: true },
  sharePercent:    { type: Number, required: true },
  status:          { type: String, enum: ['pending', 'accepted', 'rejected', 'paid'], default: 'pending' },
  consentToken:    { type: String, default: null },
  consentAt:       { type: Date, default: null },
  stripePaymentId: { type: String, default: null },
  paidAt:          { type: Date, default: null },
}, { _id: false });

const SplitSessionSchema = new mongoose.Schema({
  createdBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  shareKey:     { type: String, required: true },
  title:        { type: String, default: 'Κοινή Αγορά' },
  items:        [SplitItemSchema],
  totalAmount:  { type: Number, required: true },
  participants: [ParticipantSchema],
  splitType:    { type: String, enum: ['equal', 'custom', 'itemized'], default: 'equal' },
  // Source type: how the split was created
  source:       { type: String, enum: ['list', 'quick', 'receipt'], default: 'list' },
  status:       { type: String, enum: ['pending', 'active', 'completed', 'cancelled', 'expired'], default: 'pending' },
  // Stripe
  stripePaymentIntentId: { type: String, default: null },
  currency:     { type: String, default: 'eur' },
  // WebAuthn
  webauthnChallenge:  { type: String, default: null },
  challengeExpiresAt: { type: Date, default: null },
  // Expiry (24h TTL)
  expiresAt: { type: Date, default: () => new Date(Date.now() + 24 * 60 * 60 * 1000) },
}, { timestamps: true });

SplitSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
SplitSessionSchema.index({ shareKey: 1 });
SplitSessionSchema.index({ createdBy: 1 });
SplitSessionSchema.index({ 'participants.userId': 1 });

module.exports = mongoose.model('SplitSession', SplitSessionSchema);