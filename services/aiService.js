// services/aiService.js
// Priority 1: Claude claude-haiku-4-5              (best instruction-following, JSON accuracy)
// Priority 2: Google Gemini 2.0 Flash  (free: 1,500 req/day, 15 RPM, 1M context)
// Priority 3: Groq llama-3.3-70b       (free: 14,400 req/day, 30 RPM, 128K context)
// Priority 4: Bytez Qwen3-4B           (free tier, 32K context — emergency fallback)
// Auto-switches if one provider fails or rate-limits

const Anthropic = require('@anthropic-ai/sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const Groq = require('groq-sdk');

// ── In-memory rate-limit tracker (resets every minute) ────────────────────────
const rateTracker = {
  claude: { count: 0, resetAt: Date.now() + 60_000 },
  gemini: { count: 0, resetAt: Date.now() + 60_000 },
  groq:   { count: 0, resetAt: Date.now() + 60_000 },
  bytez:  { count: 0, resetAt: Date.now() + 60_000 },
};

const LIMITS = { claude: 50, gemini: 14, groq: 28, bytez: 50 };

function canUse(provider) {
  const t = rateTracker[provider];
  if (Date.now() > t.resetAt) { t.count = 0; t.resetAt = Date.now() + 60_000; }
  return t.count < LIMITS[provider];
}
function tick(provider) { rateTracker[provider].count++; }

// ── Claude claude-haiku-4-5 call (priority 1 — best JSON instruction-following) ──────────────
async function callClaude(systemPrompt, userPrompt) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  tick('claude');
  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 16000,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
    temperature: 0.4,
  });
  const raw = message.content[0]?.text || '{}';
  return parseJSON(raw, 'Claude');
}

// ── Gemini call (upgraded to 2.0 Flash) ──────────────────────────────────────
async function callGemini(systemPrompt, userPrompt) {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
    systemInstruction: systemPrompt,
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.4,
      maxOutputTokens: 16384,
    },
  });

  tick('gemini');
  const result = await model.generateContent(userPrompt);
  const raw = result.response.text();
  return parseJSON(raw, 'Gemini');
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
    temperature: 0.4,
    max_tokens: 16384,
    response_format: { type: 'json_object' },
  });
  const raw = completion.choices[0]?.message?.content || '{}';
  return parseJSON(raw, 'Groq');
}

// ── Bytez call (Qwen3-4B — emergency fallback) ──────────────────────────────
async function callBytez(systemPrompt, userPrompt) {
  const apiKey = process.env.BYTEZ_API_KEY;
  if (!apiKey) throw new Error('BYTEZ_API_KEY not set');

  tick('bytez');
  const res = await fetch('https://api.bytez.com/models/v2/Qwen/Qwen3-4B', {
    method: 'POST',
    headers: {
      'Authorization': `Key ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messages: [
        { role: 'system', content: systemPrompt + '\n\nIMPORTANT: Respond ONLY with valid JSON. No markdown, no explanation.' },
        { role: 'user',   content: userPrompt },
      ],
      stream: false,
      params: { temperature: 0.4, max_length: 8192 },
    }),
  });

  if (!res.ok) throw new Error(`Bytez HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(`Bytez error: ${data.error}`);
  const raw = data.output?.content || '';
  return parseJSON(raw, 'Bytez');
}

// ── Robust JSON parser ──────────────────────────────────────────────────────
function stripMarkdownFences(raw) {
  return String(raw || '').replace(/```json|```/g, '').trim();
}

function parseJSON(raw, provider) {
  const cleaned = stripMarkdownFences(raw);
  // Try direct parse
  try { return JSON.parse(cleaned); } catch {}
  // Try extracting largest JSON object
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) {
    try { return JSON.parse(match[0]); } catch {}
  }
  throw new Error(`${provider} JSON parse failed`);
}

// ── Vision: Claude (image + text) ─────────────────────────────────────────────
async function callVisionClaude(systemPrompt, userPrompt, imageBase64, mediaType) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  tick('claude');
  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
        { type: 'text', text: userPrompt },
      ],
    }],
    temperature: 0.3,
  });
  const raw = message.content[0]?.text || '{}';
  return parseJSON(raw, 'Claude Vision');
}

// ── Vision: Gemini (image + text) ─────────────────────────────────────────────
async function callVisionGemini(systemPrompt, userPrompt, imageBase64, mediaType) {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
    systemInstruction: systemPrompt,
    generationConfig: { responseMimeType: 'application/json', temperature: 0.3, maxOutputTokens: 4096 },
  });
  tick('gemini');
  const result = await model.generateContent([
    { inlineData: { data: imageBase64, mimeType: mediaType } },
    userPrompt,
  ]);
  const raw = result.response.text();
  return parseJSON(raw, 'Gemini Vision');
}

