// services/trialReminder.js
// Καθημερινό cron: στέλνει email υπενθύμισης σε χρήστες των οποίων το δωρεάν
// trial λήγει σε ≤2 μέρες. Υλοποιεί την υπόσχεση του paywall timeline
// («Ημέρα 12 — Σου στέλνουμε υπενθύμιση») — transparency bias, όχι παγίδα.
const cron = require('node-cron');
const User = require('../models/User');
const { sendTrialReminderEmail } = require('./emailService');

const DAY_MS = 24 * 60 * 60 * 1000;

const runTrialReminders = async () => {
  const now = Date.now();
  try {
    // Trial λήγει μέσα στις επόμενες 2 μέρες, δεν είναι ήδη premium,
    // δεν έχει ήδη ειδοποιηθεί.
    const users = await User.find({
      isPremium: false,
      trialReminderSent: { $ne: true },
      trialEndsAt: { $gt: new Date(now), $lte: new Date(now + 2 * DAY_MS) },
    }).select('name email trialEndsAt').lean();

    for (const u of users) {
      const daysLeft = Math.max(1, Math.ceil((new Date(u.trialEndsAt) - now) / DAY_MS));
      try {
        await sendTrialReminderEmail(u.email, u.name, daysLeft);
        await User.updateOne({ _id: u._id }, { $set: { trialReminderSent: true } });
        console.log(`🔔 Trial reminder sent to ${u.email} (${daysLeft}d left)`);
      } catch (err) {
        // Δεν σημαδεύουμε ως σταλμένο — θα ξαναδοκιμάσει αύριο.
        console.error(`⚠️ Trial reminder failed for ${u.email}:`, err.message);
      }
    }
    if (users.length) console.log(`🔔 Trial reminders: ${users.length} processed`);
  } catch (err) {
    console.error('⚠️ Trial reminder job error:', err.message);
  }
};

// 07:00 UTC ≈ 10:00 Ελλάδας — μία φορά τη μέρα.
const startTrialReminderCron = () => {
  cron.schedule('0 7 * * *', runTrialReminders);
};

module.exports = { startTrialReminderCron, runTrialReminders };
