// routes/meals.js
// TheMealDB proxy — truly free, no rate-limit documented, open crowd-sourced DB.
// Translation stack: static dicts → batch AI (Claude/Gemini/Groq) → MyMemory API fallback.

const express   = require('express');
const router    = express.Router();
const axios     = require('axios');

const BASE = 'https://www.themealdb.com/api/json/v1/1';

// In-memory TTL cache
const cache      = new Map();
const CACHE_TTL  = 30 * 60 * 1000;  // 30 min for raw data
const TR_TTL     = 6  * 60 * 60 * 1000; // 6 h for translated results

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > entry.ttl) { cache.delete(key); return null; }
  return entry.data;
}
function cacheSet(key, data, ttl = CACHE_TTL) {
  cache.set(key, { data, ts: Date.now(), ttl });
}

const {
  batchTranslateTitles,
  translateMeal,
  CATEGORY_GR,
} = require('../services/mealTranslator');

// Normalise a TheMealDB meal object into our Recipe model shape
function normaliseMeal(m) {
  if (!m) return null;
  const ingredients = [];
  for (let i = 1; i <= 20; i++) {
    const name    = m[`strIngredient${i}`]?.trim();
    const measure = m[`strMeasure${i}`]?.trim();
    if (name) ingredients.push(measure ? `${measure} ${name}` : name);
  }
  return {
    _id:          `mealdb_${m.idMeal}`,
    externalId:   m.idMeal,
    source:       'themealdb',
    title:        m.strMeal,
    image:        m.strMealThumb || null,
    category:     m.strCategory || null,
    area:         m.strArea     || null,
    instructions: m.strInstructions || '',
    youtube:      m.strYoutube  || null,
    tags:         m.strTags ? m.strTags.split(',').map(t => t.trim()).filter(Boolean) : [],
    ingredients,
    kcal: null, protein: null, carbs: null, fat: null,
  };
}

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /api/meals/greek
router.get('/greek', async (req, res) => {
  const cacheKey = 'greek_area_gr';
  const cached = cacheGet(cacheKey);
  if (cached) return res.json(cached);

  try {
    const { data: listData } = await axios.get(`${BASE}/filter.php`, {
      params: { a: 'Greek' }, timeout: 8000,
    });
    const meals = listData?.meals || [];

    const detailed = await Promise.all(
      meals.slice(0, 30).map(async m => {
        try {
          const { data } = await axios.get(`${BASE}/lookup.php`, {
            params: { i: m.idMeal }, timeout: 6000,
          });
          return normaliseMeal(data?.meals?.[0]);
        } catch { return normaliseMeal(m); }
      })
    );

    const valid = detailed.filter(Boolean);

    // Pre-warm title cache with a single batch AI call
    await batchTranslateTitles(valid.map(m => m.title));

    // Translate all meals sequentially to respect API rate limits
    const translated = [];
    for (const meal of valid) {
      translated.push(await translateMeal(meal));
    }

    const result = { meals: translated, total: meals.length };
    cacheSet(cacheKey, result, TR_TTL);
    res.json(result);
  } catch (err) {
    console.error('❌ TheMealDB greek:', err.message);
    res.status(502).json({ meals: [], total: 0, error: 'TheMealDB unavailable' });
  }
});

// GET /api/meals/mediterranean
router.get('/mediterranean', async (req, res) => {
  const cacheKey = 'mediterranean_gr';
  const cached = cacheGet(cacheKey);
  if (cached) return res.json(cached);

  try {
    const areas = ['Greek', 'Italian', 'Spanish', 'Turkish', 'Moroccan'];
    const allLists = await Promise.all(
      areas.map(a =>
        axios.get(`${BASE}/filter.php`, { params: { a }, timeout: 8000 })
             .then(r => (r.data?.meals || []).map(m => ({ ...m, area: a })))
             .catch(() => [])
      )
    );
    const flat    = allLists.flat();
    // Sample up to 8 from each area for richer pagination
    const sampled = areas.flatMap(a => flat.filter(m => m.area === a).slice(0, 8));

    const detailed = await Promise.all(
      sampled.map(async m => {
        try {
          const { data } = await axios.get(`${BASE}/lookup.php`, {
            params: { i: m.idMeal }, timeout: 6000,
          });
          return normaliseMeal(data?.meals?.[0]);
        } catch { return normaliseMeal(m); }
      })
    );

    const valid = detailed.filter(Boolean);

    // Pre-warm title cache with a single batch AI call
    await batchTranslateTitles(valid.map(m => m.title));

    const translated = [];
    for (const meal of valid) {
      translated.push(await translateMeal(meal));
    }

    const result = { meals: translated, total: translated.length };
    cacheSet(cacheKey, result, TR_TTL);
    res.json(result);
  } catch (err) {
    console.error('❌ TheMealDB mediterranean:', err.message);
    res.status(502).json({ meals: [], total: 0 });
  }
});

// GET /api/meals/search?q=moussaka
router.get('/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.status(400).json({ meals: [] });

  const cacheKey = `search_gr_${q.toLowerCase()}`;
  const cached = cacheGet(cacheKey);
  if (cached) return res.json(cached);

  try {
    const { data } = await axios.get(`${BASE}/search.php`, {
      params: { s: q }, timeout: 8000,
    });
    const raw = (data?.meals || []).map(normaliseMeal).filter(Boolean);

    // Pre-warm title cache with a single batch AI call
    await batchTranslateTitles(raw.map(m => m.title));

    const translated = [];
    for (const meal of raw) {
      translated.push(await translateMeal(meal));
    }
    const result = { meals: translated, total: translated.length };
    cacheSet(cacheKey, result, TR_TTL);
    res.json(result);
  } catch (err) {
    console.error('❌ TheMealDB search:', err.message);
    res.status(502).json({ meals: [] });
  }
});

// GET /api/meals/random
router.get('/random', async (req, res) => {
  try {
    const { data } = await axios.get(`${BASE}/random.php`, { timeout: 6000 });
    const raw  = normaliseMeal(data?.meals?.[0]);
    const meal = raw ? await translateMeal(raw) : null;
    res.json(meal || null);
  } catch (err) {
    console.error('❌ TheMealDB random:', err.message);
    res.status(502).json(null);
  }
});

// GET /api/meals/categories
router.get('/categories', async (req, res) => {
  const cached = cacheGet('categories');
  if (cached) return res.json(cached);
  try {
    const { data } = await axios.get(`${BASE}/categories.php`, { timeout: 6000 });
    const result = (data?.categories || []).map(c => ({
      ...c,
      strCategory: CATEGORY_GR[c.strCategory] || c.strCategory,
    }));
    cacheSet('categories', result);
    res.json(result);
  } catch {
    res.json([]);
  }
});

module.exports = router;
