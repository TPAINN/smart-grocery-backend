// routes/chat.js - Group chat with authenticated access control
const express = require('express');
const router = express.Router();
const Message = require('../models/Message');
const auth = require('../middleware/authMiddleware');
const { loadUserAccess } = require('../services/userAccess');

const normalizeKeys = (value) =>
  String(value || '')
    .split(',')
    .map((key) => key.trim().toUpperCase())
    .filter(Boolean);

async function getChatAccess(req, res) {
  const access = await loadUserAccess(req.userId, 'shareKey friends isPremium trialEndsAt name');
  if (!access) {
    res.status(404).json({ message: 'Χρήστης δεν βρέθηκε.' });
    return null;
  }

  return access;
}

router.get('/group', auth, async (req, res) => {
  try {
    const access = await getChatAccess(req, res);
    if (!access) return;

    const requestedKeys = normalizeKeys(req.query.keys).slice(0, 25);
    const invalidKeys = requestedKeys.filter((key) => !access.allowedShareKeys.includes(key));
    if (invalidKeys.length > 0) {
      return res.status(403).json({ message: 'Μη εξουσιοδοτημένη πρόσβαση σε συνομιλία.' });
    }

    const ownKey = String(access.user.shareKey || '').trim().toUpperCase();
    const keys = requestedKeys.length > 0 ? requestedKeys : [ownKey];
    if (keys.length === 0) return res.json([]);

    // Group messages are visible across the requested rooms.
    // Direct messages are only visible when the authenticated user is one side of the DM.
    const messages = await Message.find({
      $or: [
        { shareKey: { $in: keys }, targetShareKey: null },
        { shareKey: ownKey, targetShareKey: { $in: keys } },
        { targetShareKey: ownKey, shareKey: { $in: keys } },
      ],
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

router.get('/:shareKey', auth, async (req, res) => {
  try {
    const access = await getChatAccess(req, res);
    if (!access) return;

    const ownKey = String(access.user.shareKey || '').trim().toUpperCase();
    const roomKey = String(req.params.shareKey || '').trim().toUpperCase();
    if (!roomKey || !access.allowedShareKeys.includes(roomKey)) {
      return res.status(403).json({ message: 'Μη εξουσιοδοτημένη πρόσβαση σε συνομιλία.' });
    }

    const query = roomKey === ownKey
      ? {
          $or: [
            { shareKey: ownKey, targetShareKey: null },
            { shareKey: ownKey, targetShareKey: { $in: access.allowedShareKeys } },
            { targetShareKey: ownKey, shareKey: { $in: access.allowedShareKeys } },
          ],
        }
      : {
          $or: [
            { shareKey: roomKey, targetShareKey: null },
            { shareKey: ownKey, targetShareKey: roomKey },
            { shareKey: roomKey, targetShareKey: ownKey },
          ],
        };

    const messages = await Message.find(query)
      .sort({ createdAt: 1 })
      .limit(100)
      .lean();

    res.json(messages);
  } catch (err) {
    console.error('Chat history error:', err);
    res.status(500).json({ message: 'Σφάλμα ανάκτησης μηνυμάτων.' });
  }
});

module.exports = router;
