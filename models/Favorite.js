// models/Favorite.js — User recipe favorites (persisted, offline-friendly)
// Supports both MongoDB-scraped recipes (recipeId) and TheMealDB recipes (mealdbId)
const mongoose = require('mongoose');

const favoriteSchema = new mongoose.Schema({
  userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  // For scraped recipes (MongoDB ObjectId)
  recipeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Recipe', sparse: true },
  // For TheMealDB recipes (e.g. "52772")
  mealdbId: { type: String },
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
    youtube:      String,
  },
  addedAt: { type: Date, default: Date.now },
});

// One user can favorite a scraped recipe only once
favoriteSchema.index({ userId: 1, recipeId: 1 }, { unique: true, sparse: true });
// One user can favorite a mealdb recipe only once
favoriteSchema.index({ userId: 1, mealdbId: 1 }, { unique: true, sparse: true });
favoriteSchema.index({ userId: 1, addedAt: -1 });

module.exports = mongoose.model('Favorite', favoriteSchema);
