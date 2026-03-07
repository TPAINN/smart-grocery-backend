const mongoose = require('mongoose');

const recipeSchema = new mongoose.Schema({
    title: { type: String, required: true },
    image: { type: String },
    time: { type: Number }, // Χρόνος προετοιμασίας σε λεπτά
    calories: { type: Number },
    protein: { type: Number }, // Γραμμάρια πρωτεΐνης
    carbs: { type: Number },   // Γραμμάρια υδατανθράκων
    fat: { type: Number },     // Γραμμάρια λιπαρών
    isHealthy: { type: Boolean, default: true },
    ingredients: [{ type: String }],
    instructions: [{ type: String }],
    tags: [{ type: String }],
    url: { type: String, unique: true } // Για να μην διπλοεγγράφουμε
}, { timestamps: true });

module.exports = mongoose.model('Recipe', recipeSchema);