// ── Vision: Groq LLaMA (fallback) ─────────────────────────────────────────────
async function callVisionGroq(systemPrompt, userPrompt, imageBase64, mediaType) {
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  tick('groq');
  const completion = await groq.chat.completions.create({
    model: 'meta-llama/llama-4-scout-17b-16e-instruct',
    messages: [
      { role: 'system', content: systemPrompt + '\n\nIMPORTANT: Respond ONLY with valid JSON. No markdown, no explanation.' },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:${mediaType};base64,${imageBase64}` } },
          { type: 'text', text: userPrompt },
        ],
      },
    ],
    temperature: 0.3,
    max_tokens: 4096,
  });
  const raw = completion.choices[0]?.message?.content || '{}';
  return parseJSON(raw, 'Groq Vision');
}

// ── Vision: auto-selects Claude → Gemini → Groq ──────────────────────────────
async function callVisionAI(systemPrompt, userPrompt, imageBase64, mediaType = 'image/jpeg') {
  const providers = [
    { name: 'Claude Vision', key: 'ANTHROPIC_API_KEY', tracker: 'claude', fn: callVisionClaude },
    { name: 'Gemini Vision', key: 'GEMINI_API_KEY',    tracker: 'gemini', fn: callVisionGemini },
    { name: 'Groq Vision',   key: 'GROQ_API_KEY',      tracker: 'groq',   fn: callVisionGroq  },
  ];
  const errors = [];
  for (const p of providers) {
    if (!process.env[p.key]) { errors.push(`${p.name}: key not set`); continue; }
    if (!canUse(p.tracker)) { errors.push(`${p.name}: rate-limited`); continue; }
    try {
      console.log(`👁️ [Vision AI] Provider: ${p.name}`);
      return await p.fn(systemPrompt, userPrompt, imageBase64, mediaType);
    } catch (err) {
      console.warn(`⚠️ [Vision AI] ${p.name} failed: ${err.message}`);
      errors.push(`${p.name}: ${err.message}`);
    }
  }
  throw new Error(`Vision AI unavailable. ${errors.join(' | ')}`);
}

// ── Main exported function — auto-selects provider ────────────────────────────
async function callClaudeText(systemPrompt, userPrompt) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  tick('claude');
  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
    temperature: 0.4,
  });
  return stripMarkdownFences(message.content[0]?.text || '');
}

async function callGeminiText(systemPrompt, userPrompt) {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
    systemInstruction: systemPrompt,
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 16384,
    },
  });

  tick('gemini');
  const result = await model.generateContent(userPrompt);
  return stripMarkdownFences(result.response.text());
}

async function callGroqText(systemPrompt, userPrompt) {
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  tick('groq');
  const completion = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.4,
    max_tokens: 16384,
  });
  return stripMarkdownFences(completion.choices[0]?.message?.content || '');
}

async function callBytezText(systemPrompt, userPrompt) {
  const apiKey = process.env.BYTEZ_API_KEY;
  if (!apiKey) throw new Error('BYTEZ_API_KEY not set');

  tick('bytez');
  const res = await fetch('https://api.bytez.com/models/v2/Qwen/Qwen3-4B', {
    method: 'POST',
    headers: {
      'Authorization': `Key ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      stream: false,
      params: { temperature: 0.4, max_length: 8192 },
    }),
  });

  if (!res.ok) throw new Error(`Bytez HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(`Bytez error: ${data.error}`);
  return stripMarkdownFences(data.output?.content || '');
}

async function callAI(systemPrompt, userPrompt) {
  const providers = [
    { name: 'Claude claude-haiku-4-5',     key: 'ANTHROPIC_API_KEY', tracker: 'claude', fn: callClaude },
    { name: 'Gemini 2.0 Flash',    key: 'GEMINI_API_KEY',   tracker: 'gemini', fn: callGemini },
    { name: 'Groq llama-3.3-70b',  key: 'GROQ_API_KEY',    tracker: 'groq',   fn: callGroq },
    { name: 'Bytez Qwen3-4B',      key: 'BYTEZ_API_KEY',   tracker: 'bytez',  fn: callBytez },
  ];

  const errors = [];

  for (const p of providers) {
    if (!process.env[p.key]) continue;
    if (!canUse(p.tracker)) { errors.push(`${p.name}: rate-limited`); continue; }

    try {
      console.log(`🤖 [AI] Provider: ${p.name}`);
      return await p.fn(systemPrompt, userPrompt);
    } catch (err) {
      console.warn(`⚠️ [AI] ${p.name} failed: ${err.message}`);
      errors.push(`${p.name}: ${err.message}`);
    }
  }

  throw new Error(`Κανένα AI provider δεν είναι διαθέσιμο. ${errors.join(' | ')}`);
}

async function callAIText(systemPrompt, userPrompt) {
  const providers = [
    { name: 'Claude claude-haiku-4-5', key: 'ANTHROPIC_API_KEY', tracker: 'claude', fn: callClaudeText },
    { name: 'Gemini 2.0 Flash', key: 'GEMINI_API_KEY', tracker: 'gemini', fn: callGeminiText },
    { name: 'Groq llama-3.3-70b', key: 'GROQ_API_KEY', tracker: 'groq', fn: callGroqText },
    { name: 'Bytez Qwen3-4B', key: 'BYTEZ_API_KEY', tracker: 'bytez', fn: callBytezText },
  ];

  const errors = [];

  for (const p of providers) {
    if (!process.env[p.key]) continue;
    if (!canUse(p.tracker)) { errors.push(`${p.name}: rate-limited`); continue; }

    try {
      console.log(`📝 [AI Text] Provider: ${p.name}`);
      const raw = await p.fn(systemPrompt, userPrompt);
      if (raw && raw.trim()) return raw.trim();
      errors.push(`${p.name}: empty response`);
    } catch (err) {
      console.warn(`⚠️ [AI Text] ${p.name} failed: ${err.message}`);
      errors.push(`${p.name}: ${err.message}`);
    }
  }

  throw new Error(`Κανένας AI text provider δεν είναι διαθέσιμος. ${errors.join(' | ')}`);
}

module.exports = { callAI, callAIText, callVisionAI };
