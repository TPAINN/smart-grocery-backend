// routes/barcode.js
// Barcode lookup proxy — called when Open Food Facts (frontend) finds nothing.
//
// Fallback chain (in order of reliability & data quality):
//   1. USDA FoodData Central  — US government, truly free forever, 1,000 req/hr
//   2. Edamam Food Database   — needs APP_ID/APP_KEY env vars
//   3. Nutritionix             — needs APP_ID/APP_KEY env vars, 500 req/day free
//
// All three run in parallel; best result (most nutrient fields) wins.

const express = require('express');
const router  = express.Router();
const axios   = require('axios');
const authMiddleware     = require('../middleware/authMiddleware');
const requirePremiumAccess = require('../middleware/requirePremiumAccess');

// ── USDA FoodData Central ─────────────────────────────────────────────────────
const USDA_API_KEY = process.env.USDA_API_KEY || 'DEMO_KEY';

const USDA_NUTRIENT_IDS = {
  1008: 'kcal',
  1003: 'proteins',
  1004: 'fat',
  1258: 'saturated',
  1005: 'carbs',
  2000: 'sugars',
  1079: 'fiber',
  1093: 'sodium',
  1253: 'cholesterol',
};

// ── Harmful ingredient detector ───────────────────────────────────────────────
const HARMFUL_PATTERNS = [
  {
    id: 'trans_fat',
    label: 'Τρανς λιπαρά',
    icon: '⚠️',
    severity: 'high',
    desc: 'Τα υδρογονωμένα / μερικώς υδρογονωμένα λίπη αυξάνουν τη «κακή» χοληστερόλη (LDL) και μειώνουν την «καλή» (HDL). Συνδέονται με καρδιαγγειακές παθήσεις.',
    patterns: [/partially hydrogenated/i, /hydrogenated (vegetable|oil|fat)/i, /trans.fat/i],
  },
  {
    id: 'hfcs',
    label: 'Σιρόπι φρουκτόζης-γλυκόζης',
    icon: '🍬',
    severity: 'medium',
    desc: 'Το High-Fructose Corn Syrup (HFCS) σχετίζεται με παχυσαρκία, αντίσταση στην ινσουλίνη και λιπώδη ήπαρ όταν καταναλώνεται σε μεγάλες ποσότητες.',
    patterns: [/high.fructose corn syrup/i, /fructose.glucose syrup/i, /glucose.fructose syrup/i, /σιρόπι γλυκόζης.φρουκτόζης/i, /σιρόπι φρουκτόζης/i],
  },
  {
    id: 'sodium_nitrite',
    label: 'Νιτρώδες/νιτρικό νάτριο',
    icon: '🥩',
    severity: 'medium',
    desc: 'Τα E249–E252 (νιτρικά/νιτρώδη άλατα) χρησιμοποιούνται ως συντηρητικά σε αλλαντικά. Η υπερβολική κατανάλωση συνδέεται με αυξημένο κίνδυνο καρκίνου του παχέος εντέρου.',
    patterns: [/sodium nitrite/i, /sodium nitrate/i, /potassium nitrite/i, /potassium nitrate/i, /E249\b/, /E250\b/, /E251\b/, /E252\b/, /νιτρώδες νάτριο/i, /νιτρικό νάτριο/i],
  },
  {
    id: 'bha_bht',
    label: 'BHA / BHT (E320/E321)',
    icon: '🧪',
    severity: 'medium',
    desc: 'Τα BHA (E320) και BHT (E321) είναι συνθετικά αντιοξειδωτικά που χρησιμοποιούνται ως συντηρητικά. Το BHA χαρακτηρίζεται ως πιθανό καρκινογόνο από IARC.',
    patterns: [/\bBHA\b/, /\bBHT\b/, /butylated hydroxyanisole/i, /butylated hydroxytoluene/i, /E320\b/, /E321\b/],
  },
  {
    id: 'aspartame',
    label: 'Ασπαρτάμη (E951)',
    icon: '🍭',
    severity: 'medium',
    desc: 'Η ασπαρτάμη (E951) ταξινομήθηκε το 2023 από τον IARC ως «ενδεχομένως καρκινογόνος» (Group 2B). Η EFSA διατηρεί τα ADI ασφαλείας για τον γενικό πληθυσμό.',
    patterns: [/aspartame/i, /E951\b/, /ασπαρτάμη/i, /aspartamo/i],
  },
  {
    id: 'carrageenan',
    label: 'Καραγενάνη (E407)',
    icon: '🌿',
    severity: 'low',
    desc: 'Η καραγενάνη (E407) συνδέεται με φλεγμονή του εντέρου σε ζωικά μοντέλα. Η EFSA θεωρεί ότι τα τρέχοντα επίπεδα κατανάλωσης δεν εγείρουν ανησυχίες για τον γενικό πληθυσμό.',
    patterns: [/carrageenan/i, /E407\b/, /καραγενάνη/i, /carrageenan/i],
  },
  {
    id: 'artificial_colors',
    label: 'Τεχνητές χρωστικές',
    icon: '🎨',
    severity: 'medium',
    desc: 'Ορισμένες τεχνητές χρωστικές (E102 Tartrazine, E110, E122, E124, E129) σχετίζονται με υπερκινητικότητα σε παιδιά. Στην ΕΕ απαιτείται προειδοποιητική ετικέτα.',
    patterns: [/E102\b/, /E104\b/, /E110\b/, /E122\b/, /E124\b/, /E129\b/, /tartrazine/i, /sunset yellow/i, /allura red/i, /χρωστική E/i],
  },
  {
    id: 'palm_oil',
    label: 'Φοινικέλαιο',
    icon: '🌴',
    severity: 'low',
    desc: 'Το φοινικέλαιο είναι υψηλό σε κορεσμένα λιπαρά οξέα. Η παραγωγή του συνδέεται με αποψίλωση τροπικών δασών και απώλεια βιοποικιλότητας.',
    patterns: [/palm oil/i, /palm fat/i, /φοινικέλαιο/i, /huile de palme/i, /aceite de palma/i],
  },
];

function detectHarmfulIngredients(ingredientsText, additivesTags = []) {
  if (!ingredientsText && !additivesTags.length) return [];

  const text = (ingredientsText || '').toLowerCase();
  const additivesStr = (additivesTags || []).join(' ').toLowerCase();
  const combined = `${text} ${additivesStr}`;

  const found = [];
  for (const item of HARMFUL_PATTERNS) {
    const matched = item.patterns.some(rx => rx.test(combined));
    if (matched) {
      found.push({
        id:       item.id,
        label:    item.label,
        icon:     item.icon,
        severity: item.severity,
        desc:     item.desc,
      });
    }
  }
  return found;
}

// ── Health Score (0–100) ──────────────────────────────────────────────────────
function computeHealthScore(product) {
  let score = 70; // neutral baseline

  // Nutrients (per 100g)
  if (product.fat != null) {
    if (product.fat > 17.5)      score -= 12;
    else if (product.fat > 10)   score -= 6;
    else if (product.fat < 3)    score += 5;
  }
  if (product.saturated != null) {
    if (product.saturated > 5)   score -= 10;
    else if (product.saturated > 2.5) score -= 5;
  }
  if (product.sugars != null) {
    if (product.sugars > 22.5)   score -= 12;
    else if (product.sugars > 12.5) score -= 6;
    else if (product.sugars < 5) score += 4;
  }
  if (product.salt != null) {
    if (product.salt > 1.5)      score -= 10;
    else if (product.salt > 0.75) score -= 5;
    else if (product.salt < 0.3) score += 3;
  }
  if (product.proteins != null) {
    if (product.proteins >= 20)  score += 10;
    else if (product.proteins >= 10) score += 6;
  }
  if (product.fiber != null) {
    if (product.fiber >= 6)      score += 8;
    else if (product.fiber >= 3) score += 4;
  }

  // NOVA processing level
  if (product.novaGroup === 4)      score -= 18;
  else if (product.novaGroup === 3) score -= 8;
  else if (product.novaGroup === 1) score += 6;

  // NutriScore
  const nutriMap = { a: 10, b: 5, c: 0, d: -8, e: -16 };
  if (product.nutriScore && nutriMap[product.nutriScore] != null) {
    score += nutriMap[product.nutriScore];
  }

  // Palm oil
  if (product.hasPalmOil) score -= 4;

  // Harmful ingredients
  const harmfulCount = (product.harmfulIngredients || []).length;
  score -= Math.min(harmfulCount * 6, 20);

  return Math.max(0, Math.min(100, Math.round(score)));
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function deriveFields(result) {
  if (result.sodium != null && result.salt == null) {
    result.salt = Math.round(result.sodium * 2.5 * 10) / 10;
  }
  result.harmfulIngredients = detectHarmfulIngredients(
    result.ingredients,
    result.additives,
  );
  result.healthScore = computeHealthScore(result);
  return result;
}

// ── USDA FoodData Central ─────────────────────────────────────────────────────
function parseUsdaFood(food, barcode) {
  if (!food) return null;

  const result = {
    barcode,
    source:       'usda',
    name:         food.description || `Προϊόν (${barcode})`,
    brand:        food.brandOwner || food.brandName || null,
    image:        null,
    quantity:     food.servingSize ? `${food.servingSize}${food.servingSizeUnit || ''}` : '',
    novaGroup:    null,
    nutriScore:   null,
    allergenTags: [],
    additives:    [],
    ingredients:  food.ingredients || '',
    hasPalmOil:   /palm/i.test(food.ingredients || ''),
    isVegan:      false,
    isVegetarian: false,
    categories:   food.foodCategory ? [food.foodCategory] : [],
    labels:       [],
    origin:       food.marketCountry || null,
    scannedAt:    new Date().toISOString(),
  };

  (food.foodNutrients || []).forEach(n => {
    const field = USDA_NUTRIENT_IDS[n.nutrientId];
    if (field && n.value != null && result[field] == null) {
      result[field] = Math.round(n.value * 10) / 10;
    }
  });

  return deriveFields(result);
}

async function lookupUsda(barcode) {
  try {
    const stripped = barcode.replace(/^0+/, '');

    // Try direct GTIN lookup first (most accurate)
    try {
      const { data: direct } = await axios.get('https://api.nal.usda.gov/fdc/v1/foods/search', {
        params: {
          query:    stripped,
          dataType: 'Branded',
          pageSize: 10,
          api_key:  USDA_API_KEY,
        },
        timeout: 7000,
      });

      const match = (direct?.foods || []).find(f => {
        const gtin = (f.gtinUpc || '').replace(/^0+/, '');
        return gtin === stripped || gtin === barcode;
      });

      if (match) return parseUsdaFood(match, barcode);
      // If no exact match, fall through to return best match
      if (direct?.foods?.[0]) return parseUsdaFood(direct.foods[0], barcode);
    } catch { /* fall through */ }

    return null;
  } catch {
    return null;
  }
}

// ── Edamam Food Database ──────────────────────────────────────────────────────
const EDAMAM_APP_ID  = process.env.EDAMAM_APP_ID  || '';
const EDAMAM_APP_KEY = process.env.EDAMAM_APP_KEY || '';

const EDAMAM_NUTRIENT_MAP = {
  ENERC_KCAL: 'kcal',
  FAT:        'fat',
  FASAT:      'saturated',
  CHOCDF:     'carbs',
  SUGAR:      'sugars',
  FIBTG:      'fiber',
  PROCNT:     'proteins',
  NA:         'sodium',
  CHOLE:      'cholesterol',
};

function parseEdamamHint(hint, barcode) {
  const food = hint?.food;
  if (!food) return null;

  const n = food.nutrients || {};
  const result = {
    barcode,
    source:       'edamam',
    name:         food.label || `Προϊόν (${barcode})`,
    brand:        food.brand || null,
    image:        food.image || null,
    quantity:     '',
    novaGroup:    null,
    nutriScore:   null,
    allergenTags: [],
    additives:    [],
    ingredients:  '',
    hasPalmOil:   false,
    isVegan:      false,
    isVegetarian: false,
    categories:   food.category ? [food.category] : [],
    labels:       [],
    origin:       null,
    scannedAt:    new Date().toISOString(),
  };

  Object.entries(EDAMAM_NUTRIENT_MAP).forEach(([code, field]) => {
    if (n[code] != null && result[field] == null) {
      result[field] = Math.round(n[code] * 10) / 10;
    }
  });

  return deriveFields(result);
}

async function lookupEdamam(barcode) {
  if (!EDAMAM_APP_ID || !EDAMAM_APP_KEY) return null;
  try {
    const { data } = await axios.get('https://api.edamam.com/api/food-database/v2/parser', {
      params: {
        upc:              barcode,
        app_id:           EDAMAM_APP_ID,
        app_key:          EDAMAM_APP_KEY,
        'nutrition-type': 'logging',
      },
      timeout: 8000,
    });
    return parseEdamamHint(data?.parsed?.[0] || data?.hints?.[0], barcode);
  } catch {
    return null;
  }
}

// ── Nutritionix Food Database ─────────────────────────────────────────────────
const NUTRITIONIX_APP_ID  = process.env.NUTRITIONIX_APP_ID  || '';
const NUTRITIONIX_APP_KEY = process.env.NUTRITIONIX_APP_KEY || '';

async function lookupNutritionix(barcode) {
  if (!NUTRITIONIX_APP_ID || !NUTRITIONIX_APP_KEY) return null;
  try {
    const { data } = await axios.get('https://trackapi.nutritionix.com/v2/search/item', {
      params: { upc: barcode },
      headers: {
        'x-app-id':         NUTRITIONIX_APP_ID,
        'x-app-key':        NUTRITIONIX_APP_KEY,
        'x-remote-user-id': '0',
      },
      timeout: 8000,
    });
    const food = data?.foods?.[0];
    if (!food) return null;

    const result = {
      barcode,
      source:       'nutritionix',
      name:         food.food_name || `Προϊόν (${barcode})`,
      brand:        food.brand_name || null,
      image:        food.photo?.thumb || null,
      quantity:     food.serving_unit ? `${food.serving_qty || 1} ${food.serving_unit}` : '',
      novaGroup:    null,
      nutriScore:   null,
      allergenTags: [],
      additives:    [],
      ingredients:  food.nf_ingredient_statement || '',
      hasPalmOil:   /palm/i.test(food.nf_ingredient_statement || ''),
      isVegan:      false,
      isVegetarian: false,
      categories:   [],
      labels:       [],
      origin:       null,
      scannedAt:    new Date().toISOString(),
    };

    if (food.nf_calories        != null) result.kcal      = Math.round(food.nf_calories);
    if (food.nf_protein         != null) result.proteins  = Math.round(food.nf_protein * 10) / 10;
    if (food.nf_total_fat       != null) result.fat       = Math.round(food.nf_total_fat * 10) / 10;
    if (food.nf_saturated_fat   != null) result.saturated = Math.round(food.nf_saturated_fat * 10) / 10;
    if (food.nf_total_carbohydrate != null) result.carbs  = Math.round(food.nf_total_carbohydrate * 10) / 10;
    if (food.nf_sugars          != null) result.sugars    = Math.round(food.nf_sugars * 10) / 10;
    if (food.nf_dietary_fiber   != null) result.fiber     = Math.round(food.nf_dietary_fiber * 10) / 10;
    if (food.nf_sodium          != null) result.sodium    = Math.round(food.nf_sodium * 10) / 10;

    return deriveFields(result);
  } catch {
    return null;
  }
}

// ── Route ─────────────────────────────────────────────────────────────────────
router.get('/:barcode', authMiddleware, requirePremiumAccess, async (req, res) => {
  const { barcode } = req.params;

  if (!barcode || !/^\d{6,14}$/.test(barcode)) {
    return res.status(400).json({ found: false, message: 'Μη έγκυρο barcode.' });
  }

  const [usdaResult, edamamResult, nutritionixResult] = await Promise.all([
    lookupUsda(barcode),
    lookupEdamam(barcode),
    lookupNutritionix(barcode),
  ]);

  const candidates = [usdaResult, edamamResult, nutritionixResult].filter(Boolean);
  if (!candidates.length) return res.json({ found: false });

  const MACRO_KEYS = ['kcal', 'fat', 'proteins', 'carbs', 'sugars', 'fiber', 'saturated', 'salt'];
  const best = candidates.reduce((a, b) => {
    const scoreA = MACRO_KEYS.filter(k => a[k] != null).length;
    const scoreB = MACRO_KEYS.filter(k => b[k] != null).length;
    return scoreB > scoreA ? b : a;
  });

  return res.json({ found: true, product: best });
});

module.exports = router;
