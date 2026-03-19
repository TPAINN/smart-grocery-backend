// routes/chat.js — Group Chat Support
const express = require('express');
const router  = express.Router();
const Message = require('../models/Message');

// ── GET /api/chat/group?keys=KEY1,KEY2,KEY3 ────────────────────────────────
// Fetches messages from ALL provided shareKeys, merged and sorted by time.
// This is the core of the group chat — A and B each store messages under their own key,
// but both load from both keys so they see the full conversation.
router.get('/group', async (req, res) => {
  try {
    const keysParam = req.query.keys || '';
    const keys = keysParam.split(',').map(k => k.trim().toUpperCase()).filter(Boolean);
    if (keys.length === 0) return res.json([]);

    // Fetch group messages (no targetShareKey) AND DMs where user is sender or recipient
    const messages = await Message.find({
      $or: [
        // Group messages from any participant
        { shareKey: { $in: keys }, targetShareKey: null },
        // DMs where current user sent
        { shareKey: { $in: keys }, targetShareKey: { $in: keys } },
        // DMs where current user is the target
        { targetShareKey: { $in: keys }, shareKey: { $in: keys } },
      ]
    })
      .sort({ createdAt: 1 })
      .limit(200)
      .lean();

    res.json(messages);
  } catch (err) {
    console.error('Group chat error:', err);
    res.status(500).json({ message: 'Σφάλμα ανάκτησης μηνυμάτων.' });
  }
});

// ── GET /api/chat/:shareKey ────────────────────────────────────────────────
// Fallback: fetch messages for a single shareKey (backwards compatibility)
router.get('/:shareKey', async (req, res) => {
  try {
    const messages = await Message.find({
      shareKey: req.params.shareKey.toUpperCase()
    })
      .sort({ createdAt: 1 })
      .limit(100)
      .lean();
    res.json(messages);
  } catch (err) {
    res.status(500).json({ message: 'Σφάλμα ανάκτησης μηνυμάτων.' });
  }
});

module.exports = router;