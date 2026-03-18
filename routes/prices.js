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
//
// Penalties:
//    ×0.1 — Pet food όταν query δεν αφορά κατοικίδια
//    ×0.3 — Match μόνο ως "γεύση X" / descriptor (π.χ. "τροφή γάτας με γεύση κοτόπουλου")

// Λέξεις που υποδηλώνουν ότι το προϊόν είναι για κατοικίδια
const PET_MARKERS = /(^|\s)(γατα|γατος|γατων|γατας|σκυλος|σκυλου|σκυλων|κατοικιδι|ζωοτρ|petshop|pet shop|\bcat\b|\bdog\b)/;

// Αν το query δεν περιέχει pet-related λέξεις, θεωρούμε ότι ψάχνει ανθρώπινα τρόφιμα
const isPetQuery = (q) => /(γατα|γατ |σκυλ|κατοικιδι|ζωοτρ|\bcat\b|\bdog\b)/.test(q);

// Ελέγχει αν το προϊόν έχει penalty (pet food ή flavor-only descriptor)
function isIrrelevantProduct(name, q, qEsc) {
  if (!isPetQuery(q) && PET_MARKERS.test(name)) return true;
  const flavorIdx = name.search(/(γευση|αρωμα|με γευση|με αρωμα)/);
  if (flavorIdx > 0) {
    const beforeDescriptor = name.substring(0, flavorIdx);
    if (!new RegExp(`(^|\\s)${qEsc}`).test(beforeDescriptor)) return true;
  }
  return false;
}

function scoreMatch(productName, query) {
  const name  = normalize(productName);
  const q     = normalize(query);
  const qEsc  = escapeRegex(q);

  // ── Βασική βαθμολογία ─────────────────────────────────────────────────────
  let score = 0;
  if (name === q)                                                    score = 100;
  else if (name.startsWith(q + ' '))                                 score = 90;
  else if (new RegExp(`(^|\\s)${qEsc}(\\s|$)`).test(name))          score = 80;
  else if (new RegExp(`(^|\\s)${qEsc}`).test(name))                 score = 60;
  else if (name.includes(q))                                         score = 20;

  if (score === 0) return 0;

  // ── Penalty 1: Pet food όταν ψάχνεις ανθρώπινα τρόφιμα ───────────────────
  // "Τροφή σκύλου κοτόπουλο" → query "κοτόπουλο" → score × 0.1
  if (!isPetQuery(q) && PET_MARKERS.test(name)) {
    return Math.round(score * 0.1); // π.χ. 60 → 6
  }

  // ── Penalty 2: Query εμφανίζεται μόνο ως γεύση/άρωμα ─────────────────────
  // "Τροφή γάτας με γεύση κοτόπουλου" → query "κοτόπουλο" → score × 0.3
  const flavorIdx = name.search(/(γευση|αρωμα|με γευση|με αρωμα)/);
  if (flavorIdx > 0) {
    const beforeDescriptor = name.substring(0, flavorIdx);
    const queryInMainPart  = new RegExp(`(^|\\s)${qEsc}`).test(beforeDescriptor);
    if (!queryInMainPart) {
      return Math.round(score * 0.3); // π.χ. 60 → 18
    }
  }

  return score;
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

  // Bonuses μόνο για σχετικά προϊόντα (όχι pet food / flavor-only descriptors)
  const q = terms[0];
  const qEsc = escapeRegex(q);
  if (!isIrrelevantProduct(name, q, qEsc)) {
    // Bonus: αν η σειρά των λέξεων ταιριάζει
    const queryStr = terms.map(escapeRegex).join('.*');
    if (new RegExp(queryStr).test(name)) totalScore += 10;

    // Bonus: αν το όνομα ΑΡΧΙΖΕΙ με την πρώτη λέξη του query
    // "Κοτόπουλο φρέσκο" για query "κοτόπουλο" → +20
    const firstTermEsc = escapeRegex(normalize(terms[0]));
    if (new RegExp(`^${firstTermEsc}`).test(name)) totalScore += 20;
  }

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
      .filter(p => p._score > 10)
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