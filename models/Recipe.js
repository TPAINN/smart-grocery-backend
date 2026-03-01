const mongoose = require('mongoose');

const recipeSchema = new mongoose.Schema({
    title: { type: String, required: true },
    chef: { type: String, default: 'Άκης Πετρετζίκης' },
    image: { type: String },
    time: { type: Number },
    calories: { type: Number },
    cost: { type: Number },
    isHealthy: { type: Boolean },
    isBudget: { type: Boolean },
    ovenTemp: { type: Number, default: 180 },
    ovenTime: { type: Number, default: 30 },
    ingredients:[{ type: String }],
    instructions: [{ type: String }], // 🟢 ΝΕΟ: Οι οδηγίες βήμα-βήμα
    url: { type: String, unique: true }
}, { timestamps: true });

module.exports = mongoose.model('Recipe', recipeSchema);