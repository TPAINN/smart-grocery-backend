// routes/platescanner.js - AI Plate Macro Scanner
// Accepts a base64 food photo and returns a macro breakdown using Vision AI.

const express = require('express');
const rateLimit = require('express-rate-limit');
const { callVisionAI } = require('../services/aiService');

const router = express.Router();

const scanLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Πολλές αιτήσεις. Παρακαλώ περίμενε 1 λεπτό.' },
});

const SYSTEM_PROMPT = `You are a professional nutritionist and food image analyst with deep expertise in Greek and Mediterranean cuisine.
Analyze the food on the plate in this photo and provide a realistic, accurate macro breakdown.

Return ONLY valid JSON with this exact structure (no markdown, no explanation, no extra text):
{
  "foods": [
    {
      "name": "Ελληνικό όνομα τροφίμου",
      "nameEn": "English food name",
      "emoji": "🍗",
      "portion": "150g",
      "calories": 248,
      "protein": 46,
      "carbs": 0,
      "fat": 5
    }
  ],
  "totals": {
    "calories": 580,
    "protein": 52,
    "carbs": 48,
    "fat": 22,
    "fiber": 8
  },
  "confidence": "high",
  "mealType": "κυρίως γεύμα",
  "tip": "Σύντομη συμβουλή υγείας στα ελληνικά."
}

RULES:
- Identify ALL visible foods including sauces, oils, dressings, garnishes, bread, drinks
- confidence: "high" = food clearly visible, "medium" = partially visible or mixed, "low" = unclear image
- Be realistic about portions: a typical home plate main = 200-350g, side = 80-150g
- mealType options: "πρωινό", "σνακ", "κυρίως γεύμα", "ελαφρύ γεύμα", "επιδόρπιο"
- tip: one sentence health insight, positive and informative
- All number fields must be integers (no decimals)
- Greek food names in "name", English in "nameEn"
- If no food is visible, return: {"error": "no_food_detected"}`;

const toInt = (value) => {
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) || parsed < 0 ? 0 : parsed;
};

const cleanText = (value, fallback = '') =>
  (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : fallback) || fallback;

const reconcileTotal = (current, fallback) => {
  if (!current) return fallback;
  const delta = Math.abs(current - fallback);
  const tolerance = Math.max(20, Math.round(fallback * 0.28));
  return delta <= tolerance ? current : fallback;
};

const sanitizeFoodList = (foods = []) => {
  const merged = new Map();

  foods.forEach((food) => {
    const name = cleanText(food.name, 'Άγνωστο');
    const key = name.toLowerCase();
    const protein = toInt(food.protein);
    const carbs = toInt(food.carbs);
    const fat = toInt(food.fat);
    const estimatedCalories = protein * 4 + carbs * 4 + fat * 9;
    const normalized = {
      name,
      nameEn: cleanText(food.nameEn),
      emoji: cleanText(food.emoji, '🍽️'),
      portion: cleanText(food.portion, '—'),
      calories: toInt(food.calories) || estimatedCalories,
      protein,
      carbs,
      fat,
    };

    if (!merged.has(key)) {
      merged.set(key, normalized);
      return;
    }

    const current = merged.get(key);
    current.calories += normalized.calories;
    current.protein += normalized.protein;
    current.carbs += normalized.carbs;
    current.fat += normalized.fat;

    if (current.portion === '—' && normalized.portion !== '—') {
      current.portion = normalized.portion;
    }
  });

  return [...merged.values()].sort((a, b) => b.calories - a.calories);
};

const normalizeScanResult = (result = {}) => {
  const foods = sanitizeFoodList(result.foods || []);
  const computedTotals = foods.reduce((acc, food) => {
    acc.calories += food.calories;
    acc.protein += food.protein;
    acc.carbs += food.carbs;
    acc.fat += food.fat;
    return acc;
  }, { calories: 0, protein: 0, carbs: 0, fat: 0 });

  const originalTotals = {
    calories: toInt(result.totals?.calories),
    protein: toInt(result.totals?.protein),
    carbs: toInt(result.totals?.carbs),
    fat: toInt(result.totals?.fat),
    fiber: toInt(result.totals?.fiber),
  };

  return {
    foods,
    totals: {
      calories: reconcileTotal(originalTotals.calories, computedTotals.calories),
      protein: reconcileTotal(originalTotals.protein, computedTotals.protein),
      carbs: reconcileTotal(originalTotals.carbs, computedTotals.carbs),
      fat: reconcileTotal(originalTotals.fat, computedTotals.fat),
      fiber: originalTotals.fiber,
    },
    confidence: ['high', 'medium', 'low'].includes(result.confidence) ? result.confidence : 'medium',
    mealType: cleanText(result.mealType, 'κυρίως γεύμα'),
    tip: cleanText(
      result.tip,
      'Μια πιο καθαρή φωτογραφία από κοντά βοηθά το AI να εκτιμά καλύτερα τις μερίδες.',
    ),
  };
};

const buildAdaptivePrompt = (learningContext = {}) => {
  const scanCount = Math.min(toInt(learningContext.scanCount), 100);
  const recentFoods = Array.isArray(learningContext.recentFoods)
    ? learningContext.recentFoods.filter(Boolean).slice(0, 10)
    : [];
  const frequentFoods = Array.isArray(learningContext.frequentFoods)
    ? learningContext.frequentFoods.filter(Boolean).slice(0, 6)
    : [];

  const notes = [
    'Auto-fix obvious OCR or vision mistakes, avoid duplicate foods, and keep totals aligned with the foods array.',
  ];

  if (scanCount > 0) {
    notes.unshift(`The user has ${scanCount} prior successful plate scans. Use that history as soft calibration for realistic portions.`);
  }
  if (recentFoods.length > 0) {
    notes.push(`Recent successful detections: ${recentFoods.join(', ')}.`);
  }
  if (frequentFoods.length > 0) {
    notes.push(`Frequently detected foods for this user: ${frequentFoods.join(', ')}.`);
  }

  return notes.join('\n');
};

// POST /api/plate-scanner/scan
router.post('/scan', scanLimiter, async (req, res) => {
  try {
    const { image, mediaType = 'image/jpeg', learningContext = {} } = req.body;

    if (!image || typeof image !== 'string') {
      return res.status(400).json({ error: 'Απαιτείται εικόνα (base64).' });
    }

    if (image.length > 4_000_000) {
      return res.status(413).json({ error: 'Η εικόνα είναι πολύ μεγάλη. Μέγιστο μέγεθος: 3MB.' });
    }

    const result = await callVisionAI(
      SYSTEM_PROMPT,
      `Analyze this food plate and estimate all macronutrients as accurately as possible.\n${buildAdaptivePrompt(learningContext)}`,
      image,
      mediaType,
    );

    if (result.error === 'no_food_detected' || !Array.isArray(result.foods) || result.foods.length === 0) {
      return res.status(422).json({ error: 'Δεν αναγνωρίστηκε φαγητό. Δοκίμασε ξανά με καλύτερο φωτισμό.' });
    }

    const normalized = normalizeScanResult(result);

    res.json({
      ...normalized,
      learning: {
        adapted: Boolean(toInt(learningContext.scanCount)),
        scanCount: toInt(learningContext.scanCount) + 1,
      },
    });
  } catch (err) {
    console.error('[PlateScan]', err.message);
    res.status(500).json({ error: 'Σφάλμα ανάλυσης. Παρακαλώ δοκίμασε ξανά.' });
  }
});

module.exports = router;
