const express = require('express');
const router = express.Router();
const Recipe = require('../models/Recipe');

// GET /api/recipes
router.get('/', async (req, res) => {
    try {
        const recipes = await Recipe.find().sort({ createdAt: -1 });
        res.json(recipes);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

module.exports = router;