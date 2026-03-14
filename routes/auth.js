// routes/auth.js — Complete with persistent bidirectional friends
const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const dns      = require('dns').promises;
const User     = require('../models/User');
const { JWT_SECRET } = require('../config/jwt');

const router = express.Router();

let _io = null;
router.setIO = (io) => { _io = io; };

// ── Helpers ───────────────────────────────────────────────────────────────────
const safeUser = (u) => ({
  id:        u._id,
  name:      u.name,
  email:     u.email,
  isPremium: u.isPremium,
  shareKey:  u.shareKey,
  friends:   (u.friends || []).map(f => ({
    shareKey: f.shareKey,
    username: f.username,
    addedAt:  f.addedAt,
  })),
});

const isRealEmailDomain = async (email) => {
  try {
    const domain = email.split('@')[1];
    if (!domain) return false;
    const records = await dns.resolveMx(domain);
    return Array.isArray(records) && records.length > 0;
  } catch { return false; }
};

const isValidEmailFormat = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);

const authMiddleware = (req, res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ message: 'Απαιτείται σύνδεση.' });
  try {
    const decoded = jwt.verify(header.split(' ')[1], JWT_SECRET);
    req.userId = decoded.id || decoded._id || decoded.userId;
    next();
  } catch (e) {
    if (e.name === 'TokenExpiredError')
      return res.status(401).json({ message: 'Το session έληξε. Συνδέσου ξανά.' });
    return res.status(401).json({ message: 'Μη έγκυρο token.' });
  }
};

// ── 1. REGISTER ───────────────────────────────────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name?.trim() || !email?.trim() || !password)
      return res.status(400).json({ message: 'Συμπλήρωσε όλα τα πεδία.' });

    const cleanEmail = email.toLowerCase().trim();
    if (!isValidEmailFormat(cleanEmail))
      return res.status(400).json({ message: 'Μη έγκυρη μορφή email.' });

    const domainExists = await isRealEmailDomain(cleanEmail);
    if (!domainExists)
      return res.status(400).json({ message: 'Το email δεν φαίνεται να υπάρχει.' });

    if (await User.findOne({ email: cleanEmail }))
      return res.status(400).json({ message: 'Το email χρησιμοποιείται ήδη.' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = await User.create({ name: name.trim(), email: cleanEmail, password: hashedPassword });
    const token = jwt.sign({ id: newUser._id, isPremium: newUser.isPremium }, JWT_SECRET, { expiresIn: '30d' });
    res.status(201).json({ token, user: safeUser(newUser) });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ message: 'Σφάλμα κατά την εγγραφή.' });
  }
});

// ── 2. LOGIN ──────────────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email: email?.toLowerCase().trim() });
    if (!user || !(await bcrypt.compare(password, user.password)))
      return res.status(400).json({ message: 'Λάθος email ή κωδικός.' });

    const token = jwt.sign({ id: user._id, isPremium: user.isPremium }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: safeUser(user) });
  } catch (err) {
    res.status(500).json({ message: 'Σφάλμα κατά τη σύνδεση.' });
  }
});

// ── 3. BY-KEY ─────────────────────────────────────────────────────────────────
router.get('/by-key/:shareKey', async (req, res) => {
  try {
    const key = req.params.shareKey?.trim().toUpperCase();
    if (!key || key.length < 6)
      return res.status(400).json({ message: 'Μη έγκυρο Share Key.' });

    const user = await User.findOne({ shareKey: { $regex: new RegExp(`^${key}$`, 'i') } })
      .select('name shareKey');
    if (!user) return res.status(404).json({ message: 'Χρήστης δεν βρέθηκε.' });

    res.json({ name: user.name, username: user.name, shareKey: user.shareKey });
  } catch (err) {
    res.status(500).json({ message: 'Σφάλμα διακομιστή.' });
  }
});

