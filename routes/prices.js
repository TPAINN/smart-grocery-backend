// routes/prices.js — Smart Search Engine v2
const express = require('express');
const router  = express.Router();
const Product = require('../models/Product');

// ── Helpers ───────────────────────────────────────────────────────────────────

const normalize = (text) =>
  text.toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ── Scoring Engine ────────────────────────────────────────────────────────────
// Όσο ΜΕΓΑΛΥΤΕΡΟ το score, τόσο πιο σχετικό το αποτέλεσμα
//
//  100 — Ακριβής αντιστοιχία          "γαλα" === "γαλα"
//   90 — Ξεκινάει ακριβώς με query    "γαλα φρεσκο" startsWith "γαλα "
//   80 — Query είναι ολόκληρη λέξη    "...γαλα..." ως ανεξάρτητη λέξη
//   60 — Query ξεκινάει λέξη          "γαλακτ..." αλλά δεν τελειώνει εκεί
//   20 — Query βρίσκεται οπουδήποτε   "σοκοφρετα γαλακτος" contains "γαλα"
//    0 — Καμία σχέση (δεν επιστρέφεται)

function scoreMatch(productName, query) {
  const name  = normalize(productName);
  const q     = normalize(query);
  const qEsc  = escapeRegex(q);

  // 100: Exact match
  if (name === q) return 100;

  // 90: Ξεκινάει με query + κενό (π.χ. "γαλα φρεσκο")
  if (name.startsWith(q + ' ')) return 90;

  // 80: Query εμφανίζεται ως ολόκληρη λέξη (word boundary και στις 2 πλευρές)
  if (new RegExp(`(^|\\s)${qEsc}(\\s|$)`).test(name)) return 80;

  // 60: Query ξεκινάει κάποια λέξη (π.χ. "κοτοπ" → "κοτοπουλο")
  if (new RegExp(`(^|\\s)${qEsc}`).test(name)) return 60;

  // 20: Query εμφανίζεται οπουδήποτε ως substring (χαμηλή προτεραιότητα)
  if (name.includes(q)) return 20;

  return 0;
}

// Για multi-word queries (π.χ. "φρεσκο γαλα"):
// Κάθε λέξη πρέπει να υπάρχει στο προϊόν — AND logic
function scoreMultiWord(productName, terms) {
  const name = normalize(productName);
  let totalScore = 0;

  for (const term of terms) {
    const s = scoreMatch(productName, term);
    if (s === 0) return 0; // Αν λείπει έστω μια λέξη → αποκλείεται
    totalScore += s;
  }

  // Bonus: αν η σειρά των λέξεων ταιριάζει
  const queryStr = terms.map(escapeRegex).join('.*');
  if (new RegExp(queryStr).test(name)) totalScore += 10;

  return totalScore;
}

// ── GET / — Pagination ────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 50);
    const products = await Product.find({})
      .sort({ dateScraped: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();
    const total = await Product.countDocuments();
    res.json({ products, total, page, pages: Math.ceil(total / limit) });
  } catch (error) {
    res.status(500).json({ message: 'Σφάλμα ανάκτησης προϊόντων' });
  }
});

// ── GET /search — Smart Search ────────────────────────────────────────────────
router.get('/search', async (req, res) => {
  try {
    const rawQuery = (req.query.q || '').trim();
    const store    = req.query.store;

    if (rawQuery.length < 2) return res.json([]);

    const normalizedQuery = normalize(rawQuery);
    const terms = normalizedQuery.split(/\s+/).filter(t => t.length > 1);

    if (terms.length === 0) return res.json([]);

    // ── Βήμα 1: Φέρε candidates από MongoDB ──────────────────────────────────
    // Κάνε AND: κάθε term πρέπει να υπάρχει στο normalizedName
    const regexFilters = terms.map(term => ({
      normalizedName: { $regex: escapeRegex(term), $options: 'i' }
    }));

    const dbQuery = { $and: regexFilters };
    if (store && store !== 'Όλα') dbQuery.supermarket = store;

    // Φέρνουμε περισσότερα (100) για να κάνουμε re-rank στη μνήμη
    const candidates = await Product.find(dbQuery)
      .sort({ price: 1 })
      .limit(100)
      .lean();

    // ── Βήμα 2: Βαθμολόγησε + ταξινόμησε ────────────────────────────────────
    const scored = candidates
      .map(p => ({
        ...p,
        _score: scoreMultiWord(p.name, terms),
      }))
      .filter(p => p._score > 0)
      .sort((a, b) => {
        // Πρώτα score (φθίνουσα), μετά τιμή (αύξουσα)
        if (b._score !== a._score) return b._score - a._score;
        return (a.price || 0) - (b.price || 0);
      })
      .slice(0, 20); // Επέστρεψε τα 20 καλύτερα

    // Αφαίρεσε το _score από το response
    const results = scored.map(({ _score, ...p }) => p);

    res.json(results);
  } catch (error) {
    console.error('Σφάλμα στην Αναζήτηση:', error);
    res.status(500).json({ message: 'Σφάλμα διακομιστή' });
  }
});

module.exports = router;