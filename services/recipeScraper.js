// services/recipeScraper.js
const Recipe = require('../models/Recipe');

// ΔΩΡΕΑΝ GOOGLE TRANSLATE (Χωρίς API Key!)
async function translateToGreek(text) {
    if (!text) return '';
    try {
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=el&dt=t&q=${encodeURIComponent(text)}`;
        const res = await fetch(url);
        const json = await res.json();
        return json[0].map(item => item[0]).join('');
    } catch (e) {
        return text; // Αν κολλήσει, επιστρέφει το αγγλικό
    }
}

async function populateRecipes() {
    console.log("🚀 Εκκίνηση Smart Recipe Populator (Clean Eating)...");
    
    // Βάλε εδώ το κλειδί σου από το spoonacular.com (είναι δωρεάν!)
    const SPOONACULAR_API_KEY = process.env.SPOONACULAR_API_KEY || 'ΒΑΛΕ_ΤΟ_API_KEY_ΣΟΥ_ΕΔΩ';
    
    // Ζητάμε 10 τυχαίες Healthy συνταγές με πλήρη Nutrition & Instructions
    const url = `https://api.spoonacular.com/recipes/complexSearch?apiKey=${SPOONACULAR_API_KEY}&sort=healthiness&addRecipeNutrition=true&addRecipeInstructions=true&fillIngredients=true&number=10`;

    try {
        const response = await fetch(url);
        const data = await response.json();
        
        if (!data.results) {
            console.log("❌ Σφάλμα API:", data);
            return;
        }

        let savedCount = 0;

        for (const item of data.results) {
            // 1. Εξαγωγή Macros
            const getNutrient = (name) => {
                const nut = item.nutrition?.nutrients.find(n => n.name === name);
                return nut ? Math.round(nut.amount) : 0;
            };

            const calories = getNutrient("Calories");
            const protein = getNutrient("Protein");
            const carbs = getNutrient("Carbohydrates");
            const fat = getNutrient("Fat");

            // 2. Μετάφραση Τίτλου
            const greekTitle = await translateToGreek(item.title);

            // 3. Εξαγωγή και Μετάφραση Υλικών
            const englishIngredients = item.extendedIngredients ? item.extendedIngredients.map(ing => ing.original) :[];
            const greekIngredients =[];
            for (const ing of englishIngredients) {
                const tr = await translateToGreek(ing);
                greekIngredients.push(tr);
            }

            // 4. Εξαγωγή και Μετάφραση Οδηγιών (Βήμα-Βήμα)
            let greekInstructions =[];
            if (item.analyzedInstructions && item.analyzedInstructions.length > 0) {
                const steps = item.analyzedInstructions[0].steps.map(s => s.step);
                for (const step of steps) {
                    const tr = await translateToGreek(step);
                    greekInstructions.push(tr);
                }
            }

            // 5. Αποθήκευση στη Βάση
            const newRecipe = {
                title: greekTitle,
                image: item.image,
                time: item.readyInMinutes || 30,
                calories: calories,
                protein: protein,
                carbs: carbs,
                fat: fat,
                isHealthy: true,
                ingredients: greekIngredients,
                instructions: greekInstructions,
                url: `spoonacular_${item.id}`
            };

            await Recipe.findOneAndUpdate(
                { url: newRecipe.url },
                { $set: newRecipe },
                { upsert: true }
            );

            console.log(`✅ Αποθηκεύτηκε: ${greekTitle} (Πρωτεΐνη: ${protein}g)`);
            savedCount++;
        }

        console.log(`\n🎉 Ολοκληρώθηκε! Προστέθηκαν/Ανανεώθηκαν ${savedCount} συνταγές.`);
        
    } catch (error) {
        console.error("❌ Σφάλμα Populator:", error);
    }
}

module.exports = { populateRecipes };