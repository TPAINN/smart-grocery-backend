// routes/recipes.js — Enhanced Recipe API
const express = require('express');
const router  = express.Router();
const Recipe  = require('../models/Recipe');
const { populateRecipes, seedRecipes } = require('../services/recipeScraper');

// ── GET /api/recipes — Paginated + filterable recipe list ─────────────────────
router.get('/', async (req, res) => {
  try {
    const page     = Math.max(1, parseInt(req.query.page)  || 1);
    const limit    = Math.min(50,  parseInt(req.query.limit) || 20);
    const category = req.query.category || '';     // e.g. 'Κυρίως', 'Σαλάτες'
    const cuisine  = req.query.cuisine  || '';     // e.g. 'Ελληνική'
    const tag      = req.query.tag      || '';     // e.g. 'high-protein'
    const search   = req.query.search   || '';     // text search
    const sort     = req.query.sort     || 'newest'; // newest, popular, quick, protein

    // Build filter
    const filter = {};
    if (category) filter.category = category;
    if (cuisine)  filter.cuisine  = cuisine;
    if (tag)      filter.tags     = tag;
    if (search) {
      // Use text index or regex fallback
      filter.$or = [
        { title: { $regex: search, $options: 'i' } },
        { ingredients: { $regex: search, $options: 'i' } },
        { cuisine: { $regex: search, $options: 'i' } },
      ];
    }

    // Build sort
    let sortObj = { createdAt: -1 };
    if (sort === 'quick')   sortObj = { time: 1 };
    if (sort === 'protein') sortObj = { protein: -1 };
    if (sort === 'calories') sortObj = { calories: 1 };
    if (sort === 'popular') sortObj = { protein: -1, calories: 1 }; // proxy for popularity

    const [recipes, total] = await Promise.all([
      Recipe.find(filter)
        .sort(sortObj)
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Recipe.countDocuments(filter),
    ]);

    res.json({
      recipes,
      total,
      page,
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error('❌ GET /api/recipes error:', err.message);
    res.status(500).json({ message: err.message });
  }
});

// ── GET /api/recipes/categories — Get available categories with counts ────────
router.get('/categories', async (req, res) => {
  try {
    const categories = await Recipe.aggregate([
      { $group: { _id: '$category', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    const cuisines = await Recipe.aggregate([
      { $group: { _id: '$cuisine', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    res.json({ categories, cuisines, total: await Recipe.countDocuments() });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── GET /api/recipes/:id — Single recipe detail ──────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const recipe = await Recipe.findById(req.params.id).lean();
    if (!recipe) return res.status(404).json({ message: 'Δεν βρέθηκε η συνταγή' });
    res.json(recipe);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── POST /api/recipes/seed — Trigger recipe seeding (admin, secret-protected) ─
router.post('/seed', async (req, res) => {
  if (!process.env.CRON_SECRET || req.query.secret !== process.env.CRON_SECRET) {
    return res.status(403).json({ message: 'Απαγορεύεται.' });
  }

  // Run async, return immediately
  res.json({ message: '🌱 Seeding started in background...' });

  try {
    const result = await seedRecipes();
    console.log('🌱 Seed result:', result);
  } catch (err) {
    console.error('❌ Seed error:', err);
  }
});

// ── POST /api/recipes/fetch — Fetch specific recipes (admin) ─────────────────
router.post('/fetch', async (req, res) => {
  if (!process.env.CRON_SECRET || req.query.secret !== process.env.CRON_SECRET) {
    return res.status(403).json({ message: 'Απαγορεύεται.' });
  }

  const { query, cuisine, diet, count } = req.body || {};
  res.json({ message: '👨‍🍳 Fetching started...' });

  try {
    const result = await populateRecipes({ query, cuisine, diet, count });
    console.log('👨‍🍳 Fetch result:', result);
  } catch (err) {
    console.error('❌ Fetch error:', err);
  }
});

module.exports = router;