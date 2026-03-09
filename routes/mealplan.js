// routes/mealplan.js — AI Meal Planner powered by Groq (llama-3.3-70b-versatile)
const express = require('express');
const Groq    = require('groq-sdk');
const router  = express.Router();
const Product = require('../models/Product');

const normalize  = (text) => (text||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');

async function findBestPrice(ingredient) {
  const words = normalize(ingredient).split(/\s+/).filter(w => w.length > 2);
  if (!words.length) return null;
  const queries = [
    words.map(w => ({ normalizedName: { $regex: escapeRegex(w), $options:'i' } })),
    [{ normalizedName: { $regex: escapeRegex(words[0]), $options:'i' } }],
  ];
  for (const f of queries) {
    const r = await Product.find({ $and: f }).sort({ price:1 }).limit(3).lean();
    if (r.length) return { name:r[0].name, price:r[0].price, store:r[0].supermarket, unit:r[0].pricePerUnit||null };
  }
  return null;
}

async function callGroq(prompt) {
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  const completion = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      { role:'system', content:'Είσαι ειδικός διατροφολόγος. Απαντάς ΜΟΝΟ σε raw JSON format, χωρίς markdown, χωρίς πρόλογο.' },
      { role:'user',   content: prompt },
    ],
    temperature: 0.6,
    max_tokens: 8192,
    response_format: { type:'json_object' },
  });
  const raw = completion.choices[0]?.message?.content || '{}';
  try { return JSON.parse(raw.replace(/```json|```/g,'').trim()); }
  catch { const m = raw.match(/\{[\s\S]*\}/); if (m) return JSON.parse(m[0]); throw new Error('JSON parse failed'); }
}

function buildPrompt({ persons, budget, restrictions, goal, days }) {
  const goalMap = { balanced:'ισορροπημένη διατροφή', weightloss:'απώλεια βάρους', muscle:'μυϊκή ανάπτυξη', budget:'οικονομική διατροφή' };
  return `Δημιούργησε πρόγραμμα διατροφής ${days} ημερών.
Άτομα: ${persons}, Budget: ${budget}€/εβδομάδα, Περιορισμοί: ${restrictions?.join(', ')||'Κανένας'}, Στόχος: ${goalMap[goal]||goalMap.balanced}.
Κανόνες: κάθε ημέρα έχει breakfast/lunch/dinner, υλικά σε απλά ελληνικά ονόματα.
Επέστρεψε ΜΟΝΟ raw JSON:
{"plan":[{"day":1,"dayName":"Δευτέρα","meals":{"breakfast":{"name":"...","description":"...","time":10,"macros":{"kcal":350,"protein":15,"carbs":45,"fat":10},"ingredients":["υλικό"]},"lunch":{"name":"...","description":"...","time":25,"macros":{"kcal":550,"protein":35,"carbs":55,"fat":18},"ingredients":["υλικό"]},"dinner":{"name":"...","description":"...","time":30,"macros":{"kcal":480,"protein":30,"carbs":40,"fat":20},"ingredients":["υλικό"]}},"dayMacros":{"kcal":1380,"protein":80,"carbs":140,"fat":48}}],"summary":{"totalDays":${days},"avgKcalPerDay":1400,"avgProteinPerDay":85,"estimatedIngredients":["γάλα","αυγά","κοτόπουλο"]}}`;
}

router.post('/', async (req, res) => {
  const { persons=2, budget=80, restrictions=[], goal='balanced', days=7 } = req.body;
  if (!process.env.GROQ_API_KEY) return res.status(500).json({ message:'Λείπει το GROQ_API_KEY στο .env' });
  try {
    console.log('🤖 Groq llama-3.3-70b-versatile meal plan...');
    const planData = await callGroq(buildPrompt({ persons, budget, restrictions, goal, days }));
    if (!planData?.plan?.length) return res.status(500).json({ message:'Το AI δεν επέστρεψε πλάνο.' });

    const allIngredients = new Set();
    planData.plan.forEach(d => Object.values(d.meals).forEach(m => (m.ingredients||[]).forEach(i => allIngredients.add(i.toLowerCase().trim()))));
    (planData.summary?.estimatedIngredients||[]).forEach(i => allIngredients.add(i.toLowerCase().trim()));

    const priceMap = {};
    await Promise.all([...allIngredients].map(async i => { const r = await findBestPrice(i); if(r) priceMap[i]=r; }));

    const shoppingList = [...allIngredients].map(i => ({
      ingredient:i, found:!!priceMap[i], price:priceMap[i]?.price||null,
      store:priceMap[i]?.store||null, productName:priceMap[i]?.name||i, unit:priceMap[i]?.unit||null,
    })).sort((a,b) => a.found===b.found ? 0 : a.found ? -1 : 1);

    const enrichedPlan = planData.plan.map(d => ({
      ...d,
      meals: Object.fromEntries(Object.entries(d.meals).map(([t,m]) => [t,{
        ...m,
        ingredients:(m.ingredients||[]).map(i => ({ name:i, found:!!priceMap[i.toLowerCase().trim()], price:priceMap[i.toLowerCase().trim()]?.price||null, store:priceMap[i.toLowerCase().trim()]?.store||null })),
      }])),
    }));

    const found = shoppingList.filter(i => i.found).length;
    const cost  = shoppingList.filter(i => i.found).reduce((s,i) => s+(i.price||0), 0);
    res.json({ plan:enrichedPlan, summary:planData.summary, shoppingList, stats:{ totalIngredients:allIngredients.size, foundInDB:found, notFound:allIngredients.size-found, estimatedCost:Math.round(cost*100)/100, coveragePercent:Math.round(found/allIngredients.size*100) } });
  } catch(err) {
    console.error('❌ Meal Plan:', err.message);
    res.status(500).json({ message:`Σφάλμα AI: ${err.message}` });
  }
});

module.exports = router;