// services/pushService.js — Web Push notification sender
const webpush = require('web-push');
const PushSubscription = require('../models/PushSubscription');

// Configure VAPID — keys must be set in env (generate once with generateVapidKeys.js)
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    `mailto:${process.env.VAPID_EMAIL || 'admin@kalathaki.gr'}`,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
  );
}

/**
 * Send a push notification to a single PushSubscription document.
 * Removes stale subscriptions (410 Gone) automatically.
 */
async function sendToSubscription(sub, payload) {
  const pushSub = {
    endpoint: sub.endpoint,
    keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
  };
  try {
    await webpush.sendNotification(pushSub, JSON.stringify(payload));
    return true;
  } catch (err) {
    if (err.statusCode === 410 || err.statusCode === 404) {
      // Subscription expired — clean it up
      await PushSubscription.deleteOne({ endpoint: sub.endpoint });
    } else {
      console.error('⚠️ Push send error:', err.message);
    }
    return false;
  }
}

/**
 * Broadcast a notification to all subscriptions of a specific user.
 */
async function notifyUser(userId, payload) {
  if (!process.env.VAPID_PUBLIC_KEY) return;
  const subs = await PushSubscription.find({ userId }).lean();
  await Promise.all(subs.map(s => sendToSubscription(s, payload)));
}

/**
 * Broadcast to ALL subscribed users (e.g. new deals after scrape).
 * payload: { title, body, url?, tag? }
 */
async function broadcastToAll(payload) {
  if (!process.env.VAPID_PUBLIC_KEY) return 0;
  const subs = await PushSubscription.find({}).lean();
  let sent = 0;
  for (const s of subs) {
    if (await sendToSubscription(s, payload)) sent++;
  }
  console.log(`🔔 Push broadcast: ${sent}/${subs.length} delivered`);
  return sent;
}

module.exports = { notifyUser, broadcastToAll };
