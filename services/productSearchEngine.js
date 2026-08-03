// services/productSearchEngine.js
// Greek/English fuzzy product-search engine used by routes/prices.js:
// EN->GR dictionary, greeklish transliteration, phonetic (iotacism) matching,
// and a scoring/ranking function for multi-word queries.
// Extracted from routes/prices.js during tidy-up — logic unchanged.

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

/**
 * Lowercase, strip diacritics (NFD-fold accents), and trim - the canonical
 * form used for all product-name comparisons in this module.
 * @param {string} text
 * @returns {string}
 */
const normalize = (text) =>
  text.toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();

/**
 * Escape a string for safe use inside a RegExp constructor.
 * @param {string} s
 * @returns {string}
 */
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
const PET_MARKERS = /(^|\s)(γατα|γατος|γατων|γατας|σκυλος|σκυλου|σκυλων|κατοικιδι|ζωοτρ|γατοτρ|σκυλοτρ|petshop|pet shop|\bcat\b|\bdog\b)/;

// Αν το query δεν περιέχει pet-related λέξεις, θεωρούμε ότι ψάχνει ανθρώπινα τρόφιμα
const isPetQuery = (q) => /(γατα|γατ |σκυλ|κατοικιδι|ζωοτρ|\bcat\b|\bdog\b)/.test(q);

// Non-grocery / personal-care / household markers. A plain food query must NOT
// surface these (e.g. "λάδι" → lamp/sun/hair oil, "ελαιόλαδο" → body butter,
// hand cream). Skipped when the query ITSELF is one of these terms (so a real
// "σαμπουάν"/"καθαριστικό" search still works).
const NON_FOOD_MARKERS = /(φωτιστικ|λαμπα|λαμπας|παραφιν|καντηλ|κανδηλ|σαμπουαν|αφρολουτρ|αντηλιακ|spf|μαλλι|κρεμα χερ|κρεμα σωμ|κρεμα προσωπ|body butter|body milk|body lotion|lotion|scrub|σκραμπ|μασκα μαλλ|μασκα προσωπ|σερουμ|serum|conditioner|μαλακτικ|σαπουν|καθαριστικ|απορρυπαντ)/;
const isNonFoodQuery = (q) => NON_FOOD_MARKERS.test(q);

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
  // Iota-canonical: η,υ→ι so phonetically identical words compare as equal
  const nameI = greekIotaCanonical(name);
  const qI    = greekIotaCanonical(q);
  const qEsc  = escapeRegex(qI);

  // ── Βασική βαθμολογία (phonetic-aware) ────────────────────────────────────
  let score = 0;
  if (nameI === qI)                                                   score = 100;
  else if (nameI.startsWith(qI + ' '))                               score = 90;
  else if (new RegExp(`(^|\\s)${qEsc}(\\s|$)`).test(nameI))         score = 80;
  else if (new RegExp(`(^|\\s)${qEsc}`).test(nameI))                score = 60;
  else if (nameI.includes(qI))                                       score = 20;

  if (score === 0) return 0;

  // ── Penalty 1: Pet food όταν ψάχνεις ανθρώπινα τρόφιμα ───────────────────
  // Use original name/q (not iota-canonical) — PET_MARKERS use standard Greek spelling
  if (!isPetQuery(q) && PET_MARKERS.test(name)) {
    return Math.round(score * 0.1); // π.χ. 60 → 6
  }

  // ── Penalty 2: Query εμφανίζεται μόνο ως γεύση/άρωμα ─────────────────────
  const flavorIdx = name.search(/(γευση|αρωμα|με γευση|με αρωμα)/);
  if (flavorIdx > 0) {
    const beforeDescriptor = name.substring(0, flavorIdx);
    const queryInMainPart  = new RegExp(`(^|\\s)${escapeRegex(q)}`).test(beforeDescriptor);
    if (!queryInMainPart) {
      return Math.round(score * 0.3);
    }
  }

  // ── Penalty 3: non-grocery product (lamp oil, sunscreen, hair/skin care,
  // cleaning) for a food query — heavy demote so it drops out of food results.
  if (!isNonFoodQuery(q) && NON_FOOD_MARKERS.test(name)) {
    return Math.round(score * 0.05);
  }

  // ── Penalty 4: the query is a preparation/ingredient descriptor, not the
  // head noun — "τόνος σε (φυτικό) λάδι" (q="λάδι"), "μπισκότα με ταχίνι".
  if (!nameI.startsWith(qI) && new RegExp(`(^|\\s)(σε|με|απο)\\s+(\\S+\\s+){0,2}${qEsc}(\\s|$)`).test(nameI)) {
    return Math.round(score * 0.1);
  }

  return score;
}

