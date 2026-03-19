// routes/favorites.js — Recipe favorites API (persistent, offline-friendly)
const express  = require('express');
const mongoose = require('mongoose');
const router   = express.Router();
const auth     = require('../middleware/authMiddleware');
const Favorite = require('../models/Favorite');
const Recipe   = require('../models/Recipe');

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

// ── GET /api/favorites — Get all user's favorites (with full recipe data) ────
router.get('/', auth, async (req, res) => {
  try {
    const favorites = await Favorite.find({ userId: req.user.id })
      .sort({ addedAt: -1 })
      .lean();

    res.json({
      favorites: favorites.map(f => ({
        _id:        f.recipeId,
        favoriteId: f._id,
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
    const favorites = await Favorite.find({ userId: req.user.id })
      .select('recipeId addedAt')
      .sort({ addedAt: -1 })
      .lean();

    res.json({
      ids: favorites.map(f => f.recipeId.toString()),
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── POST /api/favorites/:recipeId — Add recipe to favorites ─────────────────
router.post('/:recipeId', auth, async (req, res) => {
  try {
    const { recipeId } = req.params;
    if (!isValidId(recipeId)) {
      return res.status(400).json({ message: 'Μη έγκυρο recipeId' });
    }

    // Check if already favorited
    const existing = await Favorite.findOne({ userId: req.user.id, recipeId });
    if (existing) {
      return res.json({ message: 'Ήδη στα αγαπημένα', favorited: true });
    }

    // Get full recipe data for offline snapshot
    const recipe = await Recipe.findById(recipeId).lean();
    if (!recipe) {
      return res.status(404).json({ message: 'Δεν βρέθηκε η συνταγή' });
    }

    await Favorite.create({
      userId:   req.user.id,
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
    if (err.code === 11000) {
      return res.json({ message: 'Ήδη στα αγαπημένα', favorited: true });
    }
    console.error('❌ POST /api/favorites error:', err.message);
    res.status(500).json({ message: err.message });
  }
});

// ── DELETE /api/favorites/:recipeId — Remove from favorites ─────────────────
router.delete('/:recipeId', auth, async (req, res) => {
  try {
    const { recipeId } = req.params;
    if (!isValidId(recipeId)) {
      return res.status(400).json({ message: 'Μη έγκυρο recipeId' });
    }
    await Favorite.deleteOne({ userId: req.user.id, recipeId });
    res.json({ message: 'Αφαιρέθηκε από τα αγαπημένα', favorited: false });
  } catch (err) {
    console.error('❌ DELETE /api/favorites error:', err.message);
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
