// services/emailService.js
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// ─── Beautiful HTML email template ───────────────────────────────────────────

// ─── Already-verified welcome email ──────────────────────────────────────────

// ─── Trial ending reminder ────────────────────────────────────────────────────
// Στέλνεται ~2 μέρες πριν λήξει το δωρεάν trial. Υπόσχεση του paywall timeline
// («θα σου στείλουμε υπενθύμιση») — transparency, όχι παγίδα.
const buildTrialReminderEmail = (name, daysLeft, appUrl) => `
<!DOCTYPE html>
<html lang="el">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#0a0a14;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a14;padding:40px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:520px;background:#13131f;border-radius:20px;border:1px solid rgba(124,58,237,0.25);overflow:hidden;">
        <tr><td style="background:linear-gradient(135deg,#7c3aed,#2563eb);height:5px;"></td></tr>
        <tr>
          <td align="center" style="padding:40px 40px 8px;">
            <div style="font-size:48px;margin-bottom:12px;">⏰</div>
            <h1 style="margin:0 0 10px;font-size:24px;font-weight:800;color:#fff;">Η δοκιμή σου τελειώνει σε ${daysLeft} ${daysLeft === 1 ? 'μέρα' : 'μέρες'}</h1>
            <p style="margin:0 0 8px;font-size:15px;color:#8a96b8;line-height:1.7;">
              Γεια σου <strong style="color:#fff;">${name}</strong>! Όπως υποσχεθήκαμε, να η υπενθύμισή σου —
              χωρίς εκπλήξεις και χωρίς αυτόματες χρεώσεις.
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:8px 40px 8px;">
            <div style="padding:14px 18px;background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.2);border-radius:12px;">
              <p style="margin:0;font-size:13px;color:#8a96b8;line-height:1.7;">
                ✅ <strong style="color:#10b981;">Δεν χρειάζεται να κάνεις τίποτα.</strong>
                Αν δεν αναβαθμίσεις, ο λογαριασμός σου απλώς γυρνάει στο δωρεάν πλάνο —
                οι λίστες σου μένουν ασφαλείς.
              </p>
            </div>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:24px 40px 40px;">
            <a href="${appUrl}"
               style="display:inline-block;padding:15px 36px;background:linear-gradient(135deg,#7c3aed,#2563eb);color:#fff;font-size:14px;font-weight:700;text-decoration:none;border-radius:12px;box-shadow:0 8px 24px rgba(124,58,237,0.35);">
              Συνεχίζω με Premium
            </a>
            <p style="margin:14px 0 0;font-size:12px;color:#4a5578;">Από 0,99€/μήνα · Ακύρωση όποτε θες</p>
          </td>
        </tr>
        <tr><td style="background:rgba(0,0,0,0.3);padding:16px;border-top:1px solid rgba(255,255,255,0.04);">
          <p style="margin:0;font-size:11px;color:#3a4060;text-align:center;">Smart Hub © ${new Date().getFullYear()}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
`;

// ─── Exports ──────────────────────────────────────────────────────────────────
const sendTrialReminderEmail = async (email, name, daysLeft) => {
  const appUrl = process.env.APP_URL || 'https://smart-hub-app.vercel.app';
  await transporter.sendMail({
    from: `"Smart Hub 🛒" <${process.env.SMTP_USER}>`,
    to: email,
    subject: `⏰ Η δωρεάν δοκιμή σου τελειώνει σε ${daysLeft} ${daysLeft === 1 ? 'μέρα' : 'μέρες'}`,
    html: buildTrialReminderEmail(name, daysLeft, appUrl),
  });
};

const verifyEmailConnection = async () => {
  await transporter.verify();
};

module.exports = { sendTrialReminderEmail, verifyEmailConnection };