// Για multi-word queries (π.χ. "φρεσκο γαλα"):
// Κάθε λέξη πρέπει να υπάρχει στο προϊόν — AND logic
/**
 * Score a product name against a multi-word query using AND logic — every
 * term must appear (each scored via the internal phonetic-aware scoreMatch),
 * plus order/prefix bonuses. Returns 0 if any term is missing entirely.
 * @param {string} productName
 * @param {string[]} terms
 * @returns {number}
 */
function scoreMultiWord(productName, terms) {
  const name  = normalize(productName);
  const nameI = greekIotaCanonical(name); // iota-canonical for phonetic bonus checks
  let totalScore = 0;

  for (const term of terms) {
    const s = scoreMatch(productName, term);
    if (s === 0) return 0; // Αν λείπει έστω μια λέξη → αποκλείεται
    totalScore += s;
  }

  // Bonuses — use iota-canonical so "ξύδι" bonuses apply to "ξίδι" products
  const qRaw  = normalize(terms[0]);
  const qI    = greekIotaCanonical(qRaw);
  const qEscI = escapeRegex(qI);

  if (!isIrrelevantProduct(name, qRaw, escapeRegex(qRaw))) {
    // Bonus: αν η σειρά των λέξεων ταιριάζει (iota-canonical)
    const queryStr = terms
      .map(t => escapeRegex(greekIotaCanonical(normalize(t))))
      .join('.*');
    if (new RegExp(queryStr).test(nameI)) totalScore += 10;

    // Bonus: αν το όνομα ΑΡΧΙΖΕΙ με την πρώτη λέξη του query
    // "Κοτόπουλο φρέσκο" για query "κοτόπουλο" → +20
    if (new RegExp(`^${qEscI}`).test(nameI)) totalScore += 20;
  }

  return totalScore;
}


// ── Greek phonetic normalization (iotacism) ──────────────────────────────────
// In modern Greek, η (eta), ι (iota), υ (upsilon) are ALL pronounced like "i".
// This is called iotacism. Users may type any of these where the product DB uses another.
//
//  Examples:
//    User types "ξύδι"  → norm "ξυδι"  ← DB stores "ξίδι"  → norm "ξιδι"  [υ vs ι]
//    User types "ζαχαρι" → norm "ζαχαρι" ← DB stores "ζάχαρη" → norm "ζαχαρη" [ι vs η]
//
// greekIotaCanonical: fold η,υ → ι for SCORING (both sides normalized → same string)
// buildPhoneticRegex: [ηιυ] char-class for DB QUERIES (ONE regex matches all 3 variants)

function greekIotaCanonical(normalizedText) {
  return normalizedText.replace(/[ηυ]/g, 'ι');
}

/**
 * Build a regex source string that matches all iotacism spelling variants
 * (η/ι/υ, all pronounced "i" in modern Greek) for a normalized search term.
 * Used for MongoDB $regex queries so a single query matches all 3 spellings.
 * @param {string} normalizedTerm - already passed through normalize()
 * @returns {string} regex source (not a RegExp instance)
 */
function buildPhoneticRegex(normalizedTerm) {
  // Replace each η/ι/υ with [ηιυ] so the regex matches all phonetic spellings at once
  return normalizedTerm.split('').map(c => {
    if ('ηιυ'.includes(c)) return '[ηιυ]';
    return escapeRegex(c);
  }).join('');
}

// ── Build all search term variants from a raw query ───────────────────────────
/**
 * Build the ordered list of search-term-array variants to try for a raw
 * query: EN->GR dictionary translation, greeklish transliteration, then the
 * normalized original terms. Callers try each variant in order until one
 * yields results.
 * @param {string} rawQuery
 * @returns {string[][]} list of term arrays, most specific first
 */
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
    variants.push(enTranslation.split(/\s+/).filter(t => t.length > 1));
  }

  if (greeklishResult && greeklishResult !== norm) {
    variants.push(greeklishResult.split(/\s+/).filter(t => t.length > 1));
  }

  // Always include the normalized original terms.
  // buildPhoneticRegex() in the DB query handles η/ι/υ matching bidirectionally.
  const originalTerms = norm.split(/\s+/).filter(t => t.length > 1);
  variants.push(originalTerms);

  return variants;
}

module.exports = {
  EN_TO_GR,
  normalize,
  escapeRegex,
  scoreMultiWord,
  buildPhoneticRegex,
  expandQuery,
};
