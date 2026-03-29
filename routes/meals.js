// routes/meals.js
// TheMealDB proxy — truly free, no rate-limit documented, open crowd-sourced DB.
// $2/month Patreon gives unlimited production access when needed.
// We proxy instead of calling direct so we can cache, normalise, and
// add a simple in-memory TTL cache to avoid hammering their servers.
// All content is translated to Greek using static dictionaries + MyMemory API.

const express = require('express');
const router  = express.Router();
const axios   = require('axios');

const BASE = 'https://www.themealdb.com/api/json/v1/1';

// In-memory TTL cache
const cache      = new Map();
const CACHE_TTL  = 30 * 60 * 1000;  // 30 min for raw data
const TR_TTL     = 6  * 60 * 60 * 1000; // 6 h for translated results

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > entry.ttl) { cache.delete(key); return null; }
  return entry.data;
}
function cacheSet(key, data, ttl = CACHE_TTL) {
  cache.set(key, { data, ts: Date.now(), ttl });
}

// ── Greek translation dictionaries ────────────────────────────────────────────

const CATEGORY_GR = {
  'Beef': 'Μοσχάρι', 'Chicken': 'Κοτόπουλο', 'Dessert': 'Γλυκό',
  'Lamb': 'Αρνί', 'Pork': 'Χοιρινό', 'Seafood': 'Θαλασσινά',
  'Vegetarian': 'Χορτοφαγικό', 'Pasta': 'Ζυμαρικά', 'Side': 'Συνοδευτικό',
  'Starter': 'Ορεκτικό', 'Vegan': 'Vegan', 'Miscellaneous': 'Διάφορα',
  'Breakfast': 'Πρωινό', 'Goat': 'Κατσίκι',
};

const AREA_GR = {
  'Greek': 'Ελληνική', 'Italian': 'Ιταλική', 'Spanish': 'Ισπανική',
  'Turkish': 'Τουρκική', 'Moroccan': 'Μαροκινή', 'French': 'Γαλλική',
  'British': 'Βρετανική', 'American': 'Αμερικανική', 'Chinese': 'Κινέζικη',
  'Indian': 'Ινδική', 'Japanese': 'Ιαπωνική', 'Mexican': 'Μεξικανική',
  'Thai': 'Ταϊλανδέζικη', 'Vietnamese': 'Βιετναμέζικη', 'Jamaican': 'Τζαμαϊκανή',
  'Croatian': 'Κροατική', 'Dutch': 'Ολλανδική', 'Egyptian': 'Αιγυπτιακή',
  'Filipino': 'Φιλιππινέζικη', 'Irish': 'Ιρλανδική', 'Kenyan': 'Κενυατική',
  'Malaysian': 'Μαλαισιανή', 'Polish': 'Πολωνική', 'Portuguese': 'Πορτογαλική',
  'Russian': 'Ρωσική', 'Tunisian': 'Τυνησιακή', 'Unknown': 'Άγνωστη',
};

