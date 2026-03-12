// services/aiService.js
// Primary:  Google Gemini 1.5 Flash  (free: 1,500 req/day, 15 RPM)
// Fallback: Groq llama-3.3-70b       (free: 14,400 req/day, 30 RPM)
// Auto-switches if one provider fails or rate-limits

const { GoogleGenerativeAI } = require('@google/generative-ai');
const Groq = require('groq-sdk');

// ── In-memory rate-limit tracker (resets every minute) ────────────────────────
const rateTracker = {
  gemini: { count: 0, resetAt: Date.now() + 60_000 },
  groq:   { count: 0, resetAt: Date.now() + 60_000 },
};

const LIMITS = { gemini: 14, groq: 28 }; // slightly under hard limits for safety

function canUse(provider) {
  const t = rateTracker[provider];
  if (Date.now() > t.resetAt) { t.count = 0; t.resetAt = Date.now() + 60_000; }
  return t.count < LIMITS[provider];
}
function tick(provider) { rateTracker[provider].count++; }

// ── Gemini call ────────────────────────────────────────────────────────────────
async function callGemini(systemPrompt, userPrompt) {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: 'gemini-1.5-flash',
    systemInstruction: systemPrompt,
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.5,
      maxOutputTokens: 8192,
    },
  });

  tick('gemini');
  const result = await model.generateContent(userPrompt);
  const raw = result.response.text();
  try { return JSON.parse(raw.replace(/```json|```/g, '').trim()); }
  catch { const m = raw.match(/\{[\s\S]*\}/); if (m) return JSON.parse(m[0]); throw new Error('Gemini JSON parse failed'); }
}

// ── Groq call ──────────────────────────────────────────────────────────────────
async function callGroq(systemPrompt, userPrompt) {
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  tick('groq');
  const completion = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt },
    ],
    temperature: 0.5,
    max_tokens: 8192,
    response_format: { type: 'json_object' },
  });
  const raw = completion.choices[0]?.message?.content || '{}';
  try { return JSON.parse(raw.replace(/```json|```/g, '').trim()); }
  catch { const m = raw.match(/\{[\s\S]*\}/); if (m) return JSON.parse(m[0]); throw new Error('Groq JSON parse failed'); }
}

// ── Main exported function — auto-selects provider ────────────────────────────
async function callAI(systemPrompt, userPrompt) {
  const hasGemini = !!process.env.GEMINI_API_KEY;
  const hasGroq   = !!process.env.GROQ_API_KEY;

  // Try Gemini first
  if (hasGemini && canUse('gemini')) {
    try {
      console.log('🤖 [AI] Provider: Gemini 1.5 Flash');
      return await callGemini(systemPrompt, userPrompt);
    } catch (err) {
      console.warn(`⚠️ [AI] Gemini failed: ${err.message} → switching to Groq`);
    }
  }

  // Fallback to Groq
  if (hasGroq && canUse('groq')) {
    try {
      console.log('🤖 [AI] Provider: Groq llama-3.3-70b (fallback)');
      return await callGroq(systemPrompt, userPrompt);
    } catch (err) {
      console.error(`❌ [AI] Groq also failed: ${err.message}`);
      throw err;
    }
  }

  throw new Error('Κανένα AI provider δεν είναι διαθέσιμο αυτή τη στιγμή. Δοκίμασε ξανά σε λίγο.');
}

module.exports = { callAI };