// routes/barcode.js
// Barcode lookup proxy — called when Open Food Facts (frontend) finds nothing.
//
// Fallback chain (in order of reliability & data quality):
//   1. USDA FoodData Central  — US government, truly free forever, 1,000 req/hr
//   2. Edamam Food Database   — needs APP_ID/APP_KEY env vars, paid for scale
//
// Both are tried in parallel; whichever finds a result first wins.

const express = require('express');
const router  = express.Router();
const axios   = require('axios');
const authMiddleware     = require('../middleware/authMiddleware');
const requirePremiumAccess = require('../middleware/requirePremiumAccess');

// ── USDA FoodData Central ─────────────────────────────────────────────────────
// Register a free key at https://fdc.nal.usda.gov/api-key-signup.html
// The DEMO_KEY works up to 30 req/hr — fine for local dev.
const USDA_API_KEY = process.env.USDA_API_KEY || 'DEMO_KEY';

// Nutrient IDs used by FDC for macros (the ones we display in the scanner)
const USDA_NUTRIENT_IDS = {
  1008: 'kcal',       // Energy (kcal)
  1003: 'proteins',   // Protein
  1004: 'fat',        // Total lipid (fat)
  1258: 'saturated',  // Fatty acids, total saturated
  1005: 'carbs',      // Carbohydrate, by difference
  2000: 'sugars',     // Sugars, total including NLEA
  1079: 'fiber',      // Fiber, total dietary
  1093: 'sodium',     // Sodium
  1253: 'cholesterol',
};

function parseUsdaFood(food, barcode) {
  if (!food) return null;

  const result = {
    barcode,
    source:       'usda',
    name:         food.description || `Προϊόν (${barcode})`,
    brand:        food.brandOwner || food.brandName || null,
    image:        null,    // USDA doesn't provide product images
    quantity:     food.packageWeight || food.servingSize
                    ? `${food.servingSize || ''}${food.servingSizeUnit || ''}`
                    : '',
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

  // Map nutrients
  (food.foodNutrients || []).forEach(n => {
    const field = USDA_NUTRIENT_IDS[n.nutrientId];
    if (field && n.value != null && result[field] == null) {
      result[field] = Math.round(n.value * 10) / 10;
    }
  });

  // Derive salt from sodium (salt ≈ sodium × 2.5)
  if (result.sodium != null && result.salt == null) {
    result.salt = Math.round(result.sodium * 2.5 * 10) / 10;
  }

  return result;
}

async function lookupUsda(barcode) {
  try {
    // Search branded foods by GTIN/UPC — most barcodes are EAN-13 which USDA indexes
    const { data } = await axios.get('https://api.nal.usda.gov/fdc/v1/foods/search', {
      params: {
        query:    barcode,
        dataType: 'Branded',
        pageSize: 5,
        api_key:  USDA_API_KEY,
      },
      timeout: 7000,
    });

    // Find the entry whose gtinUpc matches our barcode (strip leading zeros)
    const stripped = barcode.replace(/^0+/, '');
    const match = (data?.foods || []).find(f => {
      const gtin = (f.gtinUpc || '').replace(/^0+/, '');
      return gtin === stripped || gtin === barcode;
    });

    return parseUsdaFood(match || data?.foods?.[0], barcode);
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
  SUGARFR:    'sugars',
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

  if (result.sodium != null && result.salt == null) {
    result.salt = Math.round(result.sodium * 2.5 * 10) / 10;
  }

  return result;
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
// Register a free app at https://developer.nutritionix.com/
// Free tier: 500 req/day — great for Greek products not in USDA
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
      ingredients:  '',
      hasPalmOil:   false,
      isVegan:      false,
      isVegetarian: false,
      categories:   [],
      labels:       [],
      origin:       null,
      scannedAt:    new Date().toISOString(),
    };

    if (food.nf_calories   != null) result.kcal      = Math.round(food.nf_calories);
    if (food.nf_protein    != null) result.proteins   = Math.round(food.nf_protein * 10) / 10;
    if (food.nf_total_fat  != null) result.fat        = Math.round(food.nf_total_fat * 10) / 10;
    if (food.nf_saturated_fat != null) result.saturated = Math.round(food.nf_saturated_fat * 10) / 10;
    if (food.nf_total_carbohydrate != null) result.carbs = Math.round(food.nf_total_carbohydrate * 10) / 10;
    if (food.nf_sugars     != null) result.sugars     = Math.round(food.nf_sugars * 10) / 10;
    if (food.nf_dietary_fiber != null) result.fiber   = Math.round(food.nf_dietary_fiber * 10) / 10;
    if (food.nf_sodium     != null) {
      result.sodium = Math.round(food.nf_sodium * 10) / 10;
      result.salt   = Math.round(food.nf_sodium * 2.5 * 10) / 10;
    }

    return result;
  } catch {
    return null;
  }
}

// ── Route ─────────────────────────────────────────────────────────────────────
// GET /api/barcode/:barcode — Premium feature: requires auth + active plan
router.get('/:barcode', authMiddleware, requirePremiumAccess, async (req, res) => {
  const { barcode } = req.params;

  if (!barcode || !/^\d{6,14}$/.test(barcode)) {
    return res.status(400).json({ found: false, message: 'Μη έγκυρο barcode.' });
  }

  // Run USDA, Edamam, and Nutritionix in parallel — pick the best result
  const [usdaResult, edamamResult, nutritionixResult] = await Promise.all([
    lookupUsda(barcode),
    lookupEdamam(barcode),
    lookupNutritionix(barcode),
  ]);

  // Prefer whichever has the most macro fields filled in
  const candidates = [usdaResult, edamamResult, nutritionixResult].filter(Boolean);
  if (!candidates.length) return res.json({ found: false });

  // Pick the candidate with the most nutrient fields filled in
  const best = candidates.reduce((a, b) => {
    const scoreA = ['kcal','fat','proteins','carbs','sugars','fiber'].filter(k => a[k] != null).length;
    const scoreB = ['kcal','fat','proteins','carbs','sugars','fiber'].filter(k => b[k] != null).length;
    // Prefer USDA when tied (it's always free at scale)
    return scoreB > scoreA ? b : a;
  });

  return res.json({ found: true, product: best });
});

module.exports = router;
