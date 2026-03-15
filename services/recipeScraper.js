// services/recipeScraper.js — Spoonacular API + DeepL Translation
// Fetches recipes from Spoonacular, translates to Greek via DeepL, saves to MongoDB
//
// ENV vars needed:
//   SPOONACULAR_API_KEY   — get free key at https://spoonacular.com/food-api
//   DEEPL_API_KEY         — get free key at https://www.deepl.com/pro-api
//

const Recipe = require('../models/Recipe');

const SPOONACULAR_BASE = 'https://api.spoonacular.com';
const DEEPL_BASE       = 'https://api-free.deepl.com/v2/translate';

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Translate an array of texts from EN→EL via DeepL Free API
 * Batches up to 50 texts per call to stay efficient
 */
async function translateTexts(texts, targetLang = 'EL') {
  const apiKey = process.env.DEEPL_API_KEY;
  if (!apiKey) {
    console.warn('⚠️  DEEPL_API_KEY not set — skipping translation');
    return texts; // return originals
  }

  const filtered = texts.filter(t => t && t.trim());
  if (!filtered.length) return texts;

  try {
    // DeepL free allows up to 50 texts per request
    const batches = [];
    for (let i = 0; i < filtered.length; i += 50) {
      batches.push(filtered.slice(i, i + 50));
    }

    const allTranslated = [];

    for (const batch of batches) {
      const params = new URLSearchParams();
      params.append('auth_key', apiKey);
      params.append('target_lang', targetLang);
      batch.forEach(t => params.append('text', t));

      const res = await fetch(DEEPL_BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });

      if (!res.ok) {
        const errText = await res.text();
        console.error(`❌ DeepL error ${res.status}: ${errText}`);
        allTranslated.push(...batch); // fallback to originals
        continue;
      }

      const data = await res.json();
      allTranslated.push(...data.translations.map(t => t.text));
    }

    // Map back (preserving empty/null entries)
    let idx = 0;
    return texts.map(t => {
      if (!t || !t.trim()) return t;
      return allTranslated[idx++] || t;
    });

  } catch (err) {
    console.error('❌ DeepL translation failed:', err.message);
    return texts;
  }
}

/**
 * Determine difficulty from readyInMinutes + ingredient count
 */
function getDifficulty(minutes, ingredientCount) {
  if (minutes <= 20 && ingredientCount <= 6)  return 'Εύκολη';
  if (minutes <= 45 && ingredientCount <= 12) return 'Μέτρια';
  return 'Δύσκολη';
}

/**
 * Map Spoonacular dishTypes to our Greek categories
 */
function mapCategory(dishTypes = [], title = '') {
  const types = dishTypes.map(t => t.toLowerCase());
  const lowerTitle = title.toLowerCase();

  if (types.some(t => ['breakfast', 'morning meal'].includes(t)))          return 'Πρωινό';
  if (types.some(t => ['salad'].includes(t)))                              return 'Σαλάτες';
  if (types.some(t => ['soup'].includes(t)))                               return 'Σούπες';
  if (types.some(t => ['snack', 'appetizer', 'antipasto', 'starter'].includes(t))) return 'Σνακ';
  if (types.some(t => ['dessert', 'sweet'].includes(t)))                   return 'Επιδόρπια';
  if (types.some(t => ['side dish'].includes(t)))                          return 'Συνοδευτικά';
  if (types.some(t => ['beverage', 'drink'].includes(t)))                  return 'Ροφήματα';
  return 'Κυρίως';
}

/**
 * Map Spoonacular cuisines to Greek labels
 */
function mapCuisine(cuisines = []) {
  const map = {
    'greek': 'Ελληνική', 'mediterranean': 'Μεσογειακή', 'italian': 'Ιταλική',
    'mexican': 'Μεξικάνικη', 'chinese': 'Κινέζικη', 'japanese': 'Ιαπωνική',
    'indian': 'Ινδική', 'thai': 'Ταϊλανδέζικη', 'french': 'Γαλλική',
    'american': 'Αμερικάνικη', 'spanish': 'Ισπανική', 'turkish': 'Τουρκική',
    'middle eastern': 'Μέση Ανατολή', 'korean': 'Κορεάτικη', 'vietnamese': 'Βιετναμέζικη',
    'african': 'Αφρικάνικη', 'british': 'Βρετανική', 'german': 'Γερμανική',
  };
  for (const c of cuisines) {
    const matched = map[c.toLowerCase()];
    if (matched) return matched;
  }
  return 'Διεθνής';
}

/**
 * Build tags from Spoonacular data
 */
function buildTags(data) {
  const tags = [];
  if (data.veryHealthy || data.healthScore > 70) tags.push('healthy');
  if (data.readyInMinutes <= 25) tags.push('quick');
  if (data.cheap) tags.push('budget');
  if (data.vegan) tags.push('vegan');
  if (data.vegetarian) tags.push('vegetarian');
  if (data.glutenFree) tags.push('gluten-free');
  if (data.dairyFree) tags.push('dairy-free');

  // Nutrition-based tags
  const nutrients = {};
  (data.nutrition?.nutrients || []).forEach(n => {
    nutrients[n.name.toLowerCase()] = n.amount;
  });
  if ((nutrients['protein'] || 0) > 25) tags.push('high-protein');
  if ((nutrients['carbohydrates'] || 0) < 15) tags.push('low-carb');
  if ((nutrients['fat'] || 0) < 10) tags.push('low-fat');

  // Meal type tags
  const dishTypes = (data.dishTypes || []).map(t => t.toLowerCase());
  if (dishTypes.some(t => ['breakfast', 'morning meal'].includes(t))) tags.push('breakfast');
  if (dishTypes.some(t => ['snack'].includes(t))) tags.push('snack');
  if (dishTypes.some(t => ['dessert'].includes(t))) tags.push('dessert');

  return [...new Set(tags)];
}

// ── Main Scraper ─────────────────────────────────────────────────────────────

/**
 * Fetch recipes from Spoonacular, translate, and save to DB
 * @param {Object} options
 * @param {number} options.count       — How many recipes to fetch (default 20)
 * @param {string} options.query       — Search query (e.g. 'healthy chicken')
 * @param {string} options.cuisine     — Cuisine filter (e.g. 'mediterranean')
 * @param {string} options.diet        — Diet filter (e.g. 'vegetarian')
 * @param {number} options.offset      — Pagination offset
 */
async function populateRecipes(options = {}) {
  const apiKey = process.env.SPOONACULAR_API_KEY;
  if (!apiKey) {
    console.error('❌ SPOONACULAR_API_KEY not set!');
    return { added: 0, skipped: 0, error: 'No API key' };
  }

  const {
    count = 20,
    query = '',
    cuisine = '',
    diet = '',
    offset = 0,
  } = options;

  console.log(`👨‍🍳 Fetching ${count} recipes from Spoonacular...`);

  try {
    // ── Step 1: Search recipes with nutrition info ──────────────────────────
    const searchParams = new URLSearchParams({
      apiKey,
      number: String(Math.min(count, 100)),
      offset: String(offset),
      addRecipeNutrition: 'true',
      addRecipeInformation: 'true',
      fillIngredients: 'true',
      instructionsRequired: 'true',
      sort: 'popularity',
      ...(query   && { query }),
      ...(cuisine && { cuisine }),
      ...(diet    && { diet }),
    });

    const searchRes = await fetch(`${SPOONACULAR_BASE}/recipes/complexSearch?${searchParams}`);
    if (!searchRes.ok) {
      const errText = await searchRes.text();
      console.error(`❌ Spoonacular search error ${searchRes.status}: ${errText}`);
      return { added: 0, skipped: 0, error: errText };
    }

    const searchData = await searchRes.json();
    const results = searchData.results || [];
    console.log(`📋 Got ${results.length} recipes from Spoonacular`);

    if (!results.length) return { added: 0, skipped: 0 };

    let added = 0, skipped = 0;

    // ── Step 2: Process each recipe ──────────────────────────────────────
    for (const r of results) {
      try {
        // Skip if already exists
        const exists = await Recipe.findOne({ sourceId: r.id });
        if (exists) {
          skipped++;
          continue;
        }

        // Extract nutrition
        const nutrients = {};
        (r.nutrition?.nutrients || []).forEach(n => {
          nutrients[n.name.toLowerCase()] = Math.round(n.amount);
        });

        // Extract ingredients (English)
        const ingredientsEn = (r.extendedIngredients || [])
          .map(ing => ing.original || ing.originalString || `${ing.amount} ${ing.unit} ${ing.name}`)
          .filter(Boolean);

        // Extract instructions (English)
        let instructionsEn = [];
        if (r.analyzedInstructions && r.analyzedInstructions.length > 0) {
          instructionsEn = r.analyzedInstructions[0].steps
            .map(s => s.step)
            .filter(Boolean);
        } else if (r.instructions) {
          // Split by sentences or numbered steps
          instructionsEn = r.instructions
            .replace(/<[^>]*>/g, '') // strip HTML
            .split(/(?:\d+\.\s*|\n)+/)
            .map(s => s.trim())
            .filter(s => s.length > 10);
        }

        if (!instructionsEn.length) {
          skipped++;
          continue; // Skip recipes without instructions
        }

        // ── Step 3: Translate to Greek ─────────────────────────────────────
        const textsToTranslate = [
          r.title,
          r.summary ? r.summary.replace(/<[^>]*>/g, '').slice(0, 300) : '',
          ...ingredientsEn,
          ...instructionsEn,
        ];

        const translated = await translateTexts(textsToTranslate);

        let idx = 0;
        const titleEl        = translated[idx++];
        const descriptionEl  = translated[idx++];
        const ingredientsEl  = translated.slice(idx, idx + ingredientsEn.length);
        idx += ingredientsEn.length;
        const instructionsEl = translated.slice(idx, idx + instructionsEn.length);

        // ── Step 4: Save to MongoDB ────────────────────────────────────────
        const recipe = new Recipe({
          title:        titleEl,
          titleEn:      r.title,
          description:  descriptionEl,
          image:        r.image || '',
          servings:     r.servings || 4,
          time:         r.readyInMinutes || 30,
          difficulty:   getDifficulty(r.readyInMinutes || 30, ingredientsEn.length),
          calories:     nutrients['calories'] || null,
          protein:      nutrients['protein'] || null,
          carbs:        nutrients['carbohydrates'] || null,
          fat:          nutrients['fat'] || null,
          fiber:        nutrients['fiber'] || null,
          sugar:        nutrients['sugar'] || null,
          isHealthy:    r.veryHealthy || r.healthScore > 50,
          ingredients:  ingredientsEl,
          instructions: instructionsEl,
          tags:         buildTags(r),
          cuisine:      mapCuisine(r.cuisines || []),
          category:     mapCategory(r.dishTypes || [], r.title),
          sourceApi:    'spoonacular',
          sourceId:     r.id,
          url:          r.sourceUrl || `https://spoonacular.com/recipes/${r.id}`,
          translated:   !!process.env.DEEPL_API_KEY,
        });

        await recipe.save();
        added++;
        console.log(`  ✅ Saved: ${titleEl}`);

        // Small delay to be kind to APIs
        await new Promise(resolve => setTimeout(resolve, 200));

      } catch (err) {
        if (err.code === 11000) {
          skipped++; // Duplicate
        } else {
          console.error(`  ❌ Error processing recipe ${r.id}:`, err.message);
        }
      }
    }

    console.log(`👨‍🍳 Done! Added: ${added}, Skipped: ${skipped}`);
    return { added, skipped };

  } catch (err) {
    console.error('❌ populateRecipes failed:', err);
    return { added: 0, skipped: 0, error: err.message };
  }
}

/**
 * Bulk populate — fetches multiple batches across cuisines
 * Good for initial seeding of the database
 */
async function seedRecipes() {
  console.log('🌱 Starting recipe database seed...');

  const queries = [
    { query: 'healthy chicken', cuisine: 'mediterranean', count: 10 },
    { query: 'pasta',           cuisine: 'italian',       count: 10 },
    { query: 'salad',           cuisine: '',              count: 8 },
    { query: 'breakfast healthy', cuisine: '',             count: 8 },
    { query: 'soup',            cuisine: 'mediterranean', count: 6 },
    { query: 'fish seafood',    cuisine: 'mediterranean', count: 8 },
    { query: 'dessert healthy', cuisine: '',              count: 6 },
    { query: 'snack protein',   cuisine: '',              count: 6 },
    { query: 'vegan bowl',      cuisine: '',              count: 6 },
    { query: 'greek',           cuisine: 'greek',         count: 10 },
  ];

  let totalAdded = 0, totalSkipped = 0;

  for (const q of queries) {
    console.log(`\n🔍 Fetching: "${q.query}" (${q.cuisine || 'any cuisine'})...`);
    const { added, skipped } = await populateRecipes(q);
    totalAdded += added;
    totalSkipped += skipped;

    // Delay between batches (respect Spoonacular rate limits)
    await new Promise(resolve => setTimeout(resolve, 1500));
  }

  console.log(`\n🌱 Seed complete! Total added: ${totalAdded}, skipped: ${totalSkipped}`);
  return { added: totalAdded, skipped: totalSkipped };
}

module.exports = { populateRecipes, seedRecipes, translateTexts };