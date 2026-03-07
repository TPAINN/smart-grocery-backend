// services/recipeScraper.js
const Recipe = require('../models/Recipe');

// Συνάρτηση για μαζική μετάφραση μέσω DeepL API Free
async function translateWithDeepL(textArray) {
    const DEEPL_API_KEY = process.env.DEEPL_API_KEY;
    if (!textArray || textArray.length === 0) return[];
    
    try {
        const response = await fetch('https://api-free.deepl.com/v2/translate', {
            method: 'POST',
            headers: {
                'Authorization': `DeepL-Auth-Key ${DEEPL_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                text: textArray,
                target_lang: 'EL' // Ελληνικά
            })
        });

        if (!response.ok) {
            console.error("❌ DeepL API Error:", await response.text());
            return textArray; // Fallback στα Αγγλικά αν χτυπήσει error
        }

        const data = await response.json();
        return data.translations.map(t => t.text);
    } catch (e) {
        console.error("❌ Σφάλμα δικτύου DeepL:", e.message);
        return textArray; // Fallback
    }
}

async function populateRecipes() {
    console.log("🚀 Εκκίνηση Smart Recipe Populator (Spoonacular + DeepL)...");
    
    const SPOONACULAR_API_KEY = process.env.SPOONACULAR_API_KEY;
    if (!SPOONACULAR_API_KEY || !process.env.DEEPL_API_KEY) {
        console.error("❌ Λείπουν τα API Keys (SPOONACULAR_API_KEY ή DEEPL_API_KEY) στο .env αρχείο.");
        return;
    }
    
    const randomOffset = Math.floor(Math.random() * 200);
    const RECIPES_TO_FETCH = 20;

    console.log(`🔍 Ζητάμε ${RECIPES_TO_FETCH} νέες συνταγές (Offset: ${randomOffset})...`);
    
    const url = `https://api.spoonacular.com/recipes/complexSearch?apiKey=${SPOONACULAR_API_KEY}&sort=healthiness&addRecipeNutrition=true&addRecipeInstructions=true&fillIngredients=true&number=${RECIPES_TO_FETCH}&offset=${randomOffset}`;

    try {
        const response = await fetch(url);
        const data = await response.json();
        
        if (!data.results) {
            console.log("❌ Σφάλμα Spoonacular API:", data);
            return;
        }

        let savedCount = 0;

        for (const item of data.results) {
            console.log(`⏳ Επεξεργασία & Μετάφραση: ${item.title}...`);

            // 1. Εξαγωγή Macros
            const getNutrient = (name) => {
                const nut = item.nutrition?.nutrients.find(n => n.name === name);
                return nut ? Math.round(nut.amount) : 0;
            };

            const calories = getNutrient("Calories");
            const protein = getNutrient("Protein");
            const carbs = getNutrient("Carbohydrates");
            const fat = getNutrient("Fat");

            // 2. Προετοιμασία Αγγλικών Κειμένων
            const engTitle = [item.title];
            const engIngredients = item.extendedIngredients ? item.extendedIngredients.map(ing => ing.original) :[];
            let engInstructions =[];
            if (item.analyzedInstructions && item.analyzedInstructions.length > 0) {
                engInstructions = item.analyzedInstructions[0].steps.map(s => s.step);
            }

            // 3. Μαζική μετάφραση με DeepL (Ομαδοποιούμε τα requests για ταχύτητα)
            const greekTitleArr = await translateWithDeepL(engTitle);
            const greekIngredients = await translateWithDeepL(engIngredients);
            const greekInstructions = await translateWithDeepL(engInstructions);

            const greekTitle = greekTitleArr[0] || item.title;

            // 4. Αποθήκευση στη Βάση μας
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
            
            // Παύση 1 δευτερολέπτου για να είμαστε ευγενικοί με το API
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        console.log(`\n🎉 Ολοκληρώθηκε! Προστέθηκαν/Ανανεώθηκαν ${savedCount} συνταγές με τέλεια Ελληνικά (DeepL).`);
        
    } catch (error) {
        console.error("❌ Σφάλμα Populator:", error);
    }
}

module.exports = { populateRecipes };