const MEAL_NAMES_GR = {
  // Greek
  'Moussaka': 'Μουσακάς',
  'Spanakopita': 'Σπανακόπιτα',
  'Garides Saganaki': 'Γαρίδες Σαγανάκι',
  'Gigantes Plaki': 'Γίγαντες Πλακί',
  'Chicken Quinoa Greek Salad': 'Ελληνική Σαλάτα Κοτόπουλου Κινόα',
  'Greek Beef Stew': 'Στιφάδο Μοσχαριού',
  'Greek Lemon Chicken Soup': 'Αβγολέμονο',
  'Grilled Pork Sausages': 'Λουκάνικα Σχάρας',
  'Greek Salad': 'Χωριάτικη Σαλάτα',
  'Stifado': 'Στιφάδο',
  'Loukoumades': 'Λουκουμάδες',
  'Pastitsio': 'Παστίτσιο',
  'Tiropita': 'Τυρόπιτα',
  'Baklava': 'Μπακλαβάς',
  'Tzatziki': 'Τζατζίκι',
  'Revithokeftedes': 'Ρεβιθοκεφτέδες',
  'Briam': 'Μπριάμ',
  'Souvlaki': 'Σουβλάκι',
  'Loukaniko': 'Λουκάνικο',
  'Keftedes': 'Κεφτέδες',
  'Horiatiki': 'Χωριάτικη',
  'Fasolada': 'Φασολάδα',
  'Taramosalata': 'Ταραμοσαλάτα',
  'Avgolemono': 'Αβγολέμονο',
  // Italian
  'Spaghetti Bolognese': 'Σπαγγέτι Μπολονέζ',
  'Spaghetti Carbonara': 'Σπαγγέτι Καρμπονάρα',
  'Margherita Pizza': 'Πίτσα Μαργαρίτα',
  'Risotto Milanese': 'Ριζότο Μιλανέζε',
  'Penne Arrabiata': 'Πέννε Αραμπιάτα',
  'Tiramisu': 'Τιραμισού',
  'Ossobuco alla Milanese': 'Οσομπούκο Μιλανέζε',
  'Chicken Milanese': 'Κοτόπουλο Μιλανέζε',
  'Lasagne': 'Λαζάνια',
  'Pappardelle alla Bolognese': 'Παπαρδέλε Μπολονέζ',
  'Pizza Express Margherita': 'Πίτσα Μαργαρίτα',
  // Spanish
  'Paella de Marisco': 'Παέλια Θαλασσινών',
  'Gazpacho': 'Γκαζπάτσο',
  'Spanish Omelette': 'Ισπανική Ομελέτα (Τορτίγια)',
  'Tortilla de Patatas': 'Τορτίγια Πατάτας',
  // Turkish
  'Turkish Meatballs': 'Τουρκικοί Κεφτέδες',
  'Turkish Scrambled Eggs': 'Τουρκικά Αυγά',
  'Kebab': 'Κεμπάπ',
  'Adana kebab': 'Κεμπάπ Αντάνα',
  'Mansaf': 'Μανσάφ',
  // Moroccan
  'Chicken Tagine': 'Κοτόπουλο Ταζίν',
  'Moroccan Lamb': 'Μαροκινό Αρνί',
  'Couscous': 'Κους-Κους',
  'Lamb Tagine': 'Αρνίσιο Ταζίν',
};

