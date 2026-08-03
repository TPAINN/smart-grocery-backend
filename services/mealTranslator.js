// services/mealTranslator.js
// Translation stack for TheMealDB proxy (routes/meals.js):
// static dicts -> batch AI (Claude/Gemini/Groq) -> MyMemory API fallback.
// Extracted from routes/meals.js during tidy-up -- logic unchanged.

const axios = require('axios');
const { callAIText } = require('./aiService');
const { CATEGORY_GR, AREA_GR, MEAL_NAMES_GR, ING_WORDS_GR } = require('../data/mealTranslationDictionaries');

const MYMEMORY_TIMEOUT_MS = 5000;
const MYMEMORY_TEXT_LIMIT = 500;
const AI_INSTRUCTIONS_MIN_LENGTH = 20;
const AI_INSTRUCTIONS_CHAR_LIMIT = 2500;
const CHUNK_CHAR_LIMIT = 450;
const CHUNK_TRANSLATE_DELAY_MS = 60;

// Apply ingredient word-level translation using the dictionary
function translateIngredient(ing) {
  let result = ing;
  for (const [en, gr] of ING_WORDS_GR) {
    const regex = new RegExp(`\b${en}\b`, 'gi');
    if (regex.test(result)) {
      result = result.replace(regex, gr);
    }
  }
  return result;
}

// -- Translation cache -----------------------------------------------------
const trCache = new Map();

// -- MyMemory: last-resort per-text fallback --------------------------------
async function translateViaMyMemory(text) {
  if (!text || !text.trim()) return text;
  try {
    const { data } = await axios.get('https://api.mymemory.translated.net/get', {
      params: { q: text.slice(0, MYMEMORY_TEXT_LIMIT), langpair: 'en|el' },
      timeout: MYMEMORY_TIMEOUT_MS,
    });
    const t = data?.responseData?.translatedText;
    return (t && t !== text) ? t : text;
  } catch {
    return text;
  }
}

// -- AI: batch-translate an array of titles in one call ---------------------
// Returns a map { englishTitle -> greekTitle } for all titles not in static dict.
async function batchTranslateTitles(titles) {
  const missing = [...new Set(titles.filter(t => t && !MEAL_NAMES_GR[t] && !trCache.has(`title:${t}`)))];
  if (missing.length === 0) return;

  const SYSTEM = 'You are a culinary translator. Translate recipe names from their source language to natural Greek. Return ONLY valid JSON, no markdown.';
  const USER   = `Translate these recipe names to Greek. Preserve the original title in "en" and return {"results":[{"en":"...","gr":"..."},...]}:\n${JSON.stringify(missing)}`;

  try {
    const raw     = await callAIText(SYSTEM, USER);
    const cleaned = String(raw || '').replace(/```json|```/g, '').trim();
    const parsed  = JSON.parse(cleaned.match(/\{[\s\S]*\}/)?.[0] || cleaned);
    for (const { en, gr } of (parsed.results || [])) {
      if (en && gr && gr !== en) {
        MEAL_NAMES_GR[en] = gr;
        trCache.set(`title:${en}`, gr);
      }
    }
  } catch {
    // Silently fall through -- per-title fallback will handle it
  }
}

// -- AI: translate a full instruction text -----------------------------------
async function translateInstructionsAI(text) {
  if (!text || text.length < AI_INSTRUCTIONS_MIN_LENGTH) return text || '';
  const cacheKey = `inst:${text.slice(0, 100)}`;
  if (trCache.has(cacheKey)) return trCache.get(cacheKey);

  const SYSTEM = `You are a culinary translator. Translate the recipe instructions from their source language to natural, clear Greek suitable for a home cook.
Rules:
- Keep step numbering (Step 1, Step 2 -> Βήμα 1, Βήμα 2)
- Translate measurements naturally (cup -> φλιτζάνι, tbsp -> κ.σ., tsp -> κ.γ.)
- Use common Greek cooking vocabulary
- Do NOT include any English text in the output
- Return ONLY the translated text, no explanations`;

  try {
    const result = await callAIText(SYSTEM, text.slice(0, AI_INSTRUCTIONS_CHAR_LIMIT));
    if (result && result.trim() && result.trim().length > AI_INSTRUCTIONS_MIN_LENGTH) {
      const clean = result.trim();
      trCache.set(cacheKey, clean);
      return clean;
    }
  } catch { /* fall through */ }

  // Fallback: MyMemory in chunks
  const sentences = text.match(/[^.!?\n]+[.!?\n]+/g) || [text];
  const chunks = [];
  let current = '';
  for (const s of sentences) {
    if ((current + s).length > CHUNK_CHAR_LIMIT) { if (current) chunks.push(current.trim()); current = s; }
    else current += s;
  }
  if (current.trim()) chunks.push(current.trim());
  const parts = [];
  for (const chunk of chunks) {
    parts.push(await translateViaMyMemory(chunk));
    await new Promise(r => setTimeout(r, CHUNK_TRANSLATE_DELAY_MS));
  }
  const fallback = parts.join(' ');
  trCache.set(cacheKey, fallback);
  return fallback;
}

// -- Translate a single title (dict -> cache -> AI single -> MyMemory) ------
async function translateTitle(title) {
  if (!title) return title;
  if (MEAL_NAMES_GR[title]) return MEAL_NAMES_GR[title];
  const cacheKey = `title:${title}`;
  if (trCache.has(cacheKey)) return trCache.get(cacheKey);
  // Partial dict match
  for (const [en, gr] of Object.entries(MEAL_NAMES_GR)) {
    if (title.toLowerCase().includes(en.toLowerCase())) {
      const result = title.replace(new RegExp(en, 'i'), gr);
      trCache.set(cacheKey, result);
      return result;
    }
  }
  // Single AI call for one title
  try {
    const result = await callAIText(
      'Translate this recipe name from its source language to Greek. Return ONLY the Greek translation, nothing else.',
      title
    );
    if (result && result.trim() && result.trim() !== title) {
      const clean = result.trim();
      MEAL_NAMES_GR[title] = clean;
      trCache.set(cacheKey, clean);
      return clean;
    }
  } catch { /* fall through */ }
  // Last resort: MyMemory
  const mm = await translateViaMyMemory(title);
  trCache.set(cacheKey, mm);
  return mm;
}

// -- Full meal translation ----------------------------------------------------
async function translateMeal(meal) {
  const [titleGr, instructionsGr] = await Promise.all([
    translateTitle(meal.title),
    translateInstructionsAI(meal.instructions),
  ]);
  const ingredientsGr = (meal.ingredients || []).map(translateIngredient);

  return {
    ...meal,
    title:         titleGr,
    titleOriginal: meal.title,
    category:      CATEGORY_GR[meal.category] || meal.category,
    area:          AREA_GR[meal.area]          || meal.area,
    ingredients:   ingredientsGr,
    instructions:  instructionsGr,
  };
}

module.exports = {
  translateIngredient,
  translateViaMyMemory,
  batchTranslateTitles,
  translateInstructionsAI,
  translateTitle,
  translateMeal,
  CATEGORY_GR,
};
