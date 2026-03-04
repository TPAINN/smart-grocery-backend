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
const buildVerificationEmail = (name, verificationUrl) => `
<!DOCTYPE html>
<html lang="el">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Επαλήθευση Email — Smart Hub</title>
</head>
<body style="margin:0;padding:0;background:#0a0a14;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a14;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" style="max-width:520px;background:#13131f;border-radius:20px;border:1px solid rgba(124,58,237,0.25);overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.5);">
          
          <!-- Header gradient bar -->
          <tr>
            <td style="background:linear-gradient(135deg,#7c3aed,#2563eb);height:5px;"></td>
          </tr>

          <!-- Logo & Title -->
          <tr>
            <td align="center" style="padding:40px 40px 24px;">
              <div style="font-size:44px;margin-bottom:12px;">🛒</div>
              <h1 style="margin:0;font-size:26px;font-weight:800;color:#fff;letter-spacing:-0.5px;">Smart Hub</h1>
              <p style="margin:6px 0 0;font-size:13px;color:#7c8db5;letter-spacing:0.5px;text-transform:uppercase;">Επαλήθευση Λογαριασμού</p>
            </td>
          </tr>

          <!-- Divider -->
          <tr><td style="padding:0 40px;"><div style="height:1px;background:rgba(124,58,237,0.15);"></div></td></tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px 40px;">
              <p style="margin:0 0 16px;font-size:16px;color:#c8d0e8;line-height:1.6;">
                Γεια σου <strong style="color:#fff;">${name}</strong>! 👋
              </p>
              <p style="margin:0 0 24px;font-size:15px;color:#8a96b8;line-height:1.7;">
                Καλώς ήρθες στο <strong style="color:#a78bfa;">Smart Hub</strong> — το έξυπνο καλάθι αγορών σου.
                Για να ενεργοποιηθεί ο λογαριασμός σου, επαλήθευσε το email σου με το παρακάτω κουμπί.
              </p>

              <!-- CTA Button -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin:28px 0;">
                <tr>
                  <td align="center">
                    <a href="${verificationUrl}"
                       style="display:inline-block;padding:16px 40px;background:linear-gradient(135deg,#7c3aed,#2563eb);color:#fff;font-size:15px;font-weight:700;text-decoration:none;border-radius:12px;letter-spacing:0.3px;box-shadow:0 8px 24px rgba(124,58,237,0.35);">
                      ✅ Επαλήθευση Email
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Fallback link -->
              <p style="margin:0;font-size:12px;color:#4a5578;line-height:1.6;">
                Αν το κουμπί δεν λειτουργεί, αντέγραψε τον παρακάτω σύνδεσμο:<br/>
                <a href="${verificationUrl}" style="color:#7c3aed;word-break:break-all;font-size:11px;">${verificationUrl}</a>
              </p>

              <!-- Warning box -->
              <div style="margin-top:24px;padding:14px 18px;background:rgba(124,58,237,0.08);border:1px solid rgba(124,58,237,0.2);border-radius:12px;">
                <p style="margin:0;font-size:12px;color:#7c8db5;line-height:1.6;">
                  ⏰ Ο σύνδεσμος λήγει σε <strong style="color:#a78bfa;">24 ώρες</strong>.<br/>
                  🔒 Αν δεν έκανες εγγραφή, αγνόησε αυτό το email.
                </p>
              </div>
            </td>
          </tr>

          <!-- Features strip -->
          <tr>
            <td style="padding:0 40px 28px;">
              <div style="height:1px;background:rgba(124,58,237,0.15);margin-bottom:24px;"></div>
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" width="33%" style="padding:0 4px;">
                    <div style="font-size:22px;margin-bottom:4px;">🔍</div>
                    <p style="margin:0;font-size:11px;color:#4a5578;text-align:center;line-height:1.4;">Σύγκριση Τιμών</p>
                  </td>
                  <td align="center" width="33%" style="padding:0 4px;">
                    <div style="font-size:22px;margin-bottom:4px;">🍽️</div>
                    <p style="margin:0;font-size:11px;color:#4a5578;text-align:center;line-height:1.4;">Συνταγές</p>
                  </td>
                  <td align="center" width="33%" style="padding:0 4px;">
                    <div style="font-size:22px;margin-bottom:4px;">🤝</div>
                    <p style="margin:0;font-size:11px;color:#4a5578;text-align:center;line-height:1.4;">Κοινό Καλάθι</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:rgba(0,0,0,0.3);padding:20px 40px;border-top:1px solid rgba(255,255,255,0.04);">
              <p style="margin:0;font-size:11px;color:#3a4060;text-align:center;line-height:1.6;">
                Smart Hub © ${new Date().getFullYear()} · Αυτό το email στάλθηκε αυτόματα, μην απαντάς.<br/>
                <a href="#" style="color:#3a4060;text-decoration:none;">Πολιτική Απορρήτου</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;

// ─── Already-verified welcome email ──────────────────────────────────────────
const buildWelcomeEmail = (name) => `
<!DOCTYPE html>
<html lang="el">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#0a0a14;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a14;padding:40px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:520px;background:#13131f;border-radius:20px;border:1px solid rgba(16,185,129,0.25);overflow:hidden;">
        <tr><td style="background:linear-gradient(135deg,#059669,#10b981);height:5px;"></td></tr>
        <tr>
          <td align="center" style="padding:40px;">
            <div style="font-size:52px;margin-bottom:16px;">🎉</div>
            <h1 style="margin:0 0 10px;font-size:24px;font-weight:800;color:#fff;">Email Επαληθεύτηκε!</h1>
            <p style="margin:0 0 24px;font-size:15px;color:#8a96b8;line-height:1.7;">
              Γεια σου <strong style="color:#fff;">${name}</strong>!<br/>
              Ο λογαριασμός σου είναι πλέον ενεργός. Καλώς ήρθες στο Smart Hub!
            </p>
            <a href="${process.env.APP_URL || 'https://smart-hub-app.vercel.app'}"
               style="display:inline-block;padding:14px 32px;background:linear-gradient(135deg,#059669,#10b981);color:#fff;font-size:14px;font-weight:700;text-decoration:none;border-radius:12px;">
              🛒 Ξεκίνα Τώρα
            </a>
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
const sendVerificationEmail = async (email, name, token) => {
  const verificationUrl = `${process.env.API_URL || 'https://my-smart-grocery-api.onrender.com'}/api/auth/verify/${token}`;
  await transporter.sendMail({
    from: `"Smart Hub 🛒" <${process.env.SMTP_USER}>`,
    to: email,
    subject: '✅ Επαλήθευση Email — Smart Hub',
    html: buildVerificationEmail(name, verificationUrl),
  });
};

const sendWelcomeEmail = async (email, name) => {
  await transporter.sendMail({
    from: `"Smart Hub 🛒" <${process.env.SMTP_USER}>`,
    to: email,
    subject: '🎉 Καλώς ήρθες στο Smart Hub!',
    html: buildWelcomeEmail(name),
  });
};

const verifyEmailConnection = async () => {
  await transporter.verify();
};

module.exports = { sendVerificationEmail, sendWelcomeEmail, verifyEmailConnection };