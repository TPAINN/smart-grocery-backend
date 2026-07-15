// models/Message.js
const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
    shareKey: { type: String, required: true },
    senderName: { type: String, required: true },
    text: { type: String, required: true },
    // Optional: if set, this is a private DM to one friend only (not group broadcast)
    targetShareKey: { type: String, default: null },
    createdAt: {
        type: Date,
        default: Date.now,
    }
});

// TTL index for auto-expiry - messages expire after 24 hours
messageSchema.index({ createdAt: 1 }, { expires: 86400 });

module.exports = mongoose.model('Message', messageSchema);