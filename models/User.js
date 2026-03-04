// models/User.js
const mongoose = require('mongoose');
const crypto   = require('crypto');

const userSchema = new mongoose.Schema({
  name:     { type: String, required: true },
  email:    { type: String, required: true, unique: true },
  password: { type: String, required: true },

  // 🎫 SHARE KEY: Για το Shared Cart σύστημα
  shareKey: {
    type: String,
    unique: true,
    default: () =>
      (Math.random().toString(36).substring(2, 10) +
       Math.random().toString(36).substring(2, 9))
        .toUpperCase()
        .substring(0, 15),
  },

  // ✅ EMAIL VERIFICATION
  isEmailVerified:          { type: Boolean, default: false },
  emailVerificationToken:   { type: String,  default: null },
  emailVerificationExpires: { type: Date,    default: null },

  isPremium: { type: Boolean, default: false },
  createdAt: { type: Date,    default: Date.now },
});

// Helper: generates a secure random token
userSchema.methods.generateVerificationToken = function () {
  const token = crypto.randomBytes(32).toString('hex');
  this.emailVerificationToken   = token;
  this.emailVerificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h
  return token;
};

module.exports = mongoose.model('User', userSchema);