// Common ingredient word replacements (longest-first to avoid partial matches)
const ING_WORDS_GR = [
  ['olive oil',          'ελαιόλαδο'],
  ['tomato paste',       'πελτές ντομάτας'],
  ['tomato puree',       'πουρέ ντομάτας'],
  ['red wine',           'κόκκινο κρασί'],
  ['white wine',         'λευκό κρασί'],
  ['butter beans',       'βούτυρο φασόλια'],
  ['kidney beans',       'κόκκινα φασόλια'],
  ['chickpeas',          'ρεβίθια'],
  ['dried oregano',      'αποξηραμένη ρίγανη'],
  ['chopped parsley',    'ψιλοκομμένος μαϊντανός'],
  ['garlic clove',       'σκελίδα σκόρδου'],
  ['garlic cloves',      'σκελίδες σκόρδου'],
  ['ground beef',        'κιμάς μοσχαριού'],
  ['ground lamb',        'κιμάς αρνιού'],
  ['ground cinnamon',    'κανέλα σκόνη'],
  ['ground cumin',       'κύμινο σκόνη'],
  ['black pepper',       'μαύρο πιπέρι'],
  ['olive oil',          'ελαιόλαδο'],
  ['lemon juice',        'χυμός λεμονιού'],
  ['chicken breast',     'στήθος κοτόπουλου'],
  ['chicken thigh',      'μπούτι κοτόπουλου'],
  ['chicken stock',      'ζωμός κοτόπουλου'],
  ['beef stock',         'ζωμός μοσχαριού'],
  ['vegetable stock',    'ζωμός λαχανικών'],
  ['feta cheese',        'τυρί φέτα'],
  ['cheddar cheese',     'τυρί τσένταρ'],
  ['parmesan cheese',    'τυρί παρμεζάνα'],
  ['cream cheese',       'τυρί κρέμα'],
  ['sour cream',         'ξινή κρέμα'],
  ['heavy cream',        'κρέμα γάλακτος'],
  ['double cream',       'κρέμα γάλακτος'],
  ['natural yogurt',     'φυσικό γιαούρτι'],
  ['greek yogurt',       'ελληνικό γιαούρτι'],
  ['plain flour',        'αλεύρι μαλακό'],
  ['self-raising flour', 'αλεύρι με μπέικιν'],
  ['baking powder',      'μπέικιν πάουντερ'],
  ['bread crumbs',       'τριμμένη φρυγανιά'],
  ['breadcrumbs',        'τριμμένη φρυγανιά'],
  ['pine nuts',          'κουκουνάρια'],
  ['bay leaves',         'φύλλα δάφνης'],
  ['bay leaf',           'φύλλο δάφνης'],
  ['lamb chops',         'παϊδάκια αρνιού'],
  ['lamb mince',         'κιμάς αρνιού'],
  ['spring onion',       'φρέσκο κρεμμύδι'],
  ['spring onions',      'φρέσκα κρεμμύδια'],
  ['red onion',          'κόκκινο κρεμμύδι'],
  ['yellow onion',       'κίτρινο κρεμμύδι'],
  ['cherry tomatoes',    'ντοματίνια'],
  ['sun-dried tomatoes', 'αποξηραμένες ντομάτες'],
  ['beef mince',         'κιμάς μοσχαριού'],
  ['pork mince',         'κιμάς χοιρινού'],
  ['minced beef',        'κιμάς μοσχαριού'],
  ['minced lamb',        'κιμάς αρνιού'],
  ['minced pork',        'κιμάς χοιρινού'],
  ['canned tomatoes',    'κονσέρβα ντομάτας'],
  ['tinned tomatoes',    'κονσέρβα ντομάτας'],
  ['kalamata olives',    'ελιές καλαμάτας'],
  ['black olives',       'μαύρες ελιές'],
  ['green olives',       'πράσινες ελιές'],
  ['capers',             'κάπαρη'],
  ['anchovies',          'αντζούγιες'],
  ['olive oil',          'ελαιόλαδο'],
  // Single words
  ['tomatoes',           'ντομάτες'],
  ['tomato',             'ντομάτα'],
  ['onions',             'κρεμμύδια'],
  ['onion',              'κρεμμύδι'],
  ['garlic',             'σκόρδο'],
  ['potatoes',           'πατάτες'],
  ['potato',             'πατάτα'],
  ['carrots',            'καρότα'],
  ['carrot',             'καρότο'],
  ['spinach',            'σπανάκι'],
  ['eggplant',           'μελιτζάνα'],
  ['aubergine',          'μελιτζάνα'],
  ['zucchini',           'κολοκυθάκι'],
  ['courgette',          'κολοκυθάκι'],
  ['mushrooms',          'μανιτάρια'],
  ['mushroom',           'μανιτάρι'],
  ['peppers',            'πιπεριές'],
  ['pepper',             'πιπεριά'],
  ['cucumber',           'αγγούρι'],
  ['celery',             'σέλερι'],
  ['leek',               'πράσο'],
  ['cauliflower',        'κουνουπίδι'],
  ['broccoli',           'μπρόκολο'],
  ['beans',              'φασόλια'],
  ['lentils',            'φακές'],
  ['olives',             'ελιές'],
  ['cheese',             'τυρί'],
  ['feta',               'φέτα'],
  ['yogurt',             'γιαούρτι'],
  ['milk',               'γάλα'],
  ['cream',              'κρέμα'],
  ['butter',             'βούτυρο'],
  ['eggs',               'αυγά'],
  ['egg',                'αυγό'],
  ['flour',              'αλεύρι'],
  ['rice',               'ρύζι'],
  ['pasta',              'ζυμαρικά'],
  ['bread',              'ψωμί'],
  ['oil',                'λάδι'],
  ['salt',               'αλάτι'],
  ['sugar',              'ζάχαρη'],
  ['honey',              'μέλι'],
  ['vinegar',            'ξίδι'],
  ['wine',               'κρασί'],
  ['water',              'νερό'],
  ['lemon',              'λεμόνι'],
  ['lime',               'λάιμ'],
  ['orange',             'πορτοκάλι'],
  ['chicken',            'κοτόπουλο'],
  ['beef',               'μοσχάρι'],
  ['lamb',               'αρνί'],
  ['pork',               'χοιρινό'],
  ['fish',               'ψάρι'],
  ['shrimp',             'γαρίδες'],
  ['prawns',             'γαρίδες'],
  ['salmon',             'σολομός'],
  ['tuna',               'τόνος'],
  ['cod',                'μπακαλιάρος'],
  ['oregano',            'ρίγανη'],
  ['thyme',              'θυμάρι'],
  ['basil',              'βασιλικός'],
  ['parsley',            'μαϊντανός'],
  ['cilantro',           'κόλιανδρος'],
  ['mint',               'δυόσμος'],
  ['cinnamon',           'κανέλα'],
  ['cumin',              'κύμινο'],
  ['paprika',            'πάπρικα'],
  ['turmeric',           'κουρκουμάς'],
  ['nutmeg',             'μοσχοκάρυδο'],
  ['rosemary',           'δεντρολίβανο'],
  ['sage',               'φασκόμηλο'],
  ['chilli',             'τσίλι'],
  ['chili',              'τσίλι'],
  ['saffron',            'σαφράν'],
  ['stock',              'ζωμός'],
  ['broth',              'ζωμός'],
  ['chopped',            'ψιλοκομμένο'],
  ['diced',              'κομματάκια'],
  ['sliced',             'σε φέτες'],
  ['minced',             'κιμάς'],
  ['grated',             'τριμμένο'],
  ['crushed',            'λιωμένο'],
  ['peeled',             'καθαρισμένο'],
  ['dried',              'αποξηραμένο'],
  ['fresh',              'φρέσκο'],
  ['frozen',             'κατεψυγμένο'],
  ['cooked',             'μαγειρεμένο'],
  ['raw',                'ωμό'],
  ['large',              'μεγάλο'],
  ['small',              'μικρό'],
  ['medium',             'μέτριο'],
  ['pinch',              'πρέζα'],
  ['handful',            'χούφτα'],
  ['tbs',                'κ.σ.'],
  ['tbsp',               'κ.σ.'],
  ['tsp',                'κ.γ.'],
  ['cup',                'φλιτζάνι'],
  ['cups',               'φλιτζάνια'],
  ['clove',              'σκελίδα'],
  ['cloves',             'σκελίδες'],
  ['sprig',              'κλωνάρι'],
  ['sprigs',             'κλωνάρια'],
];

