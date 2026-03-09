// routes/auth.js — Fixed & Complete
const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const dns      = require('dns').promises;
const User     = require('../models/User');

const router     = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_key_smart_grocery';

// io reference injected by server.js for real-time friend notifications
let _io = null;
router.setIO = (io) => { _io = io; };

// ── Helpers ───────────────────────────────────────────────────────────────────
const safeUser = (u) => ({
  id:        u._id,
  name:      u.name,
  email:     u.email,
  isPremium: u.isPremium,
  shareKey:  u.shareKey,
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

// ── Auth middleware (local) ────────────────────────────────────────────────────
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

// ── 1. ΕΓΓΡΑΦΗ ────────────────────────────────────────────────────────────────
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
      return res.status(400).json({ message: 'Το email δεν φαίνεται να υπάρχει. Έλεγξε ξανά.' });

    if (await User.findOne({ email: cleanEmail }))
      return res.status(400).json({ message: 'Το email χρησιμοποιείται ήδη.' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = await User.create({ name: name.trim(), email: cleanEmail, password: hashedPassword });
    const token = jwt.sign({ id: newUser._id, isPremium: newUser.isPremium }, JWT_SECRET, { expiresIn: '30d' });
    res.status(201).json({ token, user: safeUser(newUser) });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ message: 'Σφάλμα διακομιστή κατά την εγγραφή.' });
  }
});

// ── 2. ΣΥΝΔΕΣΗ ────────────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email: email?.toLowerCase().trim() });
    if (!user || !(await bcrypt.compare(password, user.password)))
      return res.status(400).json({ message: 'Λάθος email ή κωδικός.' });

    const token = jwt.sign({ id: user._id, isPremium: user.isPremium }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: safeUser(user) });
  } catch (err) {
    res.status(500).json({ message: 'Σφάλμα διακομιστή κατά τη σύνδεση.' });
  }
});

// ── 3. BY-KEY (FIX: returns both name + username for compatibility) ────────────
router.get('/by-key/:shareKey', async (req, res) => {
  try {
    // Case-insensitive, trimmed search — was the cause of "user not found" bug
    const key = req.params.shareKey?.trim().toUpperCase();
    if (!key || key.length < 6)
      return res.status(400).json({ message: 'Μη έγκυρο Share Key.' });

    const user = await User.findOne({ shareKey: { $regex: new RegExp(`^${key}$`, 'i') } })
      .select('name shareKey');
    if (!user)
      return res.status(404).json({ message: 'Χρήστης δεν βρέθηκε.' });

    // Return BOTH name AND username — frontend uses both
    res.json({ name: user.name, username: user.name, shareKey: user.shareKey });
  } catch (err) {
    res.status(500).json({ message: 'Σφάλμα διακομιστή.' });
  }
});

// ── 4. SEARCH USERS (για split bill partner search) ───────────────────────────
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

// ── 5. NOTIFY FRIEND (persistent mutual friendship) ───────────────────────────
// Called when A adds B. Verifies the target exists, then emits a real-time socket
// event to B's personal room (`user_${B.shareKey}`). Even if B is offline, when
// they reconnect and re-join their room they'll see the stored friends list
// (stored in localStorage on their device after the socket event fires).
router.post('/notify-friend', authMiddleware, async (req, res) => {
  try {
    const { targetShareKey, from } = req.body;
    if (!targetShareKey) return res.status(400).json({ message: 'Απαιτείται targetShareKey.' });

    const target = await User.findOne({
      shareKey: { $regex: new RegExp(`^${targetShareKey.trim().toUpperCase()}$`, 'i') }
    }).select('name shareKey');

    if (!target) return res.status(404).json({ message: 'Χρήστης δεν βρέθηκε.' });

    // Emit to target's personal room via Socket.io
    if (_io) {
      _io.to(`user_${target.shareKey}`).emit('friend_added', {
        targetShareKey: target.shareKey,
        from: { shareKey: from.shareKey, username: from.name || from.username, name: from.name || from.username },
      });
    }

    res.json({ success: true, target: { name: target.name, shareKey: target.shareKey } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── 6. GET ME ─────────────────────────────────────────────────────────────────
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('-password');
    if (!user) return res.status(404).json({ message: 'Χρήστης δεν βρέθηκε.' });
    res.json({ user: safeUser(user) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;