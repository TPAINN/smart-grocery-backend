// routes/favorites.js — Recipe favorites API (persistent, offline-friendly)
// Supports scraped recipes (MongoDB ObjectId) and TheMealDB recipes (mealdbId string)
const express  = require('express');
const mongoose = require('mongoose');
const router   = express.Router();
const auth     = require('../middleware/authMiddleware');
const Favorite = require('../models/Favorite');
const Recipe   = require('../models/Recipe');

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

// ── GET /api/favorites — Get all user's favorites (scraped + mealdb) ─────────
router.get('/', auth, async (req, res) => {
  try {
    const favorites = await Favorite.find({ userId: req.userId })
      .sort({ addedAt: -1 })
      .lean();

    res.json({
      favorites: favorites.map(f => ({
        _id:        f.mealdbId ? `mealdb_${f.mealdbId}` : f.recipeId?.toString(),
        favoriteId: f._id,
        mealdbId:   f.mealdbId || null,
        addedAt:    f.addedAt,
        ...f.recipe,
      })),
    });
  } catch (err) {
    console.error('❌ GET /api/favorites error:', err.message);
    res.status(500).json({ message: err.message });
  }
});

// ── GET /api/favorites/ids — Get just the recipe IDs (lightweight, for syncing) ──
router.get('/ids', auth, async (req, res) => {
  try {
    const favorites = await Favorite.find({ userId: req.userId })
      .select('recipeId mealdbId addedAt')
      .sort({ addedAt: -1 })
      .lean();

    res.json({
      ids:       favorites.filter(f => f.recipeId).map(f => f.recipeId.toString()),
      mealdbIds: favorites.filter(f => f.mealdbId).map(f => f.mealdbId),
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── POST /api/favorites/mealdb/:mealdbId — Add MealDB recipe to favorites ────
router.post('/mealdb/:mealdbId', auth, async (req, res) => {
  try {
    const { mealdbId } = req.params;
    if (!mealdbId) return res.status(400).json({ message: 'Μη έγκυρο mealdbId' });

    const existing = await Favorite.findOne({ userId: req.userId, mealdbId });
    if (existing) return res.json({ message: 'Ήδη στα αγαπημένα', favorited: true });

    const { recipe } = req.body;
    await Favorite.create({ userId: req.userId, mealdbId, recipe: recipe || {} });
    res.json({ message: 'Προστέθηκε στα αγαπημένα', favorited: true });
  } catch (err) {
    if (err.code === 11000) return res.json({ message: 'Ήδη στα αγαπημένα', favorited: true });
    console.error('❌ POST /api/favorites/mealdb error:', err.message);
    res.status(500).json({ message: err.message });
  }
});

// ── DELETE /api/favorites/mealdb/:mealdbId — Remove MealDB recipe ────────────
router.delete('/mealdb/:mealdbId', auth, async (req, res) => {
  try {
    const { mealdbId } = req.params;
    await Favorite.deleteOne({ userId: req.userId, mealdbId });
    res.json({ message: 'Αφαιρέθηκε από τα αγαπημένα', favorited: false });
  } catch (err) {
    console.error('❌ DELETE /api/favorites/mealdb error:', err.message);
    res.status(500).json({ message: err.message });
  }
});

// ── POST /api/favorites/:recipeId — Add scraped recipe to favorites ───────────
router.post('/:recipeId', auth, async (req, res) => {
  try {
    const { recipeId } = req.params;
    if (!isValidId(recipeId)) {
      return res.status(400).json({ message: 'Μη έγκυρο recipeId' });
    }

    const existing = await Favorite.findOne({ userId: req.userId, recipeId });
    if (existing) return res.json({ message: 'Ήδη στα αγαπημένα', favorited: true });

    const recipe = await Recipe.findById(recipeId).lean();
    if (!recipe) return res.status(404).json({ message: 'Δεν βρέθηκε η συνταγή' });

    await Favorite.create({
      userId: req.userId,
      recipeId,
      recipe: {
        title:        recipe.title,
        titleEn:      recipe.titleEn,
        description:  recipe.description,
        image:        recipe.image,
        servings:     recipe.servings,
        time:         recipe.time,
        difficulty:   recipe.difficulty,
        calories:     recipe.calories,
        protein:      recipe.protein,
        carbs:        recipe.carbs,
        fat:          recipe.fat,
        fiber:        recipe.fiber,
        sugar:        recipe.sugar,
        isHealthy:    recipe.isHealthy,
        ingredients:  recipe.ingredients,
        instructions: recipe.instructions,
        tags:         recipe.tags,
        cuisine:      recipe.cuisine,
        category:     recipe.category,
        sourceApi:    recipe.sourceApi,
        url:          recipe.url,
      },
    });

    res.json({ message: 'Προστέθηκε στα αγαπημένα', favorited: true });
  } catch (err) {
    if (err.code === 11000) return res.json({ message: 'Ήδη στα αγαπημένα', favorited: true });
    console.error('❌ POST /api/favorites error:', err.message);
    res.status(500).json({ message: err.message });
  }
});

// ── DELETE /api/favorites/:recipeId — Remove scraped recipe ──────────────────
router.delete('/:recipeId', auth, async (req, res) => {
  try {
    const { recipeId } = req.params;
    if (!isValidId(recipeId)) {
      return res.status(400).json({ message: 'Μη έγκυρο recipeId' });
    }
    await Favorite.deleteOne({ userId: req.userId, recipeId });
    res.json({ message: 'Αφαιρέθηκε από τα αγαπημένα', favorited: false });
  } catch (err) {
    console.error('❌ DELETE /api/favorites error:', err.message);
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