// Apply ingredient word-level translation using the dictionary
function translateIngredient(ing) {
  let result = ing;
  for (const [en, gr] of ING_WORDS_GR) {
    const regex = new RegExp(`\\b${en}\\b`, 'gi');
    if (regex.test(result)) {
      result = result.replace(regex, gr);
    }
  }
  return result;
}

// ── MyMemory translation (async, with per-text cache) ─────────────────────────
const trCache = new Map();

async function translateViaApi(text) {
  if (!text || !text.trim()) return text;
  const key = text.slice(0, 60);
  if (trCache.has(key)) return trCache.get(key);
  try {
    const { data } = await axios.get('https://api.mymemory.translated.net/get', {
      params: { q: text.slice(0, 500), langpair: 'en|el' },
      timeout: 6000,
    });
    const translated = data?.responseData?.translatedText;
    if (translated && translated !== text) {
      trCache.set(key, translated);
      return translated;
    }
    return text;
  } catch {
    return text;
  }
}

// Translate title: use static dict first, fall back to API
async function translateTitle(title) {
  if (!title) return title;
  if (MEAL_NAMES_GR[title]) return MEAL_NAMES_GR[title];
  // Try partial match
  for (const [en, gr] of Object.entries(MEAL_NAMES_GR)) {
    if (title.toLowerCase().includes(en.toLowerCase())) {
      return title.replace(new RegExp(en, 'i'), gr);
    }
  }
  return translateViaApi(title);
}

// Translate instructions in chunks so we can handle long text
async function translateInstructions(text) {
  if (!text) return '';
  // Split at sentence boundaries (up to 450 chars per chunk)
  const sentences = text.match(/[^.!?\n]+[.!?\n]+/g) || [text];
  const chunks = [];
  let current = '';
  for (const s of sentences) {
    if ((current + s).length > 450) {
      if (current) chunks.push(current.trim());
      current = s;
    } else {
      current += s;
    }
  }
  if (current.trim()) chunks.push(current.trim());

  // Translate each chunk sequentially (respect rate limits)
  const translated = [];
  for (const chunk of chunks) {
    translated.push(await translateViaApi(chunk));
    await new Promise(r => setTimeout(r, 80)); // 80ms between requests
  }
  return translated.join(' ');
}

// Full meal translation
async function translateMeal(meal) {
  const [titleGr, instructionsGr] = await Promise.all([
    translateTitle(meal.title),
    translateInstructions(meal.instructions),
  ]);
  const ingredientsGr = (meal.ingredients || []).map(translateIngredient);

  return {
    ...meal,
    title:          titleGr,
    titleOriginal:  meal.title,
    category:       CATEGORY_GR[meal.category] || meal.category,
    area:           AREA_GR[meal.area]     || meal.area,
    ingredients:    ingredientsGr,
    instructions:   instructionsGr,
  };
}

// Normalise a TheMealDB meal object into our Recipe model shape
function normaliseMeal(m) {
  if (!m) return null;
  const ingredients = [];
  for (let i = 1; i <= 20; i++) {
    const name    = m[`strIngredient${i}`]?.trim();
    const measure = m[`strMeasure${i}`]?.trim();
    if (name) ingredients.push(measure ? `${measure} ${name}` : name);
  }
  return {
    _id:          `mealdb_${m.idMeal}`,
    externalId:   m.idMeal,
    source:       'themealdb',
    title:        m.strMeal,
    image:        m.strMealThumb || null,
    category:     m.strCategory || null,
    area:         m.strArea     || null,
    instructions: m.strInstructions || '',
    youtube:      m.strYoutube  || null,
    tags:         m.strTags ? m.strTags.split(',').map(t => t.trim()).filter(Boolean) : [],
    ingredients,
    kcal: null, protein: null, carbs: null, fat: null,
  };
}

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /api/meals/greek
router.get('/greek', async (req, res) => {
  const cacheKey = 'greek_area_gr';
  const cached = cacheGet(cacheKey);
  if (cached) return res.json(cached);

  try {
    const { data: listData } = await axios.get(`${BASE}/filter.php`, {
      params: { a: 'Greek' }, timeout: 8000,
    });
    const meals = listData?.meals || [];

    const detailed = await Promise.all(
      meals.slice(0, 20).map(async m => {
        try {
          const { data } = await axios.get(`${BASE}/lookup.php`, {
            params: { i: m.idMeal }, timeout: 6000,
          });
          return normaliseMeal(data?.meals?.[0]);
        } catch { return normaliseMeal(m); }
      })
    );

    const valid = detailed.filter(Boolean);

    // Translate all meals sequentially to respect API rate limits
    const translated = [];
    for (const meal of valid) {
      translated.push(await translateMeal(meal));
    }

    const result = { meals: translated, total: meals.length };
    cacheSet(cacheKey, result, TR_TTL);
    res.json(result);
  } catch (err) {
    console.error('❌ TheMealDB greek:', err.message);
    res.status(502).json({ meals: [], total: 0, error: 'TheMealDB unavailable' });
  }
});

// GET /api/meals/mediterranean
router.get('/mediterranean', async (req, res) => {
  const cacheKey = 'mediterranean_gr';
  const cached = cacheGet(cacheKey);
  if (cached) return res.json(cached);

  try {
    const areas = ['Greek', 'Italian', 'Spanish', 'Turkish', 'Moroccan'];
    const allLists = await Promise.all(
      areas.map(a =>
        axios.get(`${BASE}/filter.php`, { params: { a }, timeout: 8000 })
             .then(r => (r.data?.meals || []).map(m => ({ ...m, area: a })))
             .catch(() => [])
      )
    );
    const flat    = allLists.flat();
    const sampled = areas.flatMap(a => flat.filter(m => m.area === a).slice(0, 4));

    const detailed = await Promise.all(
      sampled.map(async m => {
        try {
          const { data } = await axios.get(`${BASE}/lookup.php`, {
            params: { i: m.idMeal }, timeout: 6000,
          });
          return normaliseMeal(data?.meals?.[0]);
        } catch { return normaliseMeal(m); }
      })
    );

    const valid = detailed.filter(Boolean);

    const translated = [];
    for (const meal of valid) {
      translated.push(await translateMeal(meal));
    }

    const result = { meals: translated, total: translated.length };
    cacheSet(cacheKey, result, TR_TTL);
    res.json(result);
  } catch (err) {
    console.error('❌ TheMealDB mediterranean:', err.message);
    res.status(502).json({ meals: [], total: 0 });
  }
});

// GET /api/meals/search?q=moussaka
router.get('/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.status(400).json({ meals: [] });

  const cacheKey = `search_gr_${q.toLowerCase()}`;
  const cached = cacheGet(cacheKey);
  if (cached) return res.json(cached);

  try {
    const { data } = await axios.get(`${BASE}/search.php`, {
      params: { s: q }, timeout: 8000,
    });
    const raw     = (data?.meals || []).map(normaliseMeal).filter(Boolean);
    const translated = [];
    for (const meal of raw) {
      translated.push(await translateMeal(meal));
    }
    const result = { meals: translated, total: translated.length };
    cacheSet(cacheKey, result, TR_TTL);
    res.json(result);
  } catch (err) {
    console.error('❌ TheMealDB search:', err.message);
    res.status(502).json({ meals: [] });
  }
});

// GET /api/meals/random
router.get('/random', async (req, res) => {
  try {
    const { data } = await axios.get(`${BASE}/random.php`, { timeout: 6000 });
    const raw  = normaliseMeal(data?.meals?.[0]);
    const meal = raw ? await translateMeal(raw) : null;
    res.json(meal || null);
  } catch (err) {
    console.error('❌ TheMealDB random:', err.message);
    res.status(502).json(null);
  }
});

// GET /api/meals/categories
router.get('/categories', async (req, res) => {
  const cached = cacheGet('categories');
  if (cached) return res.json(cached);
  try {
    const { data } = await axios.get(`${BASE}/categories.php`, { timeout: 6000 });
    const result = (data?.categories || []).map(c => ({
      ...c,
      strCategory: CATEGORY_GR[c.strCategory] || c.strCategory,
    }));
    cacheSet('categories', result);
    res.json(result);
  } catch {
    res.json([]);
  }
});

module.exports = router;
