// routes/platescanner.js - AI Plate Macro Scanner v2
// Accepts a base64 food photo OR a text description and returns a macro breakdown.
// Hugging Face pre-classification (HF_API_TOKEN env var) reduces Claude API cost ~60%
// by providing food category hints and filtering non-food images early.

const express = require('express');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const { callVisionAI, callAI } = require('../services/aiService');
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

// ── Shared JSON schema description (used by both prompts) ─────────────────────
const JSON_SCHEMA_INSTRUCTIONS = `
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
      "fat": 5,
      "sugar": 1,
      "fiber": 0
    }
  ],
  "totals": {
    "calories": 580,
    "protein": 52,
    "carbs": 48,
    "fat": 22,
    "fiber": 8,
    "sugar": 12,
    "vitamin_c": 45,
    "vitamin_d": 5,
    "calcium": 120,
    "iron": 4
  },
  "healthScore": 7,
  "confidence": "high",
  "mealType": "κυρίως γεύμα",
  "tip": "Σύντομη συμβουλή υγείας στα ελληνικά.",
  "question": null
}

HEALTH SCORE RULES (healthScore: integer 1-10):
- Rate 1-10 based on: protein quality (lean meat/fish/legumes = +), fiber content (+), excess sugar (-), excessive saturated fat (-), variety of food groups (+), processing level (ultra-processed = --)
- 8-10: excellent (balanced, nutritious meal)
- 5-7: decent (average, room for improvement)
- 3-4: mediocre (nutritionally poor, high in bad fats or sugar)
- 1-2: poor (junk food, ultra-processed, excessive sugar/fat)

QUESTION FIELD RULES:
- If the food is ambiguous in a way that SIGNIFICANTLY changes macros (e.g., beef vs pork, fried vs grilled, cream sauce vs tomato sauce), return a question INSTEAD of the full analysis
- When asking a question, still fill in foods/totals/tip/etc with your best guess, and set question to: {"text": "Είναι μοσχαρίσιο ή χοιρινό κρέας;", "choices": ["Μοσχαρίσιο", "Χοιρινό"]}
- 2-3 choices only, short Greek labels
- When a clarification has been provided in the user message (e.g. "The user clarified: Μοσχαρίσιο"), do NOT ask again — proceed with full analysis
- Set question: null when there is no meaningful ambiguity

SUGAR & FIBER PER FOOD ITEM:
- Estimate sugar and fiber for each food based on its type
- sugar (g): rice ~0, pasta ~1, grilled chicken ~0, bread ~2/slice, fruit ~10-15/100g, yogurt ~4/100g, legumes ~1-2/100g, vegetables ~2-4/100g
- fiber (g): legumes ~7/100g, vegetables ~2-3/100g, whole grain bread ~2/slice, white rice ~0.3/100g, pasta ~1.8/100g, fruit ~2/100g, meat/fish ~0

VITAMIN & MINERAL ESTIMATES FOR TOTALS:
- Estimate vitamin_c (mg), vitamin_d (μg), calcium (mg), iron (mg) based on foods identified
- vitamin_c: leafy greens ~30mg/100g, citrus ~50mg/100g, peppers ~80mg/100g, tomatoes ~14mg/100g, most meats ~0
- vitamin_d: fatty fish ~10μg/100g, egg yolk ~2μg, dairy ~0.1μg/100g, most plant foods ~0
- calcium: dairy ~120mg/100g, feta ~360mg/100g, leafy greens ~100mg/100g, legumes ~50mg/100g
- iron: red meat ~3mg/100g, legumes ~3mg/100g, leafy greens ~2mg/100g, fish ~1mg/100g, chicken ~1mg/100g
- Sum up contributions from all foods for the totals
- Use integers only

MACRO CALCULATION RULES (follow strictly):
- Calories MUST equal: (protein × 4) + (carbs × 4) + (fat × 9) — use this formula to verify each food item
- totals MUST equal the sum of individual food items — do not invent separate totals
- If individual food calorie is missing or wrong, recalculate: calories = protein*4 + carbs*4 + fat*9`;

// ── System prompt for image scanning ─────────────────────────────────────────
const SYSTEM_PROMPT = `You are a professional nutritionist and food image analyst with deep expertise in Greek and Mediterranean cuisine.
Analyze the food on the plate in this photo and provide a realistic, accurate macro breakdown.
${JSON_SCHEMA_INSTRUCTIONS}

GREEK FOOD REFERENCE VALUES (use these for accuracy):
- Ψωμί/τοστ (30g slice): 75 cal, 3p, 14c, 1f, sugar 2, fiber 1
- Ρύζι μαγειρεμένο (100g): 130 cal, 2.7p, 28c, 0.3f, sugar 0, fiber 0
- Μακαρόνια μαγειρεμένα (100g): 131 cal, 5p, 25c, 1.1f, sugar 1, fiber 2
- Κοτόπουλο ψητό (100g): 165 cal, 31p, 0c, 3.6f, sugar 0, fiber 0
- Μοσχαρίσιο κιμάς μαγειρεμένος (100g): 218 cal, 26p, 0c, 12f, sugar 0, fiber 0
- Ελαιόλαδο (10ml/1 κ.σ.): 88 cal, 0p, 0c, 10f, sugar 0, fiber 0
- Φέτα (30g): 75 cal, 4p, 1c, 6f, sugar 0, fiber 0
- Τυρί κίτρινο (30g): 110 cal, 7p, 0c, 9f, sugar 0, fiber 0
- Αυγό (50g): 72 cal, 6p, 0.4c, 5f, sugar 0, fiber 0
- Πατάτες τηγανητές (100g): 312 cal, 3p, 41c, 15f, sugar 1, fiber 3
- Πατάτες βραστές/ψητές (100g): 93 cal, 2.2p, 20c, 0.1f, sugar 1, fiber 2
- Σαλάτα χωριάτικη (200g): 160 cal, 5p, 8c, 12f, sugar 4, fiber 2
- Σπανακόπιτα (100g): 260 cal, 7p, 22c, 16f, sugar 1, fiber 2
- Τυρόπιτα (100g): 310 cal, 10p, 28c, 18f, sugar 1, fiber 1
- Μουσακάς (200g): 330 cal, 16p, 22c, 20f, sugar 4, fiber 3
- Παστίτσιο (200g): 380 cal, 18p, 38c, 18f, sugar 3, fiber 3
- Γεμιστά (200g): 220 cal, 6p, 32c, 8f, sugar 5, fiber 4
- Φασόλια (100g cooked): 127 cal, 9p, 23c, 0.5f, sugar 1, fiber 7
- Φακές μαγειρεμένες (100g): 116 cal, 9p, 20c, 0.4f, sugar 2, fiber 8
- Ψάρι ψητό/βραστό (100g): 150 cal, 28p, 0c, 4f, sugar 0, fiber 0
- Γιαούρτι στραγγιστό (100g): 97 cal, 10p, 4c, 5f, sugar 4, fiber 0
- Σούπα (200ml avg): 60 cal, 3p, 8c, 2f, sugar 2, fiber 1

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

// ── System prompt for text-based analysis ────────────────────────────────────
const TEXT_SYSTEM_PROMPT = `You are a professional nutritionist with deep expertise in Greek and Mediterranean cuisine.
Analyze the food description provided and estimate all macronutrients as accurately as possible.
${JSON_SCHEMA_INSTRUCTIONS}

GREEK FOOD REFERENCE VALUES (use these for accuracy):
- Ψωμί/τοστ (30g slice): 75 cal, 3p, 14c, 1f, sugar 2, fiber 1
- Ρύζι μαγειρεμένο (100g): 130 cal, 2.7p, 28c, 0.3f, sugar 0, fiber 0
- Μακαρόνια μαγειρεμένα (100g): 131 cal, 5p, 25c, 1.1f, sugar 1, fiber 2
- Κοτόπουλο ψητό (100g): 165 cal, 31p, 0c, 3.6f, sugar 0, fiber 0
- Μοσχαρίσιο κιμάς μαγειρεμένος (100g): 218 cal, 26p, 0c, 12f, sugar 0, fiber 0
- Ελαιόλαδο (10ml/1 κ.σ.): 88 cal, 0p, 0c, 10f, sugar 0, fiber 0
- Φέτα (30g): 75 cal, 4p, 1c, 6f, sugar 0, fiber 0
- Τυρί κίτρινο (30g): 110 cal, 7p, 0c, 9f, sugar 0, fiber 0
- Αυγό (50g): 72 cal, 6p, 0.4c, 5f, sugar 0, fiber 0
- Πατάτες τηγανητές (100g): 312 cal, 3p, 41c, 15f, sugar 1, fiber 3
- Πατάτες βραστές/ψητές (100g): 93 cal, 2.2p, 20c, 0.1f, sugar 1, fiber 2
- Σαλάτα χωριάτικη (200g): 160 cal, 5p, 8c, 12f, sugar 4, fiber 2
- Σπανακόπιτα (100g): 260 cal, 7p, 22c, 16f, sugar 1, fiber 2
- Τυρόπιτα (100g): 310 cal, 10p, 28c, 18f, sugar 1, fiber 1
- Μουσακάς (200g): 330 cal, 16p, 22c, 20f, sugar 4, fiber 3
- Παστίτσιο (200g): 380 cal, 18p, 38c, 18f, sugar 3, fiber 3
- Γεμιστά (200g): 220 cal, 6p, 32c, 8f, sugar 5, fiber 4
- Φασόλια (100g cooked): 127 cal, 9p, 23c, 0.5f, sugar 1, fiber 7
- Φακές μαγειρεμένες (100g): 116 cal, 9p, 20c, 0.4f, sugar 2, fiber 8
- Ψάρι ψητό/βραστό (100g): 150 cal, 28p, 0c, 4f, sugar 0, fiber 0
- Γιαούρτι στραγγιστό (100g): 97 cal, 10p, 4c, 5f, sugar 4, fiber 0
- Σούπα (200ml avg): 60 cal, 3p, 8c, 2f, sugar 2, fiber 1

IDENTIFICATION RULES:
- Break the description into individual food components and estimate portions realistically
- confidence: "high" = clear description with portion details, "medium" = vague or missing portions, "low" = very ambiguous
- Be realistic about portions: a typical home plate main = 200-350g, side = 80-150g
- mealType options: "πρωινό", "σνακ", "κυρίως γεύμα", "ελαφρύ γεύμα", "επιδόρπιο"
- tip: one sentence health insight, positive and informative
- All number fields must be integers (no decimals)
- Greek food names in "name", English in "nameEn"`;

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
    const sugar = toInt(food.sugar);
    const fiber = toInt(food.fiber);
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
      sugar,
      fiber,
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
    current.sugar += normalized.sugar;
    current.fiber += normalized.fiber;

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
    acc.sugar += food.sugar;
    acc.fiber += food.fiber;
    return acc;
  }, { calories: 0, protein: 0, carbs: 0, fat: 0, sugar: 0, fiber: 0 });

  const originalTotals = {
    calories: toInt(result.totals?.calories),
    protein: toInt(result.totals?.protein),
    carbs: toInt(result.totals?.carbs),
    fat: toInt(result.totals?.fat),
    fiber: toInt(result.totals?.fiber),
    sugar: toInt(result.totals?.sugar),
    vitamin_c: toInt(result.totals?.vitamin_c),
    vitamin_d: toInt(result.totals?.vitamin_d),
    calcium: toInt(result.totals?.calcium),
    iron: toInt(result.totals?.iron),
  };

  // Validate healthScore: must be integer 1-10, default 5
  const rawScore = parseInt(result.healthScore, 10);
  const healthScore = !Number.isNaN(rawScore) && rawScore >= 1 && rawScore <= 10 ? rawScore : 5;

  // Validate question: null or {text: string, choices: string[]}
  let question = null;
  if (result.question && typeof result.question === 'object' && result.question.text) {
    question = {
      text: cleanText(result.question.text),
      choices: Array.isArray(result.question.choices)
        ? result.question.choices.map(c => cleanText(String(c))).filter(Boolean).slice(0, 3)
        : [],
    };
    if (!question.choices.length) question = null;
  }

  return {
    foods,
    totals: {
      calories: reconcileTotal(originalTotals.calories, computedTotals.calories),
      protein: reconcileTotal(originalTotals.protein, computedTotals.protein),
      carbs: reconcileTotal(originalTotals.carbs, computedTotals.carbs),
      fat: reconcileTotal(originalTotals.fat, computedTotals.fat),
      fiber: reconcileTotal(originalTotals.fiber, computedTotals.fiber),
      sugar: reconcileTotal(originalTotals.sugar, computedTotals.sugar),
      vitamin_c: originalTotals.vitamin_c,
      vitamin_d: originalTotals.vitamin_d,
      calcium: originalTotals.calcium,
      iron: originalTotals.iron,
    },
    healthScore,
    confidence: ['high', 'medium', 'low'].includes(result.confidence) ? result.confidence : 'medium',
    mealType: cleanText(result.mealType, 'κυρίως γεύμα'),
    tip: cleanText(
      result.tip,
      'Μια πιο καθαρή φωτογραφία από κοντά βοηθά το AI να εκτιμά καλύτερα τις μερίδες.',
    ),
    question,
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
    const { image, mediaType = 'image/jpeg', learningContext = {}, clarification } = req.body;

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

    const clarificationNote = clarification ? `\nThe user clarified: ${clarification}` : '';

    const result = await callVisionAI(
      SYSTEM_PROMPT,
      `Analyze this food plate and estimate all macronutrients as accurately as possible.\n${buildAdaptivePrompt(learningContext)}${hfHint}${clarificationNote}`,
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

// POST /api/plate-scanner/analyze-text — Premium feature: requires auth + active plan
router.post('/analyze-text', authMiddleware, requirePremiumAccess, scanLimiter, async (req, res) => {
  try {
    const { description, clarification, learningContext = {} } = req.body;

    if (!description || typeof description !== 'string' || !description.trim()) {
      return res.status(400).json({ error: 'Απαιτείται περιγραφή φαγητού.' });
    }

    const clarificationNote = clarification ? `\nThe user clarified: ${clarification}` : '';

    const result = await callAI(
      TEXT_SYSTEM_PROMPT,
      `Analyze this food description and estimate all macronutrients: "${description.trim()}"${clarificationNote}\n${buildAdaptivePrompt(learningContext)}`,
    );

    if (result.error === 'no_food_detected' || !Array.isArray(result.foods) || result.foods.length === 0) {
      return res.status(422).json({ error: 'Δεν αναγνωρίστηκε φαγητό στην περιγραφή. Δοκίμασε να είσαι πιο συγκεκριμένος.' });
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
    console.error('[PlateText] Error:', err.message, err.stack?.split('\n')[1]);
    const isDev = process.env.NODE_ENV !== 'production';
    res.status(500).json({
      error: 'Σφάλμα ανάλυσης. Παρακαλώ δοκίμασε ξανά.',
      ...(isDev && { detail: err.message }),
    });
  }
});

module.exports = router;
