// routes/meals.js
// TheMealDB proxy — truly free, no rate-limit documented, open crowd-sourced DB.
// $2/month Patreon gives unlimited production access when needed.
// We proxy instead of calling direct so we can cache, normalise, and
// add a simple in-memory TTL cache to avoid hammering their servers.

const express = require('express');
const router  = express.Router();
const axios   = require('axios');

const BASE = 'https://www.themealdb.com/api/json/v1/1';

// Simple in-memory TTL cache — keeps hot responses for 30 minutes
// so repeated recipe-tab loads don't hit TheMealDB on every request.
const cache = new Map();
const CACHE_TTL = 30 * 60 * 1000; // 30 min

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) { cache.delete(key); return null; }
  return entry.data;
}
function cacheSet(key, data) {
  cache.set(key, { data, ts: Date.now() });
}

// Normalise a TheMealDB meal object into the shape our Recipe model uses
function normaliseMeal(m) {
  if (!m) return null;

  // TheMealDB stores ingredients as strIngredient1..20 + strMeasure1..20
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
    area:         m.strArea || null,
    instructions: m.strInstructions || '',
    youtube:      m.strYoutube || null,
    tags:         m.strTags ? m.strTags.split(',').map(t => t.trim()).filter(Boolean) : [],
    ingredients,
    // TheMealDB doesn't provide macros — keep nulls so the UI shows '—'
    kcal:     null,
    protein:  null,
    carbs:    null,
    fat:      null,
  };
}

// GET /api/meals/greek
// Returns all Greek-area meals (TheMealDB has a proper Greek category)
router.get('/greek', async (req, res) => {
  const cacheKey = 'greek_area';
  const cached = cacheGet(cacheKey);
  if (cached) return res.json(cached);

  try {
    // Step 1: get the list (thumbnails + ids only)
    const { data: listData } = await axios.get(`${BASE}/filter.php`, {
      params: { a: 'Greek' },
      timeout: 8000,
    });
    const meals = listData?.meals || [];

    // Step 2: fetch full details for each meal (max 20 to stay polite)
    const detailed = await Promise.all(
      meals.slice(0, 20).map(async m => {
        try {
          const { data } = await axios.get(`${BASE}/lookup.php`, {
            params: { i: m.idMeal },
            timeout: 6000,
          });
          return normaliseMeal(data?.meals?.[0]);
        } catch { return normaliseMeal(m); }
      })
    );

    const result = { meals: detailed.filter(Boolean), total: meals.length };
    cacheSet(cacheKey, result);
    res.json(result);
  } catch (err) {
    console.error('❌ TheMealDB greek:', err.message);
    res.status(502).json({ meals: [], total: 0, error: 'TheMealDB unavailable' });
  }
});

// GET /api/meals/mediterranean
// Broader Mediterranean sweep: Italian + Spanish + Turkish + Greek
router.get('/mediterranean', async (req, res) => {
  const cacheKey = 'mediterranean';
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
    const flat = allLists.flat();

    // Sample up to 4 from each area (keeps response lean)
    const sampled = areas.flatMap(a => flat.filter(m => m.area === a).slice(0, 4));

    const detailed = await Promise.all(
      sampled.map(async m => {
        try {
          const { data } = await axios.get(`${BASE}/lookup.php`, {
            params: { i: m.idMeal },
            timeout: 6000,
          });
          return normaliseMeal(data?.meals?.[0]);
        } catch { return normaliseMeal(m); }
      })
    );

    const result = { meals: detailed.filter(Boolean), total: detailed.length };
    cacheSet(cacheKey, result);
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

  const cacheKey = `search_${q.toLowerCase()}`;
  const cached = cacheGet(cacheKey);
  if (cached) return res.json(cached);

  try {
    const { data } = await axios.get(`${BASE}/search.php`, {
      params: { s: q },
      timeout: 8000,
    });
    const meals = (data?.meals || []).map(normaliseMeal).filter(Boolean);
    const result = { meals, total: meals.length };
    cacheSet(cacheKey, result);
    res.json(result);
  } catch (err) {
    console.error('❌ TheMealDB search:', err.message);
    res.status(502).json({ meals: [] });
  }
});

// GET /api/meals/random
// Returns 1 random meal — used for "Surprise me" button
router.get('/random', async (req, res) => {
  try {
    const { data } = await axios.get(`${BASE}/random.php`, { timeout: 6000 });
    const meal = normaliseMeal(data?.meals?.[0]);
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
    const result = data?.categories || [];
    cacheSet('categories', result);
    res.json(result);
  } catch {
    res.json([]);
  }
});

module.exports = router;
