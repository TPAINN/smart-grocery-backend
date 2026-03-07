// models/Message.js
const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
    shareKey: { type: String, required: true },
    senderName: { type: String, required: true },
    text: { type: String, required: true },
    createdAt: { 
        type: Date, 
        default: Date.now,
        // 🚨 ΕΔΩ ΕΙΝΑΙ Η ΜΑΓΕΙΑ (TTL): Διαγράφεται αυτόματα μετά από 86400 δευτερόλεπτα (24 ώρες)
        expires: 86400 
    }
});

module.exports = mongoose.model('Message', messageSchema);