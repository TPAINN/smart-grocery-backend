// routes/platescanner.js — AI Plate Macro Scanner
// Accepts a base64 food photo and returns a full macro breakdown using Vision AI.

const express = require('express');
const router  = express.Router();
const rateLimit = require('express-rate-limit');
const { callVisionAI } = require('../services/aiService');

const scanLimiter = rateLimit({
  windowMs: 60 * 1000,  // 1 minute
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

// POST /api/plate-scanner/scan
router.post('/scan', scanLimiter, async (req, res) => {
  try {
    const { image, mediaType = 'image/jpeg' } = req.body;

    if (!image || typeof image !== 'string') {
      return res.status(400).json({ error: 'Απαιτείται εικόνα (base64).' });
    }

    // Basic size guard — reject if > ~4MB base64 (~3MB image)
    if (image.length > 4_000_000) {
      return res.status(413).json({ error: 'Η εικόνα είναι πολύ μεγάλη. Μέγιστο μέγεθος: 3MB.' });
    }

    const result = await callVisionAI(
      SYSTEM_PROMPT,
      'Analyze this food plate and estimate all macronutrients as accurately as possible.',
      image,
      mediaType,
    );

    // Handle "no food" response from AI
    if (result.error === 'no_food_detected' || !Array.isArray(result.foods) || result.foods.length === 0) {
      return res.status(422).json({ error: 'Δεν αναγνωρίστηκε φαγητό. Δοκίμασε ξανά με καλύτερο φωτισμό.' });
    }

    // Sanitize numbers
    const toInt = v => { const n = parseInt(v, 10); return isNaN(n) || n < 0 ? 0 : n; };
    result.foods = result.foods.map(f => ({
      name:     f.name     || 'Άγνωστο',
      nameEn:   f.nameEn   || '',
      emoji:    f.emoji    || '🍽️',
      portion:  f.portion  || '—',
      calories: toInt(f.calories),
      protein:  toInt(f.protein),
      carbs:    toInt(f.carbs),
      fat:      toInt(f.fat),
    }));
    result.totals = {
      calories: toInt(result.totals?.calories),
      protein:  toInt(result.totals?.protein),
      carbs:    toInt(result.totals?.carbs),
      fat:      toInt(result.totals?.fat),
      fiber:    toInt(result.totals?.fiber),
    };

    res.json(result);

  } catch (err) {
    console.error('[PlateScan]', err.message);
    res.status(500).json({ error: 'Σφάλμα ανάλυσης. Παρακαλώ δοκίμασε ξανά.' });
  }
});

module.exports = router;
