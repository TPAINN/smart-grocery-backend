// routes/prices.js — Smart Search Engine v3 (EN+GR, transliteration, fuzzy)
const express = require('express');
const router  = express.Router();
const Product = require('../models/Product');

// ── English → Greek food dictionary ──────────────────────────────────────────
const EN_TO_GR = {
  // Proteins
  chicken:'κοτοπουλο', 'chicken breast':'κοτοπουλο στηθος', turkey:'γαλοπουλα',
  beef:'μοσχαρι', pork:'χοιρινο', lamb:'αρνι', fish:'ψαρι', salmon:'σολομος',
  tuna:'τονος', shrimp:'γαριδα', egg:'αυγο', eggs:'αυγα', bacon:'μπεικον',
  ham:'ζαμπον', sausage:'λουκανικο',
  // Dairy
  milk:'γαλα', cheese:'τυρι', feta:'φετα', yogurt:'γιαουρτι', yoghurt:'γιαουρτι',
  butter:'βουτυρο', cream:'κρεμα', 'sour cream':'ξινη κρεμα',
  // Vegetables
  tomato:'ντοματα', onion:'κρεμμυδι', garlic:'σκορδο', potato:'πατατα',
  carrot:'καροτο', pepper:'πιπερια', cucumber:'αγγουρι', lettuce:'μαρουλι',
  spinach:'σπανακι', broccoli:'μπροκολο', zucchini:'κολοκυθακι',
  eggplant:'μελιτζανα', mushroom:'μανιταρι', corn:'καλαμποκι',
  pea:'μπιζελι', bean:'φασολι', beans:'φασολια', lentils:'φακες', lentil:'φακες',
  chickpea:'ρεβιθι', chickpeas:'ρεβιθια',
  // Fruits
  apple:'μηλο', orange:'πορτοκαλι', banana:'μπανανα', grape:'σταφυλι',
  lemon:'λεμονι', strawberry:'φραουλα', watermelon:'καρπουζι', peach:'ροδακινο',
  // Grains / carbs
  bread:'ψωμι', rice:'ρυζι', pasta:'ζυμαρικα', spaghetti:'σπαγγετι',
  flour:'αλευρι', oats:'βρωμη', oat:'βρωμη', cereal:'δημητριακα',
  // Oils / fats
  oil:'λαδι', 'olive oil':'ελαιολαδο', 'sunflower oil':'ηλιελαιο',
  // Condiments / spices
  salt:'αλατι', pepper:'πιπερι', sugar:'ζαχαρη', honey:'μελι', vinegar:'ξιδι',
  ketchup:'κετσαπ', mustard:'μουσταρδα', mayonnaise:'μαγιονεζα',
  // Beverages
  water:'νερο', juice:'χυμος', coffee:'καφες', tea:'τσαι', beer:'μπυρα',
  wine:'κρασι', milk:'γαλα',
  // Snacks / sweets
  chocolate:'σοκολατα', cookie:'μπισκοτο', chips:'πατατακια', nuts:'ξηροι καρποι',
  almond:'αμυγδαλο', almonds:'αμυγδαλα', walnut:'καρυδι', walnuts:'καρυδια',
};

// ── Greeklish → Greek transliteration map ────────────────────────────────────
// Handles romanized Greek (e.g. "gala" → "γαλα", "kotopoulo" → "κοτοπουλο")
const GREEKLISH_MAP = {
  // Letters
  'th':'θ','ou':'ου','ks':'ξ','ps':'ψ','ch':'χ','ph':'φ','gh':'γ',
  'ai':'αι','ei':'ει','oi':'οι','au':'αυ','eu':'ευ',
  'a':'α','b':'β','g':'γ','d':'δ','e':'ε','z':'ζ','h':'η','i':'ι',
  'k':'κ','l':'λ','m':'μ','n':'ν','x':'ξ','o':'ο','p':'π','r':'ρ',
  's':'σ','t':'τ','u':'υ','f':'φ','y':'υ','w':'ω','v':'β','c':'κ','q':'κ',
};

