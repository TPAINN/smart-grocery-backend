// routes/recipes.js
const express = require('express');
const router  = express.Router();
const Recipe  = require('../models/Recipe');

router.get('/', async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(50,  parseInt(req.query.limit) || 20);
    const recipes = await Recipe.find()
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();
    const total = await Recipe.countDocuments();
    res.json({ recipes, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;