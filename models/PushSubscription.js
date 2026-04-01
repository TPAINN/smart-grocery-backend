// models/PushSubscription.js — Web Push subscriptions per user
const mongoose = require('mongoose');

const pushSubscriptionSchema = new mongoose.Schema({
  userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  // The PushSubscription object from the browser
  endpoint:    { type: String, required: true, unique: true },
  keys: {
    p256dh: { type: String, required: true },
    auth:   { type: String, required: true },
  },
  // Optional: user agent string for device identification
  userAgent:   { type: String },
  createdAt:   { type: Date, default: Date.now },
});

pushSubscriptionSchema.index({ userId: 1 });

module.exports = mongoose.model('PushSubscription', pushSubscriptionSchema);
