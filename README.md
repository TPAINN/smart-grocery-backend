<div align="center">

# 🛒 Smart Grocery API

Backend για το **[Καλαθάκι](https://github.com/TPAINN/smart-grocery-frontend)** — τιμές από 8 ελληνικά σούπερ μάρκετ, AI διατροφή, real-time κοινό καλάθι.

[![Node](https://img.shields.io/badge/Node.js-Express%205-339933?logo=nodedotjs&logoColor=white)](https://expressjs.com)
[![MongoDB](https://img.shields.io/badge/MongoDB-Mongoose%209-47A248?logo=mongodb&logoColor=white)](https://mongoosejs.com)
[![Puppeteer](https://img.shields.io/badge/Puppeteer-scrapers-40B5A4?logo=puppeteer&logoColor=white)](https://pptr.dev)
[![Socket.IO](https://img.shields.io/badge/Socket.IO-realtime-010101?logo=socketdotio&logoColor=white)](https://socket.io)

</div>

---

## 🧩 Τι κάνει

- **Scrapers** (Puppeteer + stealth) για Lidl, ΑΒ, Σκλαβενίτη, MyMarket, Μασούτη, Κρητικό, Γαλαξία, Market In — καθημερινό cron + GitHub Actions
- **Greek-aware search** — NFD normalization, υ/ι folding, scoring
- **AI provider chain** — Claude → Gemini → Groq → Bytez με rate tracking & graceful fallback (meal plans, ανάλυση πιάτου, μεταφράσεις)
- **Auth** — JWT (30d), bcrypt, email verification, 14 μέρες δωρεάν trial με αυτόματο reminder email πριν τη λήξη
- **Real-time** — Socket.IO κοινό καλάθι ανά shareKey, friends, chat
- **Push** — web-push notifications

## 🚏 API (κύριες διαδρομές)

| Route | Τι κάνει |
|---|---|
| `POST /api/auth/register` · `login` | JWT auth, αυτόματο 14-day trial |
| `GET  /api/prices?query=` | Αναζήτηση τιμών με ελληνικό normalization |
| `GET  /api/recipes` | 1.200+ συνταγές με macros |
| `GET/POST /api/favorites` | Αγαπημένες συνταγές |
| `GET/POST /api/lists` | Αποθηκευμένες λίστες (2 free / 10 premium) |
| `POST /api/mealplan` | AI εβδομαδιαίο πλάνο (premium/trial) |
| `POST /api/platescanner/*` | AI ανάλυση πιάτου (φωτο ή κείμενο) |
| `GET  /api/barcode/:code` | Στοιχεία προϊόντος από barcode |

## 🚀 Setup

```bash
npm install
cp .env.example .env   # συμπλήρωσε τα secrets
npm start              # http://localhost:5000
```

Χρήσιμα scripts:

```bash
npm run scrape:local           # όλοι οι scrapers, headed Chrome
npm run scrape:local:lidl      # ένας scraper
npm run test:scraping          # regression tests scrapers
node scripts/test-trial-reminder.js you@mail.com  # δοκιμή SMTP/reminder email
```

## ⚙️ Environment

Όλα τα secrets στο `.env` (**ποτέ** στο git — δες `.env.example`). Κύρια:

`MONGO_URI` · `JWT_SECRET` · `ANTHROPIC_API_KEY` (κύριος AI provider) · `GEMINI_API_KEY` · `GROQ_API_KEY` · `SMTP_*` (Gmail app password) · `ALLOWED_ORIGINS`

## 🔒 Ασφάλεια

- Rate limiting (auth: 10/15min), CORS allowlist, security headers
- Admin endpoints: `x-admin-secret` header με constant-time σύγκριση
- bcrypt(10) passwords, JWT 30d expiry
- AI endpoints πίσω από auth + premium gate

## ☁️ Deploy

Render (web service + `render.yaml` Blueprint). Scrapers τρέχουν και από GitHub Actions (καθημερινά 08:00 Ελλάδας). Cron in-process: scraper 08:20, trial reminders 10:00.

---

<div align="center">Made with ❤️ in Greece</div>
