// routes/mealplan.js — AI Meal Planner powered by Google Gemini
const express = require('express');
const router  = express.Router();
const Product = require('../models/Product');

// ── Helpers ───────────────────────────────────────────────
const normalize = (text) =>
  (text || '').toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Find best price for an ingredient in the database
async function findBestPrice(ingredient) {
  const norm  = normalize(ingredient);
  const words = norm.split(/\s+/).filter(w => w.length > 2);
  if (!words.length) return null;

  // Try multi-word search first, then fall back to first keyword
  const queries = [
    words.map(w => ({ normalizedName: { $regex: escapeRegex(w), $options: 'i' } })),
    [{ normalizedName: { $regex: escapeRegex(words[0]), $options: 'i' } }],
  ];

  for (const andFilters of queries) {
    const results = await Product.find({ $and: andFilters })
      .sort({ price: 1 })
      .limit(3)
      .lean();
    if (results.length > 0) {
      return {
        name:  results[0].name,
        price: results[0].price,
        store: results[0].supermarket,
        unit:  results[0].pricePerUnit || null,
      };
    }
  }
  return null;
}

// ── Gemini Call ───────────────────────────────────────────
async function callGemini(prompt) {
  const GEMINI_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_KEY) throw new Error('Missing GEMINI_API_KEY');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`;

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 8192,
      responseMimeType: 'application/json',
    },
  };

  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini error ${res.status}: ${err}`);
  }

  const data   = await res.json();
  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
  return JSON.parse(rawText.replace(/```json|```/g, '').trim());
}

// ── Build the mega-prompt ─────────────────────────────────
function buildPrompt({ persons, budget, restrictions, goal, days }) {
  const restrText = restrictions?.length ? restrictions.join(', ') : 'Κανένας';
  const goalMap = {
    balanced:    'ισορροπημένη διατροφή',
    weightloss:  'απώλεια βάρους (χαμηλές θερμίδες, υψηλή πρωτεΐνη)',
    muscle:      'μυϊκή ανάπτυξη (υψηλή πρωτεΐνη, υψηλές θερμίδες)',
    budget:      'οικονομική διατροφή (χαμηλό κόστος)',
  };
  const goalText = goalMap[goal] || 'ισορροπημένη διατροφή';

  return `
Είσαι ειδικός διατροφολόγος. Δημιούργησε ένα εβδομαδιαίο πρόγραμμα διατροφής για ${days} ημέρες.

ΠΑΡΑΜΕΤΡΟΙ:
- Άτομα: ${persons}
- Εβδομαδιαίο budget: ${budget}€ (σύνολο για ψώνια, όχι ανά άτομο)
- Διατροφικοί περιορισμοί: ${restrText}
- Στόχος: ${goalText}

ΟΔΗΓΙΕΣ:
1. Κάθε ημέρα έχει 3 γεύματα: πρωινό, μεσημεριανό, βραδινό
2. Τα υλικά (ingredients) να είναι ΑΠΛΑ ελληνικά ονόματα για σούπερ μάρκετ (π.χ. "γάλα", "κοτόπουλο", "ντομάτες")
3. Κράτα τα macros ρεαλιστικά ανά γεύμα
4. Τα ελληνικά ονόματα συνταγών να είναι σωστά

Επίστρεψε ΜΟΝΟ JSON με αυτή την ακριβή δομή (χωρίς markdown):
{
  "plan": [
    {
      "day": 1,
      "dayName": "Δευτέρα",
      "meals": {
        "breakfast": {
          "name": "Ονομασία πρωινού",
          "description": "Σύντομη περιγραφή",
          "time": 10,
          "macros": { "kcal": 350, "protein": 15, "carbs": 45, "fat": 10 },
          "ingredients": ["υλικό 1", "υλικό 2", "υλικό 3"]
        },
        "lunch": {
          "name": "Ονομασία μεσημεριανού",
          "description": "Σύντομη περιγραφή",
          "time": 25,
          "macros": { "kcal": 550, "protein": 35, "carbs": 55, "fat": 18 },
          "ingredients": ["υλικό 1", "υλικό 2"]
        },
        "dinner": {
          "name": "Ονομασία βραδινού",
          "description": "Σύντομη περιγραφή",
          "time": 30,
          "macros": { "kcal": 480, "protein": 30, "carbs": 40, "fat": 20 },
          "ingredients": ["υλικό 1", "υλικό 2"]
        }
      },
      "dayMacros": { "kcal": 1380, "protein": 80, "carbs": 140, "fat": 48 }
    }
  ],
  "summary": {
    "totalDays": ${days},
    "avgKcalPerDay": 1400,
    "avgProteinPerDay": 85,
    "estimatedIngredients": ["γάλα", "αυγά", "κοτόπουλο", "ρύζι", "ντομάτες", "λάδι", "τυρί", "ψωμί", "γιαούρτι", "μακαρόνια"]
  }
}
`;
}

// ── POST /api/meal-plan ───────────────────────────────────
router.post('/', async (req, res) => {
  const { persons = 2, budget = 80, restrictions = [], goal = 'balanced', days = 7 } = req.body;

  try {
    // 1. Call Gemini for meal plan
    console.log('🤖 Gemini Meal Plan generation started...');
    const prompt   = buildPrompt({ persons, budget, restrictions, goal, days });
    const planData = await callGemini(prompt);

    if (!planData?.plan?.length) {
      return res.status(500).json({ message: 'Το AI δεν επέστρεψε πλάνο.' });
    }

    // 2. Collect ALL unique ingredients from the plan
    const allIngredients = new Set();
    planData.plan.forEach(day => {
      Object.values(day.meals).forEach(meal => {
        (meal.ingredients || []).forEach(ing => allIngredients.add(ing.toLowerCase().trim()));
      });
    });
    // Also check the summary list
    (planData.summary?.estimatedIngredients || []).forEach(ing =>
      allIngredients.add(ing.toLowerCase().trim())
    );

    console.log(`🛒 Looking up prices for ${allIngredients.size} ingredients...`);

    // 3. Parallel price lookup for all ingredients
    const priceMap = {};
    await Promise.all(
      [...allIngredients].map(async (ing) => {
        const result = await findBestPrice(ing);
        if (result) priceMap[ing] = result;
      })
    );

    // 4. Build the final shopping list (deduplicated, with prices)
    const shoppingList = [...allIngredients].map(ing => ({
      ingredient: ing,
      found:      !!priceMap[ing],
      price:      priceMap[ing]?.price || null,
      store:      priceMap[ing]?.store || null,
      productName: priceMap[ing]?.name || ing,
      unit:       priceMap[ing]?.unit || null,
    })).sort((a, b) => (a.found === b.found ? 0 : a.found ? -1 : 1));

    // 5. Enrich plan with per-ingredient prices
    const enrichedPlan = planData.plan.map(day => ({
      ...day,
      meals: Object.fromEntries(
        Object.entries(day.meals).map(([mealType, meal]) => [
          mealType,
          {
            ...meal,
            ingredients: (meal.ingredients || []).map(ing => ({
              name:  ing,
              found: !!priceMap[ing.toLowerCase().trim()],
              price: priceMap[ing.toLowerCase().trim()]?.price || null,
              store: priceMap[ing.toLowerCase().trim()]?.store || null,
            })),
          },
        ])
      ),
    }));

    // 6. Calculate estimated cost
    const totalEstimatedCost = shoppingList
      .filter(i => i.found)
      .reduce((sum, i) => sum + (i.price || 0), 0);

    const foundCount = shoppingList.filter(i => i.found).length;

    res.json({
      plan:         enrichedPlan,
      summary:      planData.summary,
      shoppingList,
      stats: {
        totalIngredients: allIngredients.size,
        foundInDB:        foundCount,
        notFound:         allIngredients.size - foundCount,
        estimatedCost:    Math.round(totalEstimatedCost * 100) / 100,
        coveragePercent:  Math.round((foundCount / allIngredients.size) * 100),
      },
    });

  } catch (err) {
    console.error('❌ Meal Plan Error:', err.message);
    res.status(500).json({ message: `Σφάλμα AI: ${err.message}` });
  }
});

module.exports = router;