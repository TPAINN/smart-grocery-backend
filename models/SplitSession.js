// models/SplitSession.js
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
  shareAmount:     { type: Number, required: true },     // €amount this user pays
  sharePercent:    { type: Number, required: true },     // % of total
  status:          { type: String, enum: ['pending', 'accepted', 'rejected', 'paid'], default: 'pending' },
  consentToken:    { type: String, default: null },      // WebAuthn-derived token
  consentAt:       { type: Date, default: null },
  stripePaymentId: { type: String, default: null },      // Stripe PaymentIntent ID
  paidAt:          { type: Date, default: null },
}, { _id: false });

const SplitSessionSchema = new mongoose.Schema({
  createdBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  shareKey:     { type: String, required: true },        // matches cart shareKey
  title:        { type: String, default: 'Κοινή Αγορά' },
  items:        [SplitItemSchema],
  totalAmount:  { type: Number, required: true },
  participants: [ParticipantSchema],
  splitType:    { type: String, enum: ['equal', 'custom', 'itemized'], default: 'equal' },
  status:       { type: String, enum: ['pending', 'active', 'completed', 'cancelled', 'expired'], default: 'pending' },
  // Stripe
  stripePaymentIntentId: { type: String, default: null },
  currency:     { type: String, default: 'eur' },
  // WebAuthn challenge (ephemeral, cleared after use)
  webauthnChallenge: { type: String, default: null },
  challengeExpiresAt: { type: Date, default: null },
  // Expiry
  expiresAt: { type: Date, default: () => new Date(Date.now() + 24 * 60 * 60 * 1000) }, // 24h
}, { timestamps: true });

SplitSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL auto-delete
SplitSessionSchema.index({ shareKey: 1 });
SplitSessionSchema.index({ createdBy: 1 });

module.exports = mongoose.model('SplitSession', SplitSessionSchema);