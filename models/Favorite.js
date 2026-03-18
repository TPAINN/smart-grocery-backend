// models/Favorite.js — User recipe favorites (persisted, offline-friendly)
const mongoose = require('mongoose');

const favoriteSchema = new mongoose.Schema({
  userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  recipeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Recipe', required: true },
  // Store full recipe snapshot for offline access
  recipe: {
    title:        String,
    titleEn:      String,
    description:  String,
    image:        String,
    servings:     Number,
    time:         Number,
    difficulty:   String,
    calories:     Number,
    protein:      Number,
    carbs:        Number,
    fat:          Number,
    fiber:        Number,
    sugar:        Number,
    isHealthy:    Boolean,
    ingredients:  [String],
    instructions: [String],
    tags:         [String],
    cuisine:      String,
    category:     String,
    sourceApi:    String,
    url:          String,
  },
  addedAt: { type: Date, default: Date.now },
});

// One user can favorite a recipe only once
favoriteSchema.index({ userId: 1, recipeId: 1 }, { unique: true });
favoriteSchema.index({ userId: 1, addedAt: -1 });

module.exports = mongoose.model('Favorite', favoriteSchema);
