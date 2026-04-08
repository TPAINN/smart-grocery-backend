// routes/recipes.js — Enhanced Recipe API
const express = require('express');
const router  = express.Router();
const Recipe  = require('../models/Recipe');
const { populateRecipes, seedRecipes } = require('../services/recipeScraper');
const { scrapeWebRecipes, SITES }      = require('../services/webRecipeScraper');

// ── GET /api/recipes — Paginated + filterable recipe list ─────────────────────
router.get('/', async (req, res) => {
  try {
    const page     = Math.max(1, parseInt(req.query.page)  || 1);
    const limit    = Math.min(50,  parseInt(req.query.limit) || 20);
    const category = req.query.category || '';
    const cuisine  = req.query.cuisine  || '';
    const tag      = req.query.tag      || '';
    const source   = req.query.source   || '';
    const search   = req.query.search   || '';
    const sort     = req.query.sort     || 'newest';
    const hasMacros = req.query.hasMacros === 'true';

    const filter = { 'ingredients.0': { $exists: true } };
    if (category)  filter.category  = category;
    if (cuisine)   filter.cuisine   = cuisine;
    if (tag)       filter.tags      = tag;
    if (source)    filter.sourceApi = source;
    if (hasMacros) filter.calories  = { $ne: null };
    if (search) {
      // Prefer full-text search (weighted, faster) — fall back to regex for short queries
      if (search.length >= 2) {
        filter.$text = { $search: search };
      } else {
        filter.$or = [
          { title:       { $regex: search, $options: 'i' } },
          { ingredients: { $regex: search, $options: 'i' } },
        ];
      }
    }

    let sortObj = { createdAt: -1 };
    if (sort === 'quick')    sortObj = { time: 1 };
    if (sort === 'protein')  sortObj = { protein: -1 };
    if (sort === 'calories') sortObj = { calories: 1 };
    if (sort === 'popular')  sortObj = { protein: -1, calories: 1 };
    // When full-text searching, rank by relevance score first
    if (filter.$text) sortObj = { score: { $meta: 'textScore' }, ...sortObj };

    const [recipes, total] = await Promise.all([
      Recipe.find(filter, filter.$text ? { score: { $meta: 'textScore' } } : {})
        .select('-__v')
        .sort(sortObj).skip((page - 1) * limit).limit(limit).lean(),
      Recipe.countDocuments(filter),
    ]);

    res.json({ recipes, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    console.error('❌ GET /api/recipes error:', err.message);
    res.status(500).json({ message: 'Σφάλμα φόρτωσης συνταγών.' });
  }
});

// ── GET /api/recipes/categories ───────────────────────────────────────────────
router.get('/categories', async (req, res) => {
  try {
    const [categories, cuisines, total] = await Promise.all([
      Recipe.aggregate([{ $group: { _id: '$category', count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
      Recipe.aggregate([{ $group: { _id: '$cuisine',  count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
      Recipe.countDocuments(),
    ]);
    res.json({ categories, cuisines, total });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── GET /api/recipes/sources — MUST be before /:id ───────────────────────────
router.get('/sources', async (req, res) => {
  try {
    const counts = await Recipe.aggregate([
      { $group: { _id: '$sourceApi', count: { $sum: 1 }, latest: { $max: '$createdAt' } } },
      { $sort: { count: -1 } },
    ]);
    const sourceLabels = {
      spoonacular: 'Spoonacular API',
      akis:        'Άκης Πετρετζίκης',
      panos:       'Πάνος Ιωαννίδης',
      gymbeam:     'GymBeam',
      nutriroots:  'NutriRoots',
    };
    res.json({
      sources: counts.map(c => ({ key: c._id, label: sourceLabels[c._id] || c._id, count: c.count, latest: c.latest })),
      availableSites: Object.entries(SITES).map(([key, cfg]) => ({ key, label: cfg.label, maxRecipes: cfg.maxRecipes })),
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── POST /api/recipes/estimate-macros — AI nutrition per serving ──────────────
// Public endpoint — rate limited at server level
// Body: { title, ingredients[], servings }
router.post('/estimate-macros', async (req, res) => {
  const { title = '', ingredients = [], servings = 4 } = req.body;

  if (!Array.isArray(ingredients) || ingredients.length === 0) {
    return res.status(400).json({ message: 'Χρειάζονται τουλάχιστον 1 υλικό.' });
  }

  try {
    const { callAI } = require('../services/aiService');

    const systemPrompt =
`You are a certified nutritionist. Given a recipe name, its ingredients and servings count, calculate the NUTRITIONAL VALUES PER SINGLE SERVING.
Use USDA / standard nutritional databases. Account for typical cooking losses (water evaporation, fat render-off).
Respond ONLY with valid JSON — no markdown, no explanation:
{"calories":NUMBER,"protein":NUMBER,"carbs":NUMBER,"fat":NUMBER,"fiber":NUMBER,"sugar":NUMBER}
All values are non-negative integers (kcal for calories, grams for everything else), per serving.`;

    const lines = ingredients.slice(0, 30).map((ing, i) => `${i + 1}. ${ing}`).join('\n');
    const userPrompt =
`Recipe: "${title}"
Servings: ${servings}
Ingredients:
${lines}

Respond with macros PER SINGLE SERVING (divide totals by ${servings}).`;

    const result = await callAI(systemPrompt, userPrompt);

    const safe = v => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= 0 ? Math.min(n, 9999) : null; };

    res.json({
      calories: safe(result.calories),
      protein:  safe(result.protein),
      carbs:    safe(result.carbs),
      fat:      safe(result.fat),
      fiber:    safe(result.fiber),
      sugar:    safe(result.sugar),
      estimated: true,
      servings,
    });
  } catch (err) {
    console.error('❌ Macro estimation error:', err.message);
    res.status(503).json({ message: 'Υπηρεσία AI μη διαθέσιμη αυτή τη στιγμή.' });
  }
});

// ── GET /api/recipes/:id — Single recipe detail (MUST be after named routes) ──
router.get('/:id', async (req, res) => {
  try {
    const recipe = await Recipe.findById(req.params.id).lean();
    if (!recipe) return res.status(404).json({ message: 'Δεν βρέθηκε η συνταγή.' });
    res.json(recipe);
  } catch (err) {
    res.status(500).json({ message: 'Σφάλμα ανάκτησης συνταγής.' });
  }
});

// ── POST /api/recipes/seed — Admin ────────────────────────────────────────────
router.post('/seed', async (req, res) => {
  if (!process.env.CRON_SECRET || req.query.secret !== process.env.CRON_SECRET)
    return res.status(403).json({ message: 'Απαγορεύεται.' });
  res.json({ message: '🌱 Seeding started in background...' });
  try { await seedRecipes(); } catch (err) { console.error('❌ Seed error:', err); }
});

// ── POST /api/recipes/fetch — Admin ───────────────────────────────────────────
router.post('/fetch', async (req, res) => {
  if (!process.env.CRON_SECRET || req.query.secret !== process.env.CRON_SECRET)
    return res.status(403).json({ message: 'Απαγορεύεται.' });
  const { query, cuisine, diet, count } = req.body || {};
  res.json({ message: '👨‍🍳 Fetching started...' });
  try { await populateRecipes({ query, cuisine, diet, count }); } catch (err) { console.error('❌ Fetch error:', err); }
});

// ── POST /api/recipes/scrape-web — Admin ──────────────────────────────────────
router.post('/scrape-web', async (req, res) => {
  if (!process.env.CRON_SECRET || req.query.secret !== process.env.CRON_SECRET)
    return res.status(403).json({ message: 'Απαγορεύεται.' });
  const site = req.body?.site || 'all';
  res.json({ message: `🍳 Web scraping started for: ${site}` });
  try { await scrapeWebRecipes(site); } catch (err) { console.error('❌ Web scrape error:', err); }
});

module.exports = router;
