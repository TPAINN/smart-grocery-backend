// models/User.js
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true }, // Κρυπτογραφημένος κωδικός
  
  // 🎫 SHARE KEY: Για το Shared Cart σύστημα
  shareKey: { 
    type: String, 
    unique: true, // Εξασφαλίζουμε ότι κάθε κλειδί είναι μοναδικό
    default: () => {
        // Παράγει 15 τυχαίους αλφαριθμητικούς χαρακτήρες (Upercase)
        return (Math.random().toString(36).substring(2, 10) + 
                Math.random().toString(36).substring(2, 9))
               .toUpperCase()
               .substring(0, 15);
    }
  },

  isPremium: { type: Boolean, default: false }, // Status συνδρομής
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', userSchema);