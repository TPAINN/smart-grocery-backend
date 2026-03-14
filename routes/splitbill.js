// routes/splitbill.js
// ─────────────────────────────────────────────────────────────────────────────
// Smart Grocery Hub — Split the Bill v2
// NEW: Quick Amount Split + Receipt OCR + improved Stripe flow
// ─────────────────────────────────────────────────────────────────────────────
const express        = require('express');
const router         = express.Router();
const crypto         = require('crypto');
const jwt            = require('jsonwebtoken');
const SplitSession   = require('../models/SplitSession');
const StarredPartner = require('../models/StarredPartner');
const User           = require('../models/User');
const { JWT_SECRET } = require('../config/jwt');

// ── Auth middleware ──────────────────────────────────────────────────────────
const authMiddleware = (req, res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ message: 'Απαιτείται σύνδεση.' });
  try {
    const decoded = jwt.verify(header.split(' ')[1], JWT_SECRET);
    req.userId   = decoded.id || decoded._id || decoded.userId;
    req.username = decoded.username || decoded.name || null;
    next();
  } catch {
    return res.status(401).json({ message: 'Μη έγκυρο token.' });
  }
};

// ── Stripe (lazy init) ──────────────────────────────────────────────────────
let stripe = null;
const getStripe = () => {
  if (!stripe && process.env.STRIPE_SECRET_KEY) {
    stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  }
  return stripe;
};

// ═══════════════════════════════════════════════════════════════════════════════
// STARRED PARTNERS
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/partners', authMiddleware, async (req, res) => {
  try {
    const partners = await StarredPartner.find({ userId: req.userId })
      .populate('partnerId', 'username email')
      .sort({ createdAt: -1 });
    res.json({ partners });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

router.post('/partners', authMiddleware, async (req, res) => {
  const { username, nickname, defaultSplitPercent } = req.body;
  if (!username) return res.status(400).json({ message: 'Απαιτείται username.' });
  try {
    const partner = await User.findOne({ name: { $regex: new RegExp(`^${username}$`, 'i') } });
    if (!partner) return res.status(404).json({ message: `Δεν βρέθηκε χρήστης "${username}".` });
    if (partner._id.toString() === req.userId) return res.status(400).json({ message: 'Δεν μπορείς να προσθέσεις τον εαυτό σου.' });
    const existing = await StarredPartner.findOne({ userId: req.userId, partnerId: partner._id });
    if (existing) return res.status(409).json({ message: 'Ήδη starred partner.' });
    const sp = await StarredPartner.create({
      userId: req.userId, partnerId: partner._id, partnerName: partner.name,
      nickname: nickname || '', defaultSplitPercent: defaultSplitPercent || 50,
      status: 'active', acceptedAt: new Date(),
    });
    res.status(201).json({ partner: sp, message: `✅ ${partner.username} προστέθηκε!` });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

router.patch('/partners/:id', authMiddleware, async (req, res) => {
  try {
    const sp = await StarredPartner.findOneAndUpdate({ _id: req.params.id, userId: req.userId }, { $set: req.body }, { new: true });
    if (!sp) return res.status(404).json({ message: 'Partner δεν βρέθηκε.' });
    res.json({ partner: sp });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

router.delete('/partners/:id', authMiddleware, async (req, res) => {
  try {
    await StarredPartner.findOneAndDelete({ _id: req.params.id, userId: req.userId });
    res.json({ message: 'Partner αφαιρέθηκε.' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// STRIPE SETUP — Card tokenization (PCI-DSS compliant)
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/split/stripe/setup-intent
router.post('/stripe/setup-intent', authMiddleware, async (req, res) => {
  const s = getStripe();
  if (!s) return res.status(503).json({ message: 'Stripe δεν είναι διαθέσιμο.' });
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ message: 'Χρήστης δεν βρέθηκε.' });

    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await s.customers.create({
        email: user.email, name: user.username,
        metadata: { userId: req.userId },
      });
      customerId = customer.id;
      await User.findByIdAndUpdate(req.userId, { stripeCustomerId: customerId });
    }

    const setupIntent = await s.setupIntents.create({
      customer: customerId, payment_method_types: ['card'], usage: 'off_session',
    });

    res.json({ clientSecret: setupIntent.client_secret, customerId });
  } catch (err) { res.status(500).json({ message: `Stripe error: ${err.message}` }); }
});

// POST /api/split/stripe/confirm-setup
router.post('/stripe/confirm-setup', authMiddleware, async (req, res) => {
  const { setupIntentId } = req.body;
  const s = getStripe();
  if (!s) return res.status(503).json({ message: 'Stripe μη διαθέσιμο.' });
  try {
    const setupIntent = await s.setupIntents.retrieve(setupIntentId);
    if (setupIntent.status !== 'succeeded') {
      return res.status(400).json({ message: `Setup status: ${setupIntent.status}` });
    }
    await User.findByIdAndUpdate(req.userId, {
      stripePaymentMethodId: setupIntent.payment_method,
      stripeCustomerId: setupIntent.customer,
    });
    res.json({ message: '✅ Κάρτα αποθηκεύτηκε.', paymentMethodId: setupIntent.payment_method });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// GET /api/split/stripe/status — check if user has card saved
router.get('/stripe/status', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.userId).lean();
    res.json({
      hasCard: !!(user?.stripeCustomerId && user?.stripePaymentMethodId),
      customerId: user?.stripeCustomerId || null,
    });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 🆕 QUICK AMOUNT SPLIT — No items, just a total amount
// Flow: User A pays at register → enters amount → selects partner → split
// ═══════════════════════════════════════════════════════════════════════════════

router.post('/quick', authMiddleware, async (req, res) => {
  const { amount, partnerIds, splitType = 'equal', splitPercent, title, description } = req.body;

  // Validate
  if (!amount || amount <= 0) return res.status(400).json({ message: 'Πρέπει να βάλεις ποσό.' });
  if (amount > 10000) return res.status(400).json({ message: 'Μέγιστο ποσό: €10,000.' });
  if (!partnerIds?.length) return res.status(400).json({ message: 'Επίλεξε τουλάχιστον έναν partner.' });

  try {
    const totalAmount = Math.round(amount * 100) / 100;
    const allUserIds = [req.userId, ...partnerIds];
    const count = allUserIds.length;

    // Build participants
    const participants = await Promise.all(allUserIds.map(async (uid, i) => {
      const user = await User.findById(uid).lean();
      let percent;
      if (splitType === 'custom' && splitPercent && i === 0) {
        percent = splitPercent; // creator's percent
      } else if (splitType === 'custom' && splitPercent && i > 0) {
        percent = (100 - splitPercent) / (count - 1);
      } else {
        percent = 100 / count; // equal
      }
      return {
        userId: uid,
        username: user?.name || 'Unknown',
        sharePercent: Math.round(percent * 100) / 100,
        shareAmount: Math.round(totalAmount * percent / 100 * 100) / 100,
        status: uid === req.userId ? 'accepted' : 'pending',
      };
    }));

    const session = await SplitSession.create({
      createdBy: req.userId,
      shareKey: crypto.randomBytes(8).toString('hex'),
      title: title || `Quick Split · ${totalAmount.toFixed(2)}€`,
      items: [{ name: description || 'Γρήγορο Split', price: totalAmount, quantity: 1 }],
      totalAmount,
      participants,
      splitType,
      status: 'active',
    });

    res.status(201).json({
      session,
      message: `✅ Split ${totalAmount.toFixed(2)}€ δημιουργήθηκε!`,
    });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 🆕 RECEIPT OCR — Parse receipt image using AI
// Accepts: base64 image or text from client-side OCR
// Returns: extracted items with prices
// ═══════════════════════════════════════════════════════════════════════════════

router.post('/receipt/parse', authMiddleware, async (req, res) => {
  const { ocrText, items: manualItems } = req.body;

  // Option A: Client already did OCR, sent raw text — we parse it
  if (ocrText) {
    try {
      const parsed = parseReceiptText(ocrText);
      return res.json({
        items: parsed.items,
        total: parsed.total,
        store: parsed.store,
        message: `📝 ${parsed.items.length} προϊόντα βρέθηκαν`,
      });
    } catch (err) {
      return res.status(400).json({ message: 'Δεν ήταν δυνατή η ανάγνωση.', items: [] });
    }
  }

  // Option B: Manual items from client
  if (manualItems?.length) {
    const total = manualItems.reduce((s, i) => s + (i.price || 0), 0);
    return res.json({ items: manualItems, total, message: `📝 ${manualItems.length} προϊόντα` });
  }

  res.status(400).json({ message: 'Στείλε ocrText ή items.' });
});

// POST /api/split/receipt/split — create split session from parsed receipt
router.post('/receipt/split', authMiddleware, async (req, res) => {
  const { items, totalAmount, partnerIds, splitType = 'equal', splitPercent, title } = req.body;

  if (!totalAmount || totalAmount <= 0) return res.status(400).json({ message: 'Μη έγκυρο ποσό.' });
  if (!partnerIds?.length) return res.status(400).json({ message: 'Επίλεξε partner.' });

  try {
    const allUserIds = [req.userId, ...partnerIds];
    const count = allUserIds.length;

    const participants = await Promise.all(allUserIds.map(async (uid, i) => {
      const user = await User.findById(uid).lean();
      let percent = splitType === 'custom' && splitPercent
        ? (i === 0 ? splitPercent : (100 - splitPercent) / (count - 1))
        : 100 / count;
      return {
        userId: uid, username: user?.name || 'Unknown',
        sharePercent: Math.round(percent * 100) / 100,
        shareAmount: Math.round(totalAmount * percent / 100 * 100) / 100,
        status: uid === req.userId ? 'accepted' : 'pending',
      };
    }));

    const session = await SplitSession.create({
      createdBy: req.userId,
      shareKey: crypto.randomBytes(8).toString('hex'),
      title: title || `Απόδειξη · ${totalAmount.toFixed(2)}€`,
      items: items || [{ name: 'Απόδειξη', price: totalAmount, quantity: 1 }],
      totalAmount: Math.round(totalAmount * 100) / 100,
      participants,
      splitType,
      status: 'active',
    });

    res.status(201).json({ session, message: `✅ Split from receipt: ${totalAmount.toFixed(2)}€` });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// RECEIPT TEXT PARSER — Greek supermarket format
// ═══════════════════════════════════════════════════════════════════════════════

function parseReceiptText(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const items = [];
  let total = 0;
  let store = '';

  // Try to detect store name from first few lines
  const storePatterns = [
    { re: /βασιλ[oό]πουλ|α\.?β\.?|ab\b/i, name: 'ΑΒ Βασιλόπουλος' },
    { re: /σκλαβεν[ιί]τ/i, name: 'Σκλαβενίτης' },
    { re: /my\s*market/i, name: 'My Market' },
    { re: /lidl/i, name: 'Lidl' },
    { re: /μασο[υύ]τ/i, name: 'Μασούτης' },
  ];
  for (const line of lines.slice(0, 5)) {
    const match = storePatterns.find(p => p.re.test(line));
    if (match) { store = match.name; break; }
  }

  // Parse item lines: "PRODUCT NAME    1.23" or "PRODUCT NAME    1,23 €"
  const priceRegex = /^(.+?)\s+([\d]+[.,][\d]{2})\s*[€]*\s*$/;
  const totalRegex = /(?:σ[υύ]νολο|total|πληρωτ[εέ]ο|ΣΥΝΟΛΟ|ΠΛΗΡΩΤΕΟ)\s*[:.]?\s*([\d]+[.,][\d]{2})/i;

  for (const line of lines) {
    // Check for total line
    const totalMatch = line.match(totalRegex);
    if (totalMatch) {
      total = parseFloat(totalMatch[1].replace(',', '.'));
      continue;
    }

    // Check for item line
    const itemMatch = line.match(priceRegex);
    if (itemMatch) {
      const name = itemMatch[1].trim();
      const price = parseFloat(itemMatch[2].replace(',', '.'));

      // Skip common non-item lines
      if (/^(ΑΦΜ|ΦΠΑ|ΑΡΙΘ|ΔΟΥ|ΕΞΥ|VISA|MASTER|ΜΕΤΡ|ΡΕΣΤΑ|ΠΛΗΡ|ΕΚΠΤ|ΥΠΟΛ|ΤΑΜΕΙ)/i.test(name)) continue;
      if (price <= 0 || price > 500) continue;

      items.push({ name, price, quantity: 1, store });
    }
  }

  // If no total found, sum items
  if (!total && items.length) {
    total = items.reduce((s, i) => s + i.price, 0);
  }

  return { items, total: Math.round(total * 100) / 100, store };
}

// ═══════════════════════════════════════════════════════════════════════════════
// WEBAUTHN BIOMETRIC CONSENT
// ═══════════════════════════════════════════════════════════════════════════════

router.post('/webauthn/challenge', authMiddleware, async (req, res) => {
  const { sessionId } = req.body;
  try {
    const challenge = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    if (sessionId) {
      await SplitSession.findOneAndUpdate({ _id: sessionId }, { webauthnChallenge: challenge, challengeExpiresAt: expiresAt });
    }
    res.json({
      challenge, expiresAt,
      rpId: req.hostname === 'localhost' ? 'localhost' : 'smart-grocery-frontend.vercel.app',
      rpName: 'Smart Grocery Hub', userId: req.userId, userName: req.username,
    });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

router.post('/webauthn/verify', authMiddleware, async (req, res) => {
  const { sessionId, clientDataJSON, challenge } = req.body;
  try {
    if (sessionId) {
      const session = await SplitSession.findById(sessionId);
      if (session?.webauthnChallenge && session.webauthnChallenge !== challenge) {
        return res.status(400).json({ message: 'Challenge mismatch.' });
      }
      if (session?.challengeExpiresAt && session.challengeExpiresAt < new Date()) {
        return res.status(400).json({ message: 'Challenge expired.' });
      }
    }
    // Generate consent token (JWT valid for 30 min)
    const consentToken = jwt.sign(
      { userId: req.userId, action: 'split_consent', sessionId, ts: Date.now() },
      process.env.JWT_SECRET,
      { expiresIn: '30m' }
    );
    // Clear challenge
    if (sessionId) {
      await SplitSession.findByIdAndUpdate(sessionId, { webauthnChallenge: null, challengeExpiresAt: null });
    }
    res.json({ consentToken, message: '✅ Biometric verified.' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// SPLIT SESSIONS — CRUD + consent + execute
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/split/sessions — create from full item list
router.post('/sessions', authMiddleware, async (req, res) => {
  const { shareKey, items, partnerIds, splitType = 'equal', customPercents, title } = req.body;
  if (!items?.length) return res.status(400).json({ message: 'Η λίστα είναι κενή.' });
  if (!partnerIds?.length) return res.status(400).json({ message: 'Επίλεξε partner.' });

  try {
    const totalAmount = items.reduce((s, i) => s + (i.price || 0) * (i.quantity || 1), 0);
    const allUserIds = [req.userId, ...partnerIds];
    const count = allUserIds.length;

    const participants = await Promise.all(allUserIds.map(async (uid) => {
      const user = await User.findById(uid).lean();
      let sharePercent = 100 / count;
      if (splitType === 'custom' && customPercents?.[uid]) sharePercent = customPercents[uid];
      return {
        userId: uid, username: user?.username || 'Unknown',
        sharePercent: Math.round(sharePercent * 100) / 100,
        shareAmount: Math.round(totalAmount * sharePercent / 100 * 100) / 100,
        status: uid === req.userId ? 'accepted' : 'pending',
      };
    }));

    const totalPercent = participants.reduce((s, p) => s + p.sharePercent, 0);
    if (Math.abs(totalPercent - 100) > 1) {
      return res.status(400).json({ message: `Ποσοστά: ${totalPercent}% (πρέπει 100%).` });
    }

    const session = await SplitSession.create({
      createdBy: req.userId,
      shareKey: shareKey || crypto.randomBytes(8).toString('hex'),
      title: title || 'Κοινή Αγορά',
      items, totalAmount: Math.round(totalAmount * 100) / 100,
      participants, splitType, status: 'active',
    });

    res.status(201).json({ session, message: `✅ Split: ${session.totalAmount.toFixed(2)}€` });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

router.get('/sessions', authMiddleware, async (req, res) => {
  try {
    const sessions = await SplitSession.find({
      'participants.userId': req.userId,
      status: { $in: ['active', 'pending', 'completed'] },
    }).sort({ createdAt: -1 }).limit(20);
    res.json({ sessions });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

router.get('/sessions/:id', authMiddleware, async (req, res) => {
  try {
    const session = await SplitSession.findById(req.params.id);
    if (!session) return res.status(404).json({ message: 'Session δεν βρέθηκε.' });
    const isP = session.participants.some(p => p.userId.toString() === req.userId);
    if (!isP) return res.status(403).json({ message: 'Δεν έχεις πρόσβαση.' });
    res.json({ session });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// Consent
router.post('/sessions/:id/consent', authMiddleware, async (req, res) => {
  const { consentToken, action = 'accept' } = req.body;
  if (action === 'accept' && !consentToken) return res.status(400).json({ message: 'Consent token απαιτείται.' });

  try {
    const session = await SplitSession.findById(req.params.id);
    if (!session || session.status !== 'active') return res.status(404).json({ message: 'Session μη ενεργό.' });
    const p = session.participants.find(x => x.userId.toString() === req.userId);
    if (!p) return res.status(403).json({ message: 'Δεν είσαι συμμετέχων.' });
    if (p.status !== 'pending') return res.status(400).json({ message: `Ήδη ${p.status}.` });

    if (action === 'reject') {
      p.status = 'rejected'; session.status = 'cancelled';
      await session.save();
      return res.json({ message: '❌ Απορρίφθηκε.' });
    }

    try {
      const decoded = jwt.verify(consentToken, JWT_SECRET);
      if (decoded.userId !== req.userId || decoded.action !== 'split_consent') throw new Error('Invalid');
    } catch { return res.status(401).json({ message: 'Μη έγκυρο consent token.' }); }

    p.status = 'accepted'; p.consentToken = consentToken; p.consentAt = new Date();
    const allAccepted = session.participants.every(x => x.status === 'accepted');
    if (allAccepted) session.status = 'completed';
    await session.save();

    res.json({
      session, allAccepted,
      message: allAccepted ? '🎉 Όλοι αποδέχθηκαν!' : '✅ Αναμονή υπολοίπων...',
    });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// Execute Stripe payment
router.post('/sessions/:id/execute', authMiddleware, async (req, res) => {
  const s = getStripe();
  if (!s) return res.status(503).json({ message: 'Stripe μη διαθέσιμο.' });

  try {
    const session = await SplitSession.findById(req.params.id);
    if (!session) return res.status(404).json({ message: 'Session δεν βρέθηκε.' });
    if (session.createdBy.toString() !== req.userId) return res.status(403).json({ message: 'Μόνο ο δημιουργός.' });
    if (session.status !== 'completed') return res.status(400).json({ message: 'Δεν έχουν αποδεχθεί όλοι.' });

    const results = [];
    for (const participant of session.participants) {
      if (participant.status !== 'accepted') continue;
      const user = await User.findById(participant.userId).lean();
      if (!user?.stripeCustomerId || !user?.stripePaymentMethodId) {
        results.push({ userId: participant.userId, status: 'skipped', reason: 'Χωρίς κάρτα' });
        continue;
      }
      try {
        const pi = await s.paymentIntents.create({
          amount: Math.round(participant.shareAmount * 100),
          currency: session.currency || 'eur',
          customer: user.stripeCustomerId,
          payment_method: user.stripePaymentMethodId,
          confirm: true, off_session: true,
          description: `Split: ${session.title} — ${participant.sharePercent}%`,
          metadata: { splitSessionId: session._id.toString(), userId: participant.userId.toString() },
        });
        participant.stripePaymentId = pi.id;
        participant.status = 'paid';
        participant.paidAt = new Date();
        results.push({ userId: participant.userId, status: 'paid', paymentIntentId: pi.id });
      } catch (err) {
        results.push({ userId: participant.userId, status: 'failed', reason: err.message });
      }
    }

    await session.save();
    const allPaid = results.every(r => r.status === 'paid');
    res.json({ results, allPaid, message: allPaid ? '🎉 Πληρωμές ολοκληρώθηκαν!' : '⚠️ Κάποιες απέτυχαν.' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// History
router.get('/history', authMiddleware, async (req, res) => {
  try {
    const sessions = await SplitSession.find({ 'participants.userId': req.userId }).sort({ createdAt: -1 }).limit(50);
    res.json({ sessions });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

module.exports = router;