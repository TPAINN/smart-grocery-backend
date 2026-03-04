// routes/auth.js
const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const dns      = require('dns').promises;
const User     = require('../models/User');

const router     = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_key_smart_grocery';

// ─── Helper: safe user object ─────────────────────────────────────────────────
const safeUser = (u) => ({
  id:        u._id,
  name:      u.name,
  email:     u.email,
  isPremium: u.isPremium,
  shareKey:  u.shareKey,
});

// ─── MX record check — ελέγχει αν το domain έχει πραγματικό mail server ───────
const isRealEmailDomain = async (email) => {
  try {
    const domain = email.split('@')[1];
    if (!domain) return false;
    const records = await dns.resolveMx(domain);
    return Array.isArray(records) && records.length > 0;
  } catch {
    return false; // domain δεν υπάρχει
  }
};

const isValidEmailFormat = (email) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);

// ─── 1. ΕΓΓΡΑΦΗ ───────────────────────────────────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name?.trim() || !email?.trim() || !password)
      return res.status(400).json({ message: 'Συμπλήρωσε όλα τα πεδία.' });

    const cleanEmail = email.toLowerCase().trim();

    if (!isValidEmailFormat(cleanEmail))
      return res.status(400).json({ message: 'Μη έγκυρη μορφή email.' });

    // Έλεγχος αν το domain του email υπάρχει πραγματικά (MX records)
    const domainExists = await isRealEmailDomain(cleanEmail);
    if (!domainExists)
      return res.status(400).json({ message: 'Το email δεν φαίνεται να υπάρχει. Έλεγξε ξανά.' });

    const existing = await User.findOne({ email: cleanEmail });
    if (existing)
      return res.status(400).json({ message: 'Το email χρησιμοποιείται ήδη.' });

    const salt           = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    const newUser        = new User({ name: name.trim(), email: cleanEmail, password: hashedPassword });
    await newUser.save();

    const token = jwt.sign({ id: newUser._id, isPremium: newUser.isPremium }, JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ token, user: safeUser(newUser) });

  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ message: 'Σφάλμα διακομιστή κατά την εγγραφή.' });
  }
});

// ─── 2. ΣΥΝΔΕΣΗ ───────────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email: email?.toLowerCase().trim() });
    if (!user)
      return res.status(400).json({ message: 'Λάθος email ή κωδικός.' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch)
      return res.status(400).json({ message: 'Λάθος email ή κωδικός.' });

    const token = jwt.sign({ id: user._id, isPremium: user.isPremium }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: safeUser(user) });

  } catch (error) {
    res.status(500).json({ message: 'Σφάλμα διακομιστή κατά τη σύνδεση.' });
  }
});

// ─── 3. ΑΝΑΖΗΤΗΣΗ ΧΡΗΣΤΗ ΑΠΟ SHARE KEY (για friends panel) ──────────────────
router.get('/by-key/:shareKey', async (req, res) => {
  try {
    const user = await User.findOne({ shareKey: req.params.shareKey.toUpperCase() });
    if (!user)
      return res.status(404).json({ message: 'Χρήστης δεν βρέθηκε.' });
    res.json({ name: user.name, shareKey: user.shareKey });
  } catch (error) {
    res.status(500).json({ message: 'Σφάλμα διακομιστή.' });
  }
});

module.exports = router;