// ── 4. SEARCH ─────────────────────────────────────────────────────────────────
router.get('/search', authMiddleware, async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 2) return res.json({ users: [] });

    const users = await User.find({
      $and: [
        { _id: { $ne: req.userId } },
        { $or: [
          { name:  { $regex: q, $options: 'i' } },
          { email: { $regex: q, $options: 'i' } },
        ]},
      ]
    }).select('name shareKey _id').limit(10);

    res.json({ users: users.map(u => ({ _id: u._id, name: u.name, username: u.name, shareKey: u.shareKey })) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── 5. ADD FRIEND (bidirectional, persistent) ─────────────────────────────────
// When A adds B:
//  • B is added to A's friends array in DB
//  • A is added to B's friends array in DB  ← the key fix
//  • B gets a real-time socket event if online
router.post('/add-friend', authMiddleware, async (req, res) => {
  try {
    const { targetShareKey } = req.body;
    if (!targetShareKey)
      return res.status(400).json({ message: 'Απαιτείται targetShareKey.' });

    const me = await User.findById(req.userId).select('name shareKey friends');
    if (!me) return res.status(404).json({ message: 'Χρήστης δεν βρέθηκε.' });

    const key = targetShareKey.trim().toUpperCase();
    if (key === me.shareKey)
      return res.status(400).json({ message: 'Δεν μπορείς να προσθέσεις τον εαυτό σου.' });

    const target = await User.findOne({
      shareKey: { $regex: new RegExp(`^${key}$`, 'i') }
    }).select('name shareKey friends');
    if (!target) return res.status(404).json({ message: 'Χρήστης δεν βρέθηκε.' });

    // Add B to A's friends (if not already there)
    const aAlreadyHasB = me.friends.some(f => f.shareKey === target.shareKey);
    if (!aAlreadyHasB) {
      await User.findByIdAndUpdate(me._id, {
        $push: { friends: { shareKey: target.shareKey, username: target.name, addedAt: new Date() } }
      });
    }

    // Add A to B's friends (if not already there) — the bidirectional part
    const bAlreadyHasA = target.friends.some(f => f.shareKey === me.shareKey);
    if (!bAlreadyHasA) {
      await User.findByIdAndUpdate(target._id, {
        $push: { friends: { shareKey: me.shareKey, username: me.name, addedAt: new Date() } }
      });
    }

    // Notify B in real-time (if online)
    if (_io) {
      _io.to(`user_${target.shareKey}`).emit('friend_added', {
        targetShareKey: target.shareKey,
        from: { shareKey: me.shareKey, username: me.name, name: me.name },
      });
    }

    console.log(`👥 Friendship: ${me.name} ↔ ${target.name}`);
    res.json({
      success: true,
      friend: { shareKey: target.shareKey, username: target.name, addedAt: new Date() },
      alreadyFriends: aAlreadyHasB,
    });
  } catch (err) {
    console.error('add-friend error:', err);
    res.status(500).json({ message: err.message });
  }
});

// ── 6. REMOVE FRIEND (bidirectional) ─────────────────────────────────────────
router.delete('/remove-friend/:targetShareKey', authMiddleware, async (req, res) => {
  try {
    const me = await User.findById(req.userId).select('shareKey name');
    if (!me) return res.status(404).json({ message: 'Χρήστης δεν βρέθηκε.' });

    const key = req.params.targetShareKey?.trim().toUpperCase();

    // Remove from both sides
    await User.findByIdAndUpdate(req.userId, {
      $pull: { friends: { shareKey: key } }
    });
    await User.findOneAndUpdate(
      { shareKey: { $regex: new RegExp(`^${key}$`, 'i') } },
      { $pull: { friends: { shareKey: me.shareKey } } }
    );

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── 7. GET MY FRIENDS (called on app load) ────────────────────────────────────
router.get('/friends', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('friends');
    if (!user) return res.status(404).json({ message: 'Χρήστης δεν βρέθηκε.' });
    res.json({ friends: user.friends || [] });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── 8. GET ME ─────────────────────────────────────────────────────────────────
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('-password');
    if (!user) return res.status(404).json({ message: 'Χρήστης δεν βρέθηκε.' });
    res.json({ user: safeUser(user) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Legacy: notify-friend (kept for backward compat, calls add-friend logic) ──
router.post('/notify-friend', authMiddleware, async (req, res) => {
  req.body.targetShareKey = req.body.targetShareKey || req.body.from?.shareKey;
  // Forward to add-friend
  const { targetShareKey } = req.body;
  if (!targetShareKey) return res.status(400).json({ message: 'Απαιτείται targetShareKey.' });
  try {
    const me     = await User.findById(req.userId).select('name shareKey friends');
    const target = await User.findOne({ shareKey: { $regex: new RegExp(`^${targetShareKey.trim().toUpperCase()}$`, 'i') } }).select('name shareKey friends');
    if (!target) return res.status(404).json({ message: 'Χρήστης δεν βρέθηκε.' });

    if (!target.friends.some(f => f.shareKey === me.shareKey)) {
      await User.findByIdAndUpdate(target._id, { $push: { friends: { shareKey: me.shareKey, username: me.name, addedAt: new Date() } } });
    }
    if (!me.friends.some(f => f.shareKey === target.shareKey)) {
      await User.findByIdAndUpdate(me._id, { $push: { friends: { shareKey: target.shareKey, username: target.name, addedAt: new Date() } } });
    }
    if (_io) {
      _io.to(`user_${target.shareKey}`).emit('friend_added', {
        targetShareKey: target.shareKey,
        from: { shareKey: me.shareKey, username: me.name, name: me.name },
      });
    }
    res.json({ success: true, target: { name: target.name, shareKey: target.shareKey } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;