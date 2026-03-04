// routes/auth.js
const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const User     = require('../models/User');
const { sendVerificationEmail, sendWelcomeEmail } = require('../services/emailService');

const router     = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_key_smart_grocery';

// ─── Helper: safe user object ─────────────────────────────────────────────────
const safeUser = (u) => ({
  id:              u._id,
  name:            u.name,
  email:           u.email,
  isPremium:       u.isPremium,
  shareKey:        u.shareKey,
  isEmailVerified: u.isEmailVerified,
});

// ─── 1. ΕΓΓΡΑΦΗ ───────────────────────────────────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name?.trim() || !email?.trim() || !password)
      return res.status(400).json({ message: 'Συμπλήρωσε όλα τα πεδία.' });

    const existing = await User.findOne({ email: email.toLowerCase().trim() });
    if (existing) return res.status(400).json({ message: 'Το email χρησιμοποιείται ήδη.' });

    const salt           = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const newUser = new User({ name: name.trim(), email: email.toLowerCase().trim(), password: hashedPassword });
    const token   = newUser.generateVerificationToken();
    await newUser.save();

    // Send verification email (non-blocking — don't fail registration if email fails)
    sendVerificationEmail(newUser.email, newUser.name, token).catch(err =>
      console.error('📧 Email send error:', err.message)
    );

    const jwt_token = jwt.sign({ id: newUser._id, isPremium: newUser.isPremium }, JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({
      token: jwt_token,
      user:  safeUser(newUser),
      message: '📧 Στάλθηκε email επαλήθευσης!',
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Σφάλμα διακομιστή κατά την εγγραφή.' });
  }
});

// ─── 2. ΣΥΝΔΕΣΗ ───────────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email: email?.toLowerCase().trim() });
    if (!user) return res.status(400).json({ message: 'Λάθος email ή κωδικός.' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: 'Λάθος email ή κωδικός.' });

    const token = jwt.sign({ id: user._id, isPremium: user.isPremium }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: safeUser(user) });
  } catch (error) {
    res.status(500).json({ message: 'Σφάλμα διακομιστή κατά τη σύνδεση.' });
  }
});

// ─── 3. ΕΠΑΛΗΘΕΥΣΗ EMAIL (link από email) ────────────────────────────────────
router.get('/verify/:token', async (req, res) => {
  try {
    const user = await User.findOne({
      emailVerificationToken:   req.params.token,
      emailVerificationExpires: { $gt: new Date() },
    });

    if (!user) {
      return res.status(400).send(`
        <!DOCTYPE html><html lang="el"><head><meta charset="UTF-8"/>
        <style>body{font-family:sans-serif;background:#0a0a14;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;}
        .box{background:#13131f;border:1px solid rgba(239,68,68,0.3);border-radius:20px;padding:40px;text-align:center;max-width:400px;}
        h1{color:#ef4444;}p{color:#8a96b8;}</style></head>
        <body><div class="box"><div style="font-size:50px">❌</div>
        <h1>Μη έγκυρος σύνδεσμος</h1>
        <p>Ο σύνδεσμος έχει λήξει ή είναι λάθος.<br/>Κάνε login για να στείλεις νέο email επαλήθευσης.</p>
        </div></body></html>
      `);
    }

    user.isEmailVerified          = true;
    user.emailVerificationToken   = null;
    user.emailVerificationExpires = null;
    await user.save();

    // Send welcome email
    sendWelcomeEmail(user.email, user.name).catch(() => {});

    res.send(`
      <!DOCTYPE html><html lang="el"><head><meta charset="UTF-8"/>
      <meta http-equiv="refresh" content="4;url=${process.env.APP_URL || 'https://smart-hub-app.vercel.app'}"/>
      <style>body{font-family:sans-serif;background:#0a0a14;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;}
      .box{background:#13131f;border:1px solid rgba(16,185,129,0.3);border-radius:20px;padding:40px;text-align:center;max-width:400px;}
      h1{color:#10b981;}p{color:#8a96b8;}
      .bar{height:4px;background:linear-gradient(90deg,#059669,#10b981);border-radius:99px;margin-top:20px;animation:load 4s linear forwards;}
      @keyframes load{from{width:0%}to{width:100%}}</style></head>
      <body><div class="box">
        <div style="font-size:56px">✅</div>
        <h1>Email Επαληθεύτηκε!</h1>
        <p>Γεια σου <strong>${user.name}</strong>!<br/>Ο λογαριασμός σου είναι ενεργός.<br/>Μεταφέρεσαι στην εφαρμογή...</p>
        <div class="bar"></div>
      </div></body></html>
    `);
  } catch (error) {
    res.status(500).json({ message: 'Σφάλμα επαλήθευσης.' });
  }
});

