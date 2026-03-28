// Tracks why users regenerate plans + which A/B meal options they pick.
// Used to improve AI plan generation over time.
const mongoose = require('mongoose');

const mealPlanFeedbackSchema = new mongoose.Schema({
  userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  // "Why did you want a new plan?" — one of the preset reasons or free text
  reason:   { type: String, enum: ['different_recipes','lighter','cheaper','faster','more_variety','other'], default: 'other' },
  freeText: { type: String, default: '' },

  // Which A/B options the user picked for each meal slot in the previous plan
  choices: [{
    day:      { type: Number },
    mealType: { type: String },   // 'breakfast' | 'lunch' | 'dinner'
    chosen:   { type: String },   // 'a' | 'b'
    mealName: { type: String },
  }],

  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('MealPlanFeedback', mealPlanFeedbackSchema);
