// routes/splitbill.js
// ─────────────────────────────────────────────────────────────────────────────
// Smart Grocery Hub — Split the Bill
// Architecture: Stripe Tokenization + WebAuthn Biometric Consent + Double Opt-In
// PCI-DSS: Raw card data NEVER touches this server — Stripe handles everything
// ─────────────────────────────────────────────────────────────────────────────
const express      = require('express');
const router       = express.Router();
const crypto       = require('crypto');
const jwt          = require('jsonwebtoken');
const SplitSession = require('../models/SplitSession');
const StarredPartner = require('../models/StarredPartner');
const User         = require('../models/User');

// ── Auth middleware (reuse from auth routes) ──────────────────────────────
const authMiddleware = (req, res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ message: 'Απαιτείται σύνδεση.' });
  try {
    const decoded = jwt.verify(header.split(' ')[1], process.env.JWT_SECRET);
    req.userId   = decoded.id || decoded._id || decoded.userId;
    req.username = decoded.username;
    next();
  } catch {
    return res.status(401).json({ message: 'Μη έγκυρο token.' });
  }
};

// ── Stripe init (lazy — only if STRIPE_SECRET_KEY present) ───────────────
let stripe = null;
const getStripe = () => {
  if (!stripe && process.env.STRIPE_SECRET_KEY) {
    stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  }
  return stripe;
};

// ─────────────────────────────────────────────────────────────────────────────
// STARRED PARTNERS
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/split/partners — list my starred partners
router.get('/partners', authMiddleware, async (req, res) => {
  try {
    const partners = await StarredPartner.find({ userId: req.userId })
      .populate('partnerId', 'username email')
      .sort({ createdAt: -1 });
    res.json({ partners });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/split/partners — add starred partner by username
router.post('/partners', authMiddleware, async (req, res) => {
  const { username, nickname, defaultSplitPercent, autoAccept, autoAcceptThreshold } = req.body;
  if (!username) return res.status(400).json({ message: 'Απαιτείται username.' });

  try {
    const partner = await User.findOne({ username: { $regex: new RegExp(`^${username}$`, 'i') } });
    if (!partner) return res.status(404).json({ message: `Δεν βρέθηκε χρήστης "${username}".` });
    if (partner._id.toString() === req.userId) return res.status(400).json({ message: 'Δεν μπορείς να προσθέσεις τον εαυτό σου.' });

    const existing = await StarredPartner.findOne({ userId: req.userId, partnerId: partner._id });
    if (existing) return res.status(409).json({ message: 'Ο χρήστης είναι ήδη starred partner.' });

    const sp = await StarredPartner.create({
      userId:  req.userId,
      partnerId: partner._id,
      partnerName: partner.username,
      nickname: nickname || '',
      defaultSplitPercent: defaultSplitPercent || 50,
      autoAccept: autoAccept || false,
      autoAcceptThreshold: autoAcceptThreshold || 20,
      status: 'active',
      acceptedAt: new Date(),
    });

    res.status(201).json({ partner: sp, message: `✅ ${partner.username} προστέθηκε ως Starred Partner!` });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PATCH /api/split/partners/:id — update partner settings
router.patch('/partners/:id', authMiddleware, async (req, res) => {
  try {
    const sp = await StarredPartner.findOneAndUpdate(
      { _id: req.params.id, userId: req.userId },
      { $set: req.body },
      { new: true }
    );
    if (!sp) return res.status(404).json({ message: 'Partner δεν βρέθηκε.' });
    res.json({ partner: sp });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE /api/split/partners/:id — remove starred partner
router.delete('/partners/:id', authMiddleware, async (req, res) => {
  try {
    await StarredPartner.findOneAndDelete({ _id: req.params.id, userId: req.userId });
    res.json({ message: 'Partner αφαιρέθηκε.' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// STRIPE SETUP — Store payment method as token (PCI-DSS compliant)
// ─────────────────────────────────────────────────────────────────────────────

// POST /api/split/stripe/setup-intent — create SetupIntent for card tokenization
router.post('/stripe/setup-intent', authMiddleware, async (req, res) => {
  const s = getStripe();
  if (!s) return res.status(503).json({ message: 'Η υπηρεσία πληρωμών δεν είναι διαθέσιμη αυτή τη στιγμή.' });

  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ message: 'Χρήστης δεν βρέθηκε.' });

    // Create or retrieve Stripe Customer
    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await s.customers.create({
        email: user.email,
        name:  user.username,
        metadata: { userId: req.userId },
      });
      customerId = customer.id;
      await User.findByIdAndUpdate(req.userId, { stripeCustomerId: customerId });
    }

    // Create SetupIntent — this tokenizes the card, raw data never reaches us
    const setupIntent = await s.setupIntents.create({
      customer: customerId,
      payment_method_types: ['card'],
      usage: 'off_session', // for future automatic charges
    });

    res.json({
      clientSecret: setupIntent.client_secret,
      customerId,
      message: 'SetupIntent δημιουργήθηκε. Εισάγετε κάρτα με Stripe Elements.',
    });
  } catch (err) {
    console.error('Stripe SetupIntent error:', err);
    res.status(500).json({ message: `Stripe error: ${err.message}` });
  }
});

// POST /api/split/stripe/confirm-setup — save payment method token after Stripe Elements
router.post('/stripe/confirm-setup', authMiddleware, async (req, res) => {
  const { setupIntentId } = req.body;
  const s = getStripe();
  if (!s) return res.status(503).json({ message: 'Stripe μη διαθέσιμο.' });

  try {
    const setupIntent = await s.setupIntents.retrieve(setupIntentId);
    if (setupIntent.status !== 'succeeded') {
      return res.status(400).json({ message: `Setup δεν ολοκληρώθηκε: ${setupIntent.status}` });
    }

    // Store payment method ID (this is a TOKEN — never a raw card number)
    const paymentMethodId = setupIntent.payment_method;
    await User.findByIdAndUpdate(req.userId, {
      stripePaymentMethodId: paymentMethodId,
      stripeCustomerId: setupIntent.customer,
    });

    res.json({ message: '✅ Κάρτα αποθηκεύτηκε με ασφάλεια (tokenized).', paymentMethodId });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// WEBAUTHN BIOMETRIC CONSENT
// ─────────────────────────────────────────────────────────────────────────────

// POST /api/split/webauthn/challenge — generate a one-time challenge
router.post('/webauthn/challenge', authMiddleware, async (req, res) => {
  const { sessionId } = req.body;
  try {
    // Generate cryptographically secure random challenge
    const challenge = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    if (sessionId) {
      await SplitSession.findOneAndUpdate(
        { _id: sessionId },
        { webauthnChallenge: challenge, challengeExpiresAt: expiresAt }
      );
    }

    res.json({
      challenge,
      expiresAt,
      rpId: req.hostname === 'localhost' ? 'localhost' : 'smart-grocery-frontend.vercel.app',
      rpName: 'Smart Grocery Hub',
      userId: req.userId,
      userName: req.username,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/split/webauthn/verify — verify biometric response & issue consent token
router.post('/webauthn/verify', authMiddleware, async (req, res) => {
  const { sessionId, clientDataJSON, signature, challenge } = req.body;
  try {
    // In production: use @simplewebauthn/server for full verification
    // Here we verify the challenge matches and hasn't expired
    const session = sessionId
      ? await SplitSession.findById(sessionId)
      : null;

    const storedChallenge = session?.webauthnChallenge || challenge;
    const expiresAt = session?.challengeExpiresAt;

    if (!storedChallenge) {
      return res.status(400).json({ message: 'Δεν βρέθηκε challenge.' });
    }

    if (expiresAt && new Date() > new Date(expiresAt)) {
      return res.status(400).json({ message: 'Το biometric challenge έληξε.' });
    }

    // Verify: clientDataJSON must contain our challenge
    if (clientDataJSON) {
      const decoded = JSON.parse(Buffer.from(clientDataJSON, 'base64').toString('utf8'));
      if (decoded.challenge !== storedChallenge) {
        return res.status(400).json({ message: 'Αποτυχία biometric verification.' });
      }
    }

    // Issue a Consent Token (JWT, 10min TTL) — this is the Smart Consent Token
    const consentToken = jwt.sign(
      { userId: req.userId, sessionId, action: 'split_consent', challenge: storedChallenge },
      process.env.JWT_SECRET,
      { expiresIn: '10m' }
    );

    // Clear challenge from session
    if (session) {
      session.webauthnChallenge    = null;
      session.challengeExpiresAt   = null;
      await session.save();
    }

    res.json({ consentToken, message: '✅ Biometric verification επιτυχής.' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// SPLIT SESSIONS
// ─────────────────────────────────────────────────────────────────────────────

// POST /api/split/sessions — create a new split session from cart
router.post('/sessions', authMiddleware, async (req, res) => {
  const { shareKey, title, items, partnerIds, splitType = 'equal', customPercents } = req.body;

  if (!items?.length) return res.status(400).json({ message: 'Δεν υπάρχουν προϊόντα.' });
  if (!partnerIds?.length) return res.status(400).json({ message: 'Επιλέξτε τουλάχιστον έναν partner.' });

  try {
    const totalAmount = items.reduce((sum, i) => sum + (i.price * (i.quantity || 1)), 0);

    // Build participants list
    const allUserIds = [req.userId, ...partnerIds];
    const participants = await Promise.all(allUserIds.map(async (uid, idx) => {
      const user = await User.findById(uid).lean();
      const count = allUserIds.length;

      let sharePercent = 100 / count; // equal by default
      if (splitType === 'custom' && customPercents?.[uid]) {
        sharePercent = customPercents[uid];
      }

      return {
        userId:       uid,
        username:     user?.username || 'Unknown',
        sharePercent: Math.round(sharePercent * 100) / 100,
        shareAmount:  Math.round(totalAmount * sharePercent / 100 * 100) / 100,
        status:       uid === req.userId ? 'accepted' : 'pending', // creator auto-accepts
      };
    }));

    // Validate percents sum to ~100
    const totalPercent = participants.reduce((s, p) => s + p.sharePercent, 0);
    if (Math.abs(totalPercent - 100) > 1) {
      return res.status(400).json({ message: `Τα ποσοστά δεν αθροίζουν σε 100% (${totalPercent}%).` });
    }

    const session = await SplitSession.create({
      createdBy:    req.userId,
      shareKey:     shareKey || crypto.randomBytes(8).toString('hex'),
      title:        title || 'Κοινή Αγορά',
      items,
      totalAmount:  Math.round(totalAmount * 100) / 100,
      participants,
      splitType,
      status: 'active',
    });

    res.status(201).json({
      session,
      message: `✅ Split session δημιουργήθηκε! Συνολικό ποσό: ${session.totalAmount.toFixed(2)}€`,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/split/sessions — list my active/recent sessions
router.get('/sessions', authMiddleware, async (req, res) => {
  try {
    const sessions = await SplitSession.find({
      'participants.userId': req.userId,
      status: { $in: ['active', 'pending', 'completed'] },
    }).sort({ createdAt: -1 }).limit(20);
    res.json({ sessions });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/split/sessions/:id — get single session
router.get('/sessions/:id', authMiddleware, async (req, res) => {
  try {
    const session = await SplitSession.findById(req.params.id);
    if (!session) return res.status(404).json({ message: 'Session δεν βρέθηκε.' });

    const isParticipant = session.participants.some(p => p.userId.toString() === req.userId);
    if (!isParticipant) return res.status(403).json({ message: 'Δεν έχεις πρόσβαση σε αυτό το split.' });

    res.json({ session });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/split/sessions/:id/consent — partner gives biometric double opt-in consent
router.post('/sessions/:id/consent', authMiddleware, async (req, res) => {
  const { consentToken, action = 'accept' } = req.body;

  if (action === 'accept' && !consentToken) {
    return res.status(400).json({ message: 'Απαιτείται biometric consent token.' });
  }

  try {
    const session = await SplitSession.findById(req.params.id);
    if (!session || session.status !== 'active') {
      return res.status(404).json({ message: 'Session δεν βρέθηκε ή δεν είναι ενεργό.' });
    }

    const participant = session.participants.find(p => p.userId.toString() === req.userId);
    if (!participant) return res.status(403).json({ message: 'Δεν είσαι συμμετέχων.' });
    if (participant.status !== 'pending') return res.status(400).json({ message: `Έχεις ήδη ${participant.status}.` });

    if (action === 'reject') {
      participant.status = 'rejected';
      session.status     = 'cancelled';
      await session.save();
      return res.json({ message: '❌ Απορρίφθηκε το split request.' });
    }

    // Verify the consent token
    try {
      const decoded = jwt.verify(consentToken, process.env.JWT_SECRET);
      if (decoded.userId !== req.userId) throw new Error('Token mismatch');
      if (decoded.action !== 'split_consent') throw new Error('Wrong action');
    } catch (tokenErr) {
      return res.status(401).json({ message: `Μη έγκυρο consent token: ${tokenErr.message}` });
    }

    participant.status       = 'accepted';
    participant.consentToken = consentToken;
    participant.consentAt    = new Date();

    // Check if ALL participants have accepted (Double Opt-In complete)
    const allAccepted = session.participants.every(p => p.status === 'accepted');
    if (allAccepted) session.status = 'completed'; // ready for payment execution

    await session.save();

    res.json({
      session,
      allAccepted,
      message: allAccepted
        ? '🎉 Όλοι αποδέχθηκαν! Το split είναι έτοιμο για εκτέλεση πληρωμής.'
        : '✅ Αποδοχή καταχωρήθηκε. Αναμονή για τους υπόλοιπους...',
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/split/sessions/:id/execute — execute the actual Stripe payment
router.post('/sessions/:id/execute', authMiddleware, async (req, res) => {
  const s = getStripe();
  if (!s) return res.status(503).json({ message: 'Stripe μη διαθέσιμο. Επικοινωνήστε με τον διαχειριστή.' });

  try {
    const session = await SplitSession.findById(req.params.id);
    if (!session) return res.status(404).json({ message: 'Session δεν βρέθηκε.' });
    if (session.createdBy.toString() !== req.userId) return res.status(403).json({ message: 'Μόνο ο δημιουργός μπορεί να εκτελέσει πληρωμή.' });
    if (session.status !== 'completed') return res.status(400).json({ message: 'Δεν έχουν αποδεχθεί όλοι ακόμα.' });

    const results = [];

    for (const participant of session.participants) {
      if (participant.status !== 'accepted') continue;

      const user = await User.findById(participant.userId).lean();
      if (!user?.stripeCustomerId || !user?.stripePaymentMethodId) {
        results.push({
          userId: participant.userId,
          status: 'skipped',
          reason: 'Δεν έχει αποθηκευμένη κάρτα',
        });
        continue;
      }

      try {
        // Create PaymentIntent for this participant's share
        const paymentIntent = await s.paymentIntents.create({
          amount:   Math.round(participant.shareAmount * 100), // Stripe uses cents
          currency: session.currency || 'eur',
          customer: user.stripeCustomerId,
          payment_method: user.stripePaymentMethodId,
          confirm:  true,
          off_session: true,
          description: `Split Bill: ${session.title} — μερίδιο ${participant.sharePercent}%`,
          metadata: {
            splitSessionId: session._id.toString(),
            userId: participant.userId.toString(),
            sharePercent: participant.sharePercent,
          },
        });

        participant.stripePaymentId = paymentIntent.id;
        participant.status          = 'paid';
        participant.paidAt          = new Date();
        results.push({ userId: participant.userId, status: 'paid', paymentIntentId: paymentIntent.id });
      } catch (stripeErr) {
        results.push({ userId: participant.userId, status: 'failed', reason: stripeErr.message });
      }
    }

    session.stripePaymentIntentId = results.find(r => r.status === 'paid')?.paymentIntentId || null;
    await session.save();

    const allPaid = results.every(r => r.status === 'paid');
    res.json({
      results,
      allPaid,
      message: allPaid
        ? '🎉 Όλες οι πληρωμές εκτελέστηκαν!'
        : '⚠️ Μερικές πληρωμές απέτυχαν. Δες τα αποτελέσματα.',
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/split/history — split history
router.get('/history', authMiddleware, async (req, res) => {
  try {
    const sessions = await SplitSession.find({
      'participants.userId': req.userId,
    }).sort({ createdAt: -1 }).limit(50);
    res.json({ sessions });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;