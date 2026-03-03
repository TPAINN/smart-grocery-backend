// models/User.js
const mongoose = require('mongoose');
const crypto = require('crypto');
const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  shareKey: {
    type: String,
    unique: true,
    default: () => crypto.randomBytes(8).toString('hex').toUpperCase().substring(0, 15),
  },
  isPremium: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});
module.exports = mongoose.model('User', userSchema);