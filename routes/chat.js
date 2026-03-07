// routes/chat.js
const express = require('express');
const router = express.Router();
const Message = require('../models/Message');

// Φέρε τα τελευταία 50 μηνύματα για ένα συγκεκριμένο Share Key
router.get('/:shareKey', async (req, res) => {
    try {
        const messages = await Message.find({ shareKey: req.params.shareKey.toUpperCase() })
                                      .sort({ createdAt: 1 }) // Παλαιότερα πρώτα
                                      .limit(50);
        res.json(messages);
    } catch (err) {
        res.status(500).json({ message: 'Σφάλμα ανάκτησης μηνυμάτων.' });
    }
});

module.exports = router;