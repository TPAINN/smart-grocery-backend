// models/User.js — with persistent friends list
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name:     { type: String, required: true },
  email:    { type: String, required: true, unique: true },
  password: { type: String, required: true },
  stripeCustomerId:      { type: String, default: null },
  stripePaymentMethodId: { type: String, default: null },
  stripeSubscriptionId:  { type: String, default: null },
  premiumType:           { type: String, enum: ['monthly', 'yearly', 'lifetime', null], default: null },

  // 🎫 Permanent unique share key — generated once at registration, never changes
  shareKey: {
    type: String,
    unique: true,
    default: () =>
      (Math.random().toString(36).substring(2, 10) +
       Math.random().toString(36).substring(2, 9))
        .toUpperCase()
        .substring(0, 15),
  },

  // 👥 Persistent friends list — array of shareKeys
  // Both sides are stored: when A adds B, both A's and B's docs are updated
  friends: [{
    shareKey:  { type: String, required: true },
    username:  { type: String, required: true },
    addedAt:   { type: Date, default: Date.now },
  }],

  isPremium:   { type: Boolean, default: false },
  // 🎁 Free trial: 14 days from registration
  trialEndsAt: {
    type:    Date,
    default: () => new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
  },
  createdAt: { type: Date, default: Date.now },
});

// Index for fast friend lookup
userSchema.index({ shareKey: 1 });
userSchema.index({ 'friends.shareKey': 1 });

module.exports = mongoose.model('User', userSchema);