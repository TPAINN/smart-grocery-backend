// scripts/test-trial-reminder.js
// Δοκιμή SMTP + αποστολή δείγματος trial-reminder email.
// Χρήση: node scripts/test-trial-reminder.js you@example.com
require('dotenv').config();
const { sendTrialReminderEmail, verifyEmailConnection } = require('../services/emailService');

(async () => {
  const to = process.argv[2];
  if (!to) { console.error('Usage: node scripts/test-trial-reminder.js <email>'); process.exit(1); }
  try {
    await verifyEmailConnection();
    console.log('✅ SMTP connection OK');
    await sendTrialReminderEmail(to, 'Δοκιμαστικέ', 2);
    console.log(`✅ Trial reminder test email sent to ${to}`);
  } catch (err) {
    console.error('❌ FAILED:', err.message);
    process.exit(1);
  }
  process.exit(0);
})();