// ─── 4. ΕΠΑΝΑΠΟΣΤΟΛΗ EMAIL ΕΠΑΛΗΘΕΥΣΗΣ ───────────────────────────────────────
router.post('/resend-verification', async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email: email?.toLowerCase().trim() });

    if (!user) return res.status(404).json({ message: 'Ο χρήστης δεν βρέθηκε.' });
    if (user.isEmailVerified) return res.status(400).json({ message: 'Το email είναι ήδη επαληθευμένο.' });

    const token = user.generateVerificationToken();
    await user.save();

    await sendVerificationEmail(user.email, user.name, token);
    res.json({ message: '📧 Νέο email επαλήθευσης στάλθηκε!' });
  } catch (error) {
    res.status(500).json({ message: 'Σφάλμα αποστολής email.' });
  }
});

// ─── 5. ΑΝΑΖΗΤΗΣΗ ΧΡΗΣΤΗ ΑΠΟ SHARE KEY (για friends panel) ──────────────────
router.get('/by-key/:shareKey', async (req, res) => {
  try {
    const user = await User.findOne({ shareKey: req.params.shareKey.toUpperCase() });
    if (!user) return res.status(404).json({ message: 'Χρήστης δεν βρέθηκε.' });
    // Return only public info
    res.json({ name: user.name, shareKey: user.shareKey });
  } catch (error) {
    res.status(500).json({ message: 'Σφάλμα διακομιστή.' });
  }
});

// ─── 6. ADMIN: Scan ανεπαλήθευτους χρήστες & αποστολή email ─────────────────
router.post('/admin/send-verification-bulk', async (req, res) => {
  // Protect with admin secret
  if (req.headers['x-admin-secret'] !== (process.env.ADMIN_SECRET || 'admin_smart_grocery_2024')) {
    return res.status(403).json({ message: 'Απαγορεύεται η πρόσβαση.' });
  }
  try {
    const unverified = await User.find({ isEmailVerified: false });
    let sent = 0, errors = 0;

    for (const user of unverified) {
      try {
        // Skip if already has a non-expired token
        const hasValidToken = user.emailVerificationToken && user.emailVerificationExpires > new Date();
        if (!hasValidToken) {
          user.generateVerificationToken();
          await user.save();
        }
        await sendVerificationEmail(user.email, user.name, user.emailVerificationToken);
        sent++;
        // Small delay to avoid rate limiting
        await new Promise(r => setTimeout(r, 200));
      } catch (err) {
        errors++;
        console.error(`Failed for ${user.email}:`, err.message);
      }
    }

    res.json({
      message: `✅ Ολοκληρώθηκε. Εστάλησαν: ${sent}, Σφάλματα: ${errors}`,
      total:   unverified.length,
      sent,
      errors,
    });
  } catch (error) {
    res.status(500).json({ message: 'Σφάλμα bulk send.' });
  }
});

// ─── 7. ADMIN: Στατιστικά επαλήθευσης ────────────────────────────────────────
router.get('/admin/verification-stats', async (req, res) => {
  if (req.headers['x-admin-secret'] !== (process.env.ADMIN_SECRET || 'admin_smart_grocery_2024')) {
    return res.status(403).json({ message: 'Απαγορεύεται η πρόσβαση.' });
  }
  try {
    const total      = await User.countDocuments();
    const verified   = await User.countDocuments({ isEmailVerified: true });
    const unverified = await User.countDocuments({ isEmailVerified: false });
    const recent     = await User.find({ isEmailVerified: false })
      .select('name email createdAt')
      .sort({ createdAt: -1 })
      .limit(20);

    res.json({ total, verified, unverified, recentUnverified: recent });
  } catch (error) {
    res.status(500).json({ message: 'Σφάλμα.' });
  }
});

module.exports = router;