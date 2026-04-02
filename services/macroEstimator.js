// services/macroEstimator.js
// Estimates calories/protein/carbs/fat from a list of recipe ingredients using AI.
// Used as a fallback when a recipe has no scraped nutrition data.

const { callAI } = require('./aiService');

const SYSTEM_PROMPT = `You are a nutrition expert. Given a list of recipe ingredients, estimate the macronutrients for the entire recipe.
Return ONLY a valid JSON object with these fields (numbers, per serving, one decimal max):
{
  "calories": <number>,
  "protein": <number>,
  "carbs": <number>,
  "fat": <number>,
  "fiber": <number>,
  "servings": <number>
}
If you cannot estimate reliably, return null for that field. Do not include any explanation or markdown.`;

/**
 * Estimate macros for a recipe from its ingredients list.
 * @param {string[]} ingredients - e.g. ["100g chicken breast", "1 tbsp olive oil"]
 * @param {number}   servings    - number of servings the recipe makes
 * @returns {Promise<{calories,protein,carbs,fat,fiber}|null>}
 */
async function estimateMacros(ingredients, servings = 2) {
  if (!ingredients || ingredients.length === 0) return null;

  const userPrompt = `Recipe ingredients (makes approximately ${servings} servings):\n${ingredients.map((i, n) => `${n + 1}. ${i}`).join('\n')}\n\nEstimate per-serving macros.`;

  try {
    const result = await callAI(SYSTEM_PROMPT, userPrompt);

    // Validate fields
    const toNum = v => {
      const n = parseFloat(v);
      return isNaN(n) || n < 0 ? null : Math.round(n * 10) / 10;
    };

    return {
      calories: toNum(result.calories),
      protein:  toNum(result.protein),
      carbs:    toNum(result.carbs),
      fat:      toNum(result.fat),
      fiber:    toNum(result.fiber),
    };
  } catch (err) {
    console.warn(`⚠️ [macroEstimator] AI call failed: ${err.message}`);
    return null;
  }
}

module.exports = { estimateMacros };