function greeklishToGreek(text) {
  // Only attempt if text is clearly Latin (no Greek chars)
  if (/[α-ωΑ-Ω]/.test(text)) return null;
  let result = text.toLowerCase();
  // Apply multi-char mappings first, then single-char
  const multiChar = ['th','ou','ks','ps','ch','ph','gh','ai','ei','oi','au','eu'];
  for (const mc of multiChar) result = result.split(mc).join(GREEKLISH_MAP[mc]);
  for (const [k, v] of Object.entries(GREEKLISH_MAP)) {
    if (k.length === 1) result = result.split(k).join(v);
  }
  return result;
}

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

// ── Build all search term variants from a raw query ───────────────────────────
function expandQuery(rawQuery) {
  const norm = normalize(rawQuery);

  // Check EN→GR dictionary (longest match first)
  const lower = rawQuery.toLowerCase().trim();
  const enTranslation = EN_TO_GR[lower] || null;

  // Try greeklish transliteration
  const greeklishResult = greeklishToGreek(lower);

  // Collect all unique term sets to try (in priority order)
  const variants = [];

  if (enTranslation) {
    // Full EN phrase → GR translation
    variants.push(enTranslation.split(/\s+/).filter(t => t.length > 1));
  }

  if (greeklishResult && greeklishResult !== norm) {
    variants.push(greeklishResult.split(/\s+/).filter(t => t.length > 1));
  }

  // Always include the normalized original terms
  const originalTerms = norm.split(/\s+/).filter(t => t.length > 1);
  variants.push(originalTerms);

  return variants;
}

// ── GET /search — Smart Search ────────────────────────────────────────────────
router.get('/search', async (req, res) => {
  try {
    const rawQuery = (req.query.q || '').trim();
    const store    = req.query.store;

    if (rawQuery.length < 2) return res.json([]);

    const storeFilter = (store && store !== 'Όλα') ? { supermarket: store } : {};

    const termVariants = expandQuery(rawQuery);
    const seenIds = new Set();
    let allCandidates = [];

    // Try each term variant: AND query per variant
    for (const terms of termVariants) {
      if (!terms.length) continue;

      const regexFilters = terms.map(term => ({
        normalizedName: { $regex: escapeRegex(term), $options: 'i' }
      }));

      const candidates = await Product.find({ $and: regexFilters, ...storeFilter })
        .sort({ price: 1 })
        .limit(100)
        .lean();

      for (const c of candidates) {
        if (!seenIds.has(c._id.toString())) {
          seenIds.add(c._id.toString());
          allCandidates.push({ ...c, _terms: terms });
        }
      }
    }

    // If AND found nothing, try OR fallback with original terms
    if (allCandidates.length === 0) {
      const originalTerms = normalize(rawQuery).split(/\s+/).filter(t => t.length > 1);
      if (originalTerms.length > 1) {
        const orFilters = originalTerms.map(term => ({
          normalizedName: { $regex: escapeRegex(term), $options: 'i' }
        }));
        const fallback = await Product.find({ $or: orFilters, ...storeFilter })
          .sort({ price: 1 })
          .limit(100)
          .lean();
        for (const c of fallback) {
          if (!seenIds.has(c._id.toString())) {
            seenIds.add(c._id.toString());
            allCandidates.push({ ...c, _terms: originalTerms });
          }
        }
      }
    }

    // Score and rank
    const scored = allCandidates
      .map(p => ({ ...p, _score: scoreMultiWord(p.name, p._terms || [normalize(rawQuery)]) }))
      .filter(p => p._score > 5)
      .sort((a, b) => b._score !== a._score ? b._score - a._score : (a.price || 0) - (b.price || 0))
      .slice(0, 20);

    res.json(scored.map(({ _score, _terms, ...p }) => p));
  } catch (error) {
    console.error('Σφάλμα στην Αναζήτηση:', error);
    res.status(500).json({ message: 'Σφάλμα διακομιστή' });
  }
});

module.exports = router;