// routes/mealplan.js — Premium AI Meal Planner
// Uses aiService.js → Gemini 2.0 Flash (primary) + Groq (fallback) + Bytez (emergency)
const express = require('express');
const router  = express.Router();
const MealPlanFeedback  = require('../models/MealPlanFeedback');
const { callAI } = require('../services/aiService');
const authMiddleware = require('../middleware/authMiddleware');
const requirePremiumAccess = require('../middleware/requirePremiumAccess');
const { findBestPrice, extractGrams, estimateIngredientCost } = require('../services/mealPlanPricing');
const { SYSTEM_PROMPT, buildPrompt } = require('../services/mealPlanPrompt');

router.post('/', authMiddleware, requirePremiumAccess, async (req, res) => {
  const {
    persons=2, budget=80, restrictions=[], goal='balanced', days=7,
    tdee=null, zigzag=null, gender='male', age=30, weight=75, height=175, activityLevel='moderate',
    macroRatios={ protein:30, carbs:40, fat:30 }, weather=null,
  } = req.body;

  if (!process.env.ANTHROPIC_API_KEY && !process.env.GEMINI_API_KEY && !process.env.GROQ_API_KEY && !process.env.BYTEZ_API_KEY)
    return res.status(500).json({ message: 'Δεν βρέθηκε κανένα AI API key στο .env' });

  // Normalise macroRatios so they always sum to 100
  const mrTotal = (macroRatios.protein||30) + (macroRatios.carbs||40) + (macroRatios.fat||30);
  const normMR = {
    protein: Math.round((macroRatios.protein||30) / mrTotal * 100),
    carbs:   Math.round((macroRatios.carbs||40)   / mrTotal * 100),
    fat:     Math.round((macroRatios.fat||30)      / mrTotal * 100),
  };

  // Fix any rounding drift
  const diff = 100 - normMR.protein - normMR.carbs - normMR.fat;
  normMR.carbs += diff;

  try {
    const planData = await callAI(
      SYSTEM_PROMPT,
      buildPrompt({ persons, budget, restrictions, goal, days, tdee, zigzag, gender, age, weight, height, activityLevel, macroRatios: normMR, weather })
    );

    if (!planData?.plan?.length)
      return res.status(500).json({ message: 'Το AI δεν επέστρεψε πλάνο.' });

    // ── Server-side macro correction: enforce kcal = P×4 + C×4 + F×9 ────────
    planData.plan = planData.plan.map(day => ({
      ...day,
      meals: Object.fromEntries(
        Object.entries(day.meals).map(([mealType, meal]) => {
          if (meal?.macros) {
            const p = meal.macros.protein || 0;
            const c = meal.macros.carbs   || 0;
            const f = meal.macros.fat     || 0;
            meal.macros.kcal = Math.round(p * 4 + c * 4 + f * 9);
          }
          return [mealType, meal];
        })
      ),
    }));

    // Recompute dayMacros from corrected meal macros — exclude _alt variants (they are alternatives, not additions)
    planData.plan = planData.plan.map(day => {
      const mainMeals = Object.entries(day.meals)
        .filter(([k]) => !k.endsWith('_alt'))
        .map(([, m]) => m)
        .filter(Boolean);
      day.dayMacros = {
        kcal:    mainMeals.reduce((s, m) => s + (m.macros?.kcal    || 0), 0),
        protein: mainMeals.reduce((s, m) => s + (m.macros?.protein || 0), 0),
        carbs:   mainMeals.reduce((s, m) => s + (m.macros?.carbs   || 0), 0),
        fat:     mainMeals.reduce((s, m) => s + (m.macros?.fat     || 0), 0),
      };
      return day;
    });
    // ── End macro correction ──────────────────────────────────────────────────

    // Collect all unique ingredients with their quantities
    const ingredientMap = new Map(); // name → { totalGrams, rawNames[] }
    planData.plan.forEach(d =>
      Object.values(d.meals).forEach(m => (m.ingredients||[]).forEach(i => {
        const rawName = typeof i === 'string' ? i : i;
        const cleanName = rawName.replace(/^\d+[γg]ρ?\s*/i,'').split('(')[0].trim().toLowerCase();
        const grams = extractGrams(rawName);
        if (!ingredientMap.has(cleanName)) {
          ingredientMap.set(cleanName, { totalGrams: 0, rawNames: [] });
        }
        const entry = ingredientMap.get(cleanName);
        if (grams) entry.totalGrams += grams;
        entry.rawNames.push(rawName);
      }))
    );
    (planData.summary?.estimatedIngredients||[]).forEach(i => {
      const key = i.toLowerCase().trim();
      if (!ingredientMap.has(key)) ingredientMap.set(key, { totalGrams: 0, rawNames: [i] });
    });

    const priceMap = {};
    await Promise.all([...ingredientMap.keys()].map(async i => { const r = await findBestPrice(i); if(r) priceMap[i]=r; }));

    const shoppingList = [...ingredientMap.entries()].map(([name, data]) => {
      const product = priceMap[name];
      const estimatedPrice = product
        ? (data.totalGrams > 0
            ? estimateIngredientCost(product.price, product.unit, data.totalGrams)
            : product.price)
        : null;
      return {
        ingredient: name, found: !!product, price: estimatedPrice,
        store: product?.store || null, productName: product?.name || name, unit: product?.unit || null,
        totalGrams: data.totalGrams || null,
      };
    }).sort((a,b) => a.found===b.found ? 0 : a.found ? -1 : 1);

    const enrichedPlan = planData.plan.map(d => ({
      ...d,
      snacks: d.snacks || { morning: 'Φρούτο εποχής', afternoon: 'Χούφτα ξηρούς καρπούς' },
      meals: Object.fromEntries(Object.entries(d.meals).map(([t,m]) => [t, {
        ...m,
        ingredients:(m.ingredients||[]).map(i => {
          const rawName = typeof i === 'string' ? i : i.name;
          const cleanName = rawName.replace(/^\d+[γg]ρ?\s*/i,'').split('(')[0].trim().toLowerCase();
          const grams = extractGrams(rawName);
          const product = priceMap[cleanName];
          const estPrice = product && grams
            ? estimateIngredientCost(product.price, product.unit, grams)
            : product?.price || null;
          return {
            name: rawName,
            found: !!product,
            price: estPrice,
            store: product?.store || null,
          };
        }),
      }])),
    }));

    const found = shoppingList.filter(i => i.found).length;
    const cost  = shoppingList.filter(i => i.found).reduce((s,i) => s+(i.price||0), 0);

    // Compute achieved macro ratio from plan averages
    const avgDay = planData.plan.reduce((acc, d) => {
      acc.kcal    += d.dayMacros?.kcal    || 0;
      acc.protein += d.dayMacros?.protein || 0;
      acc.carbs   += d.dayMacros?.carbs   || 0;
      acc.fat     += d.dayMacros?.fat     || 0;
      return acc;
    }, { kcal:0, protein:0, carbs:0, fat:0 });
    const n = planData.plan.length || 1;
    const avgKcal = Math.round(avgDay.kcal / n);
    const achievedRatio = avgKcal > 0 ? {
      protein: Math.round((avgDay.protein / n * 4) / (avgDay.kcal / n) * 100),
      carbs:   Math.round((avgDay.carbs   / n * 4) / (avgDay.kcal / n) * 100),
      fat:     Math.round((avgDay.fat     / n * 9) / (avgDay.kcal / n) * 100),
    } : normMR;

    res.json({
      plan: enrichedPlan,
      summary: { ...planData.summary, macroRatioAchieved: achievedRatio, avgKcalPerDay: avgKcal },
      shoppingList,
      macroRatioTarget: normMR,
      stats: {
        totalIngredients: ingredientMap.size,
        foundInDB: found,
        notFound: ingredientMap.size - found,
        estimatedCost: Math.round(cost*100)/100,
        coveragePercent: Math.round(found/ingredientMap.size*100),
      },
    });
  } catch(err) {
    console.error('❌ Meal Plan:', err.message);
    res.status(500).json({ message: `Σφάλμα AI: ${err.message}` });
  }
});

// Save why the user asked for a new plan (feedback before regeneration)
router.post('/feedback', authMiddleware, requirePremiumAccess, async (req, res) => {
  try {
    const { reason = 'other', freeText = '', choices = [] } = req.body;
    const fb = await MealPlanFeedback.create({
      userId: req.user._id || req.user.id,
      reason,
      freeText,
      choices,
    });
    res.json({ ok: true, id: fb._id });
  } catch (err) {
    console.error('❌ Feedback save:', err.message);
    res.status(500).json({ message: 'Αποτυχία αποθήκευσης feedback.' });
  }
});

// Save which A/B option the user picked per meal slot
router.post('/choices', authMiddleware, requirePremiumAccess, async (req, res) => {
  try {
    const { choices = [] } = req.body; // [{ day, mealType, chosen, mealName }]
    if (!choices.length) return res.json({ ok: true });

    // Upsert into the most recent feedback doc for this user, or create a bare one
    const existing = await MealPlanFeedback
      .findOne({ userId: req.user._id || req.user.id })
      .sort({ createdAt: -1 });

    if (existing) {
      // Merge choices — overwrite same day+mealType, append new ones
      const map = new Map(existing.choices.map(c => [`${c.day}_${c.mealType}`, c]));
      choices.forEach(c => map.set(`${c.day}_${c.mealType}`, c));
      existing.choices = [...map.values()];
      await existing.save();
      return res.json({ ok: true, id: existing._id });
    }

    const fb = await MealPlanFeedback.create({
      userId: req.user._id || req.user.id,
      reason: 'other',
      choices,
    });
    res.json({ ok: true, id: fb._id });
  } catch (err) {
    console.error('❌ Choices save:', err.message);
    res.status(500).json({ message: 'Αποτυχία αποθήκευσης επιλογών.' });
  }
});

module.exports = router;
