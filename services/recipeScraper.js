// services/recipeScraper.js
const Recipe = require('../models/Recipe');

async function translateWithDeepL(textArray) {
    const DEEPL_API_KEY = process.env.DEEPL_API_KEY;
    if (!textArray || textArray.length === 0) return[];
    try {
        const response = await fetch('https://api-free.deepl.com/v2/translate', {
            method: 'POST',
            headers: { 'Authorization': `DeepL-Auth-Key ${DEEPL_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: textArray, target_lang: 'EL' })
        });
        if (!response.ok) return textArray;
        const data = await response.json();
        return data.translations.map(t => t.text);
    } catch (e) { return textArray; }
}

async function populateRecipes() {
    console.log("🚀 Εκκίνηση Smart Recipe Populator (DeepL)...");
    const SPOONACULAR_API_KEY = process.env.SPOONACULAR_API_KEY;
    if (!SPOONACULAR_API_KEY || !process.env.DEEPL_API_KEY) return console.error("❌ Λείπουν τα API Keys.");
    
    // Τυχαία επιλογή κατηγορίας για να έχουμε ποικιλία!
    const mealTypes =["breakfast", "snack", "main course", "dessert", "salad"];
    const randomType = mealTypes[Math.floor(Math.random() * mealTypes.length)];
    const randomOffset = Math.floor(Math.random() * 50);
    
    console.log(`🔍 Ζητάμε 20 νέες συνταγές τύπου:[${randomType.toUpperCase()}]...`);
    
    const url = `https://api.spoonacular.com/recipes/complexSearch?apiKey=${SPOONACULAR_API_KEY}&type=${randomType}&sort=healthiness&addRecipeNutrition=true&addRecipeInstructions=true&fillIngredients=true&number=20&offset=${randomOffset}`;

    try {
        const response = await fetch(url);
        const data = await response.json();
        if (!data.results) return console.log("❌ Σφάλμα Spoonacular API");

        let savedCount = 0;
        for (const item of data.results) {
            console.log(`⏳ Μετάφραση: ${item.title}...`);

            const getNutrient = (name) => {
                const nut = item.nutrition?.nutrients.find(n => n.name === name);
                return nut ? Math.round(nut.amount) : 0;
            };

            const engTitle = [item.title];
            const engIngredients = item.extendedIngredients ? item.extendedIngredients.map(ing => ing.original) : [];
            let engInstructions =[];
            if (item.analyzedInstructions && item.analyzedInstructions.length > 0) {
                engInstructions = item.analyzedInstructions[0].steps.map(s => s.step);
            }

            const greekTitleArr = await translateWithDeepL(engTitle);
            const greekIngredients = await translateWithDeepL(engIngredients);
            const greekInstructions = await translateWithDeepL(engInstructions);

            // Αποθήκευση Dish Types (πχ. breakfast, snack)
            const tags = item.dishTypes || [randomType];

            const newRecipe = {
                title: greekTitleArr[0] || item.title,
                image: item.image,
                time: item.readyInMinutes || 30,
                calories: getNutrient("Calories"),
                protein: getNutrient("Protein"),
                carbs: getNutrient("Carbohydrates"),
                fat: getNutrient("Fat"),
                isHealthy: true,
                ingredients: greekIngredients,
                instructions: greekInstructions,
                tags: tags,
                url: `spoonacular_${item.id}`
            };

            await Recipe.findOneAndUpdate({ url: newRecipe.url }, { $set: newRecipe }, { upsert: true });
            savedCount++;
            await new Promise(resolve => setTimeout(resolve, 800));
        }
        console.log(`\n🎉 Αποθηκεύτηκαν ${savedCount} συνταγές!`);
    } catch (error) { console.error("❌ Σφάλμα:", error); }
}
module.exports = { populateRecipes };