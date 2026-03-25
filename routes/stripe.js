// routes/stripe.js — Stripe Checkout + Webhook for Καλαθάκι Premium
const express = require('express');
const router  = express.Router();
const Stripe  = require('stripe');
const User    = require('../models/User');
const authMiddleware = require('../middleware/authMiddleware');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ── Price configuration (in EUR cents) ──────────────────────────────────────
const PRICES = {
  monthly:  { amount: 199, interval: 'month',  label: 'Premium Μηνιαία' },
  yearly:   { amount: 1499, interval: 'year',  label: 'Premium Ετήσια' },
  lifetime: { amount: 2999, interval: null,     label: 'Premium Lifetime' },
};

// ── 1. CREATE CHECKOUT SESSION ──────────────────────────────────────────────
router.post('/create-checkout-session', authMiddleware, async (req, res) => {
  const { plan } = req.body; // 'monthly' | 'yearly' | 'lifetime'
  if (!PRICES[plan]) return res.status(400).json({ message: 'Μη έγκυρο πλάνο.' });

  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ message: 'Χρήστης δεν βρέθηκε.' });

    // Create or reuse Stripe customer
    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.name,
        metadata: { userId: user._id.toString() },
      });
      customerId = customer.id;
      user.stripeCustomerId = customerId;
      await user.save();
    }

    const priceConfig = PRICES[plan];
    const frontendUrl = process.env.APP_URL || 'https://smart-grocery-frontend.vercel.app';

    const sessionParams = {
      customer: customerId,
      payment_method_types: ['card'],
      mode: priceConfig.interval ? 'subscription' : 'payment',
      success_url: `${frontendUrl}?payment=success&plan=${plan}`,
      cancel_url:  `${frontendUrl}?payment=cancelled`,
      metadata: { userId: user._id.toString(), plan },
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: { name: priceConfig.label, description: 'Καλαθάκι — Smart Grocery Hub Premium' },
          unit_amount: priceConfig.amount,
          ...(priceConfig.interval ? { recurring: { interval: priceConfig.interval } } : {}),
        },
        quantity: 1,
      }],
    };

    // For subscriptions, allow trial period if user hasn't tried before
    if (priceConfig.interval && user.trialEndsAt && new Date() < user.trialEndsAt && !user.isPremium) {
      const trialDaysLeft = Math.ceil((user.trialEndsAt - Date.now()) / (1000 * 60 * 60 * 24));
      if (trialDaysLeft > 0) {
        sessionParams.subscription_data = { trial_period_days: trialDaysLeft };
      }
    }

    const session = await stripe.checkout.sessions.create(sessionParams);
    res.json({ url: session.url });
  } catch (err) {
    console.error('❌ Stripe checkout error:', err.message);
    res.status(500).json({ message: `Σφάλμα πληρωμής: ${err.message}` });
  }
});

// ── 2. GET SUBSCRIPTION STATUS ──────────────────────────────────────────────
router.get('/subscription-status', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('isPremium premiumType trialEndsAt stripeSubscriptionId');
    if (!user) return res.status(404).json({ message: 'Χρήστης δεν βρέθηκε.' });

    const now = new Date();
    const isOnTrial = !user.isPremium && user.trialEndsAt && now < user.trialEndsAt;
    const trialDaysLeft = isOnTrial ? Math.ceil((user.trialEndsAt - now) / (1000 * 60 * 60 * 24)) : 0;

    res.json({
      isPremium: user.isPremium,
      premiumType: user.premiumType,
      isOnTrial,
      trialDaysLeft,
      hasSubscription: !!user.stripeSubscriptionId,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── 3. CANCEL SUBSCRIPTION ─────────────────────────────────────────────────
router.post('/cancel-subscription', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user?.stripeSubscriptionId) return res.status(400).json({ message: 'Δεν βρέθηκε ενεργή συνδρομή.' });

    await stripe.subscriptions.update(user.stripeSubscriptionId, { cancel_at_period_end: true });
    res.json({ message: 'Η συνδρομή θα ακυρωθεί στο τέλος της τρέχουσας περιόδου.' });
  } catch (err) {
    console.error('❌ Cancel subscription error:', err.message);
    res.status(500).json({ message: err.message });
  }
});

// ── 4. WEBHOOK (called by Stripe) ──────────────────────────────────────────
// NOTE: This route must be registered BEFORE express.json() middleware
// or use express.raw() — see server.js integration
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  const webhookSecretThin = process.env.STRIPE_WEBHOOK_SECRET_THIN;

  let event;
  try {
    if (webhookSecret || webhookSecretThin) {
      // Try snapshot secret first, then thin payload secret
      let verified = false;
      for (const secret of [webhookSecret, webhookSecretThin].filter(Boolean)) {
        try {
          event = stripe.webhooks.constructEvent(req.body, sig, secret);
          verified = true;
          break;
        } catch (_) {}
      }
      if (!verified) throw new Error('No matching webhook secret');
    } else {
      event = JSON.parse(req.body.toString());
      console.warn('⚠️ Stripe webhook running without signature verification (dev mode)');
    }
  } catch (err) {
    console.error('❌ Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log(`🔔 Stripe event: ${event.type}`);

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const userId = session.metadata?.userId;
        const plan   = session.metadata?.plan;
        if (!userId) break;

        const update = { isPremium: true, premiumType: plan };
        if (session.subscription) update.stripeSubscriptionId = session.subscription;

        await User.findByIdAndUpdate(userId, update);
        console.log(`✅ User ${userId} upgraded to ${plan}`);
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const user = await User.findOne({ stripeSubscriptionId: sub.id });
        if (user) {
          user.isPremium = false;
          user.premiumType = null;
          user.stripeSubscriptionId = null;
          await user.save();
          console.log(`⚠️ Subscription cancelled for user ${user._id}`);
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const sub = invoice.subscription;
        if (sub) {
          const user = await User.findOne({ stripeSubscriptionId: sub });
          if (user) console.warn(`⚠️ Payment failed for user ${user._id}`);
        }
        break;
      }
    }
  } catch (err) {
    console.error('❌ Webhook handler error:', err.message);
  }

  res.json({ received: true });
});

// ── 5. GET PRICES (for frontend display) ────────────────────────────────────
router.get('/prices', (req, res) => {
  res.json({
    monthly:  { amount: PRICES.monthly.amount,  label: PRICES.monthly.label,  price: '1,99€/μήνα' },
    yearly:   { amount: PRICES.yearly.amount,    label: PRICES.yearly.label,   price: '14,99€/χρόνο', saving: 'Εξοικονόμηση 9€' },
    lifetime: { amount: PRICES.lifetime.amount,  label: PRICES.lifetime.label, price: '29,99€ μία φορά', saving: 'Για πάντα!' },
  });
});

module.exports = router;
