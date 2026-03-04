// models/User.js
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name:     { type: String, required: true },
  email:    { type: String, required: true, unique: true },
  password: { type: String, required: true },

  // 🎫 SHARE KEY για το Shared Cart
  shareKey: {
    type: String,
    unique: true,
    default: () =>
      (Math.random().toString(36).substring(2, 10) +
       Math.random().toString(36).substring(2, 9))
        .toUpperCase()
        .substring(0, 15),
  },

  isPremium: { type: Boolean, default: false },
  createdAt: { type: Date,    default: Date.now },
});

module.exports = mongoose.model('User', userSchema);