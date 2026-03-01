// models/SavedList.js
const mongoose = require('mongoose');

const savedListSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // Η λίστα ανήκει σε συγκεκριμένο χρήστη
  title: { type: String, required: true }, // Π.χ. "Ψώνια Σαββατοκύριακου"
  items: [{
    id: { type: String }, // Το ID που έχει στο Frontend
    text: { type: String, required: true }, // Το όνομα του προϊόντος
    category: { type: String },
    price: { type: Number, default: 0 },
    store: { type: String, default: 'Άγνωστο' },
    isChecked: { type: Boolean, default: false } // ΝΕΟ: Για το Checklist feature (τικάρισμα στο ράφι)
  }],
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('SavedList', savedListSchema);