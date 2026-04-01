// routes/push.js — Web Push subscription management
const express          = require('express');
const router           = express.Router();
const auth             = require('../middleware/authMiddleware');
const PushSubscription = require('../models/PushSubscription');

// ── GET /api/push/vapid-key — Return public VAPID key for the browser ─────
router.get('/vapid-key', (req, res) => {
  if (!process.env.VAPID_PUBLIC_KEY) {
    return res.status(503).json({ message: 'Push notifications not configured.' });
  }
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

// ── POST /api/push/subscribe — Save a new push subscription ──────────────
router.post('/subscribe', auth, async (req, res) => {
  try {
    const { endpoint, keys, userAgent } = req.body;
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return res.status(400).json({ message: 'Ελλιπή στοιχεία subscription.' });
    }

    // Upsert so re-subscribing the same endpoint updates userId mapping
    await PushSubscription.findOneAndUpdate(
      { endpoint },
      { userId: req.userId, endpoint, keys, userAgent: userAgent || '' },
      { upsert: true, new: true },
    );

    res.json({ message: 'Εγγραφή push ειδοποιήσεων επιτυχής.' });
  } catch (err) {
    console.error('❌ POST /api/push/subscribe:', err.message);
    res.status(500).json({ message: err.message });
  }
});

// ── DELETE /api/push/subscribe — Unsubscribe ─────────────────────────────
router.delete('/subscribe', auth, async (req, res) => {
  try {
    const { endpoint } = req.body;
    if (endpoint) {
      await PushSubscription.deleteOne({ endpoint, userId: req.userId });
    } else {
      // Remove all subscriptions for this user
      await PushSubscription.deleteMany({ userId: req.userId });
    }
    res.json({ message: 'Απεγγραφή push ειδοποιήσεων επιτυχής.' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
