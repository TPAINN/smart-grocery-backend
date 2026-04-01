#!/usr/bin/env node
// generateVapidKeys.js — Run once to generate VAPID key pair
// Usage: node generateVapidKeys.js
// Then copy the output into your .env / Render environment variables.
const webpush = require('web-push');
const keys = webpush.generateVAPIDKeys();
console.log('\n🔑 VAPID Keys generated — add these to your environment:\n');
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log(`VAPID_EMAIL=your-email@example.com`);
console.log('\n⚠️  Keep VAPID_PRIVATE_KEY secret. Re-use the same keys after generation.');
