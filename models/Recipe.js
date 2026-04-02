// models/Recipe.js — Enhanced Schema for Premium Recipe Tab
const mongoose = require('mongoose');

const recipeSchema = new mongoose.Schema({
  // ── Core ────────────────────────────────────────────────────
  title:        { type: String, required: true },
  titleEn:      { type: String },                       // Original English title (for re-translation)
  description:  { type: String, default: '' },           // Short description in Greek
  image:        { type: String },
  servings:     { type: Number, default: 4 },
  time:         { type: Number },                        // Prep+cook in minutes
  difficulty:   { type: String, enum: ['Εύκολη', 'Μέτρια', 'Δύσκολη'], default: 'Μέτρια' },

  // ── Nutrition (per serving) ─────────────────────────────────
  calories:     { type: Number },
  protein:      { type: Number },
  carbs:        { type: Number },
  fat:          { type: Number },
  fiber:        { type: Number },
  sugar:        { type: Number },
  isHealthy:    { type: Boolean, default: true },

  // ── Content ─────────────────────────────────────────────────
  ingredients:  [{ type: String }],                      // In Greek
  instructions: [{ type: String }],                      // In Greek (steps)

  // ── Categorization ──────────────────────────────────────────
  tags:         [{ type: String }],                      // e.g. ['breakfast','high-protein','quick']
  cuisine:      { type: String, default: 'Διεθνής' },    // e.g. 'Ελληνική', 'Ιταλική', 'Ασιατική'
  category:     { type: String, default: 'Κυρίως' },     // Κυρίως, Σαλάτες, Σούπες, Σνακ, Επιδόρπια, Πρωινό

  // ── Source tracking ─────────────────────────────────────────
  sourceApi:    { type: String, default: 'spoonacular' },
  sourceId:     { type: Number },                         // Spoonacular recipe ID
  url:          { type: String, unique: true, sparse: true },
  translated:   { type: Boolean, default: false },

}, { timestamps: true });

// Indexes for fast queries
recipeSchema.index({ category: 1, createdAt: -1 });
recipeSchema.index({ tags: 1 });
recipeSchema.index({ sourceId: 1 }, { unique: true, sparse: true });
// Full-text search index — supports Greek, typo-tolerant via $text operator
recipeSchema.index(
  { title: 'text', ingredients: 'text', cuisine: 'text', description: 'text' },
  { weights: { title: 10, ingredients: 5, cuisine: 3, description: 1 }, name: 'recipe_fulltext' }
);

module.exports = mongoose.model('Recipe', recipeSchema);