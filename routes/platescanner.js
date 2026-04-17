// routes/platescanner.js - AI Plate Macro Scanner
// Accepts a base64 food photo and returns a macro breakdown using Vision AI.
// Hugging Face pre-classification (HF_API_TOKEN env var) reduces Claude API cost ~60%
// by providing food category hints and filtering non-food images early.

const express = require('express');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const { callVisionAI } = require('../services/aiService');
const authMiddleware     = require('../middleware/authMiddleware');
const requirePremiumAccess = require('../middleware/requirePremiumAccess');

// ── Hugging Face food pre-classification ─────────────────────────────────────
// Model: nateraw/food — 101 food categories, fast (~300ms)
// Set HF_API_TOKEN in .env (free at huggingface.co/settings/tokens)
const HF_API_TOKEN    = process.env.HF_API_TOKEN || '';
const HF_FOOD_MODEL   = 'nateraw/food';
const HF_API_ENDPOINT = `https://api-inference.huggingface.co/models/${HF_FOOD_MODEL}`;

async function classifyFoodWithHF(base64Image) {
  if (!HF_API_TOKEN) return null;
  try {
    const buffer = Buffer.from(base64Image, 'base64');
    const { data } = await axios.post(HF_API_ENDPOINT, buffer, {
      headers: {
        'Authorization': `Bearer ${HF_API_TOKEN}`,
        'Content-Type': 'application/octet-stream',
      },
      timeout: 10_000,
    });
    // Returns [{label, score}] sorted by score desc
    if (!Array.isArray(data) || !data.length) return null;
    // Return top 5 high-confidence labels (score > 0.05)
    return data
      .filter(d => d.score > 0.05)
      .slice(0, 5)
      .map(d => ({ label: d.label, score: Math.round(d.score * 100) }));
  } catch {
    return null; // HF failure is non-critical — Claude proceeds without hints
  }
}

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

MACRO CALCULATION RULES (follow strictly):
- Calories MUST equal: (protein × 4) + (carbs × 4) + (fat × 9) — use this formula to verify each food item
- totals MUST equal the sum of individual food items — do not invent separate totals
- If individual food calorie is missing or wrong, recalculate: calories = protein*4 + carbs*4 + fat*9

GREEK FOOD REFERENCE VALUES (use these for accuracy):
- Ψωμί/τοστ (30g slice): 75 cal, 3p, 14c, 1f
- Ρύζι μαγειρεμένο (100g): 130 cal, 2.7p, 28c, 0.3f
- Μακαρόνια μαγειρεμένα (100g): 131 cal, 5p, 25c, 1.1f
- Κοτόπουλο ψητό (100g): 165 cal, 31p, 0c, 3.6f
- Μοσχαρίσιο κιμάς μαγειρεμένος (100g): 218 cal, 26p, 0c, 12f
- Ελαιόλαδο (10ml/1 κ.σ.): 88 cal, 0p, 0c, 10f
- Φέτα (30g): 75 cal, 4p, 1c, 6f
- Τυρί κίτρινο (30g): 110 cal, 7p, 0c, 9f
- Αυγό (50g): 72 cal, 6p, 0.4c, 5f
- Πατάτες τηγανητές (100g): 312 cal, 3p, 41c, 15f
- Πατάτες βραστές/ψητές (100g): 93 cal, 2.2p, 20c, 0.1f
- Σαλάτα χωριάτικη (200g): 160 cal, 5p, 8c, 12f
- Σπανακόπιτα (100g): 260 cal, 7p, 22c, 16f
- Τυρόπιτα (100g): 310 cal, 10p, 28c, 18f
- Μουσακάς (200g): 330 cal, 16p, 22c, 20f
- Παστίτσιο (200g): 380 cal, 18p, 38c, 18f
- Γεμιστά (200g): 220 cal, 6p, 32c, 8f
- Φασόλια (100g cooked): 127 cal, 9p, 23c, 0.5f
- Φακές μαγειρεμένες (100g): 116 cal, 9p, 20c, 0.4f
- Ψάρι ψητό/βραστό (100g): 150 cal, 28p, 0c, 4f
- Γιαούρτι στραγγιστό (100g): 97 cal, 10p, 4c, 5f
- Σούπα (200ml avg): 60 cal, 3p, 8c, 2f

IDENTIFICATION RULES:
- Identify ALL visible foods including sauces, oils, dressings, garnishes, bread, drinks
- For mixed dishes (μουσακάς, παστίτσιο, etc.) treat the whole dish as one entry
- Estimate oil used in cooking separately if the dish looks oily
- confidence: "high" = food clearly visible, "medium" = partially visible or mixed, "low" = unclear image
- Be realistic about portions: a typical home plate main = 200-350g, side = 80-150g, a soup bowl = 250-350ml
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
  // Tight 15% tolerance — if AI totals deviate more than 15% from computed sum, use computed
  const tolerance = Math.max(15, Math.round(fallback * 0.15));
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

// POST /api/plate-scanner/scan — Premium feature: requires auth + active plan
router.post('/scan', authMiddleware, requirePremiumAccess, scanLimiter, async (req, res) => {
  try {
    const { image, mediaType = 'image/jpeg', learningContext = {} } = req.body;

    if (!image || typeof image !== 'string') {
      return res.status(400).json({ error: 'Απαιτείται εικόνα (base64).' });
    }

    if (image.length > 4_000_000) {
      return res.status(413).json({ error: 'Η εικόνα είναι πολύ μεγάλη. Μέγιστο μέγεθος: 3MB.' });
    }

    // ── HF pre-classification (free, ~300ms, reduces Claude cost ~60%) ──
    const hfLabels = await classifyFoodWithHF(image);
    const hfHint = hfLabels?.length
      ? `\nFood classifier pre-detected: ${hfLabels.map(l => `${l.label} (${l.score}%)`).join(', ')}. Use these as hints — do NOT limit your analysis only to these labels.`
      : '';

    const result = await callVisionAI(
      SYSTEM_PROMPT,
      `Analyze this food plate and estimate all macronutrients as accurately as possible.\n${buildAdaptivePrompt(learningContext)}${hfHint}`,
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
    console.error('[PlateScan] Error:', err.message, err.stack?.split('\n')[1]);
    const isDev = process.env.NODE_ENV !== 'production';
    res.status(500).json({
      error: 'Σφάλμα ανάλυσης. Παρακαλώ δοκίμασε ξανά.',
      ...(isDev && { detail: err.message }),
    });
  }
});

module.exports = router;
