// routes/mealplan.js — Premium AI Meal Planner (Groq llama-3.3-70b-versatile)
// Evidence-based nutrition: whole foods, Mediterranean diet principles,
// high protein, complete micronutrients, Zigzag calorie cycling
const express = require('express');
const Groq    = require('groq-sdk');
const router  = express.Router();
const Product = require('../models/Product');

const normalize   = (t) => (t||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();
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
      {
        role: 'system',
        content: `Είσαι πιστοποιημένος διαιτολόγος με εξειδίκευση στη Μεσογειακή διατροφή και αθλητική διατροφή. 
Ακολουθείς αυστηρά επιστημονικές κατευθυντήριες γραμμές (EFSA, WHO, Αμερικανική Ακαδημία Διατροφής).
Δίνεις έμφαση σε: τοπικά ελληνικά/μεσογειακά προϊόντα, αγνά υλικά, πλήρη πρόσληψη μικροθρεπτικών.
Απαντάς ΜΟΝΟ σε raw JSON χωρίς markdown, χωρίς κείμενο εκτός JSON.`
      },
      { role:'user', content: prompt },
    ],
    temperature: 0.5,
    max_tokens: 8192,
    response_format: { type:'json_object' },
  });
  const raw = completion.choices[0]?.message?.content || '{}';
  try { return JSON.parse(raw.replace(/```json|```/g,'').trim()); }
  catch { const m = raw.match(/\{[\s\S]*\}/); if (m) return JSON.parse(m[0]); throw new Error('JSON parse failed'); }
}

function buildPrompt({ persons, budget, restrictions, goal, days, tdee, zigzag, gender, age, weight, height, activityLevel }) {
  const isVegan = restrictions?.includes('vegan');
  const isVegetarian = restrictions?.includes('vegetarian') || isVegan;
  const restrText = restrictions?.length ? restrictions.join(', ') : 'Κανένας';

  const goalMap = {
    balanced:   'ισορροπημένη Μεσογειακή διατροφή',
    weightloss: 'απώλεια βάρους (θερμιδικό έλλειμμα, υψηλή πρωτεΐνη)',
    muscle:     'μυϊκή ανάπτυξη (2g πρωτεΐνη/kg σωματικού βάρους, πλεόνασμα θερμίδων)',
    budget:     'οικονομική αλλά θρεπτική διατροφή',
  };

  const calTarget = tdee ? `${tdee} kcal/ημέρα (TDEE υπολογισμένο)` : 'ισορροπημένες θερμίδες';
  const zigzagInfo = zigzag ? `Zigzag ημέρες: ${zigzag.join(', ')} kcal` : '';
  const personInfo = (age && weight && height)
    ? `Προφίλ: ${gender==='male'?'Άνδρας':'Γυναίκα'}, ${age} ετών, ${height}cm, ${weight}kg, δραστηριότητα: ${activityLevel}`
    : '';

  const meatGuidelines = isVegan
    ? 'VEGAN: Μόνο φυτικές πρωτεΐνες (όσπρια, tofu, τέμπε, quinoa, ξηροί καρποί). Υποχρεωτικό B12 από εμπλουτισμένα τρόφιμα.'
    : isVegetarian
    ? 'VEGETARIAN: Αυγά, γαλακτοκομικά, φυτικές πρωτεΐνες. Ψάρι ΜΟΝΟ αν η συνταγή είναι pescatarian.'
    : `ΜΗ VEGAN: 
      - Πρωινό: Χωρίς κρέας. Καλά λιπαρά (αυγά, ελαιόλαδο, ξηροί καρποί, αβοκάντο, γιαούρτι, τυρί φέτα).
      - Μεσημεριανό (ΚΥΡΙΟ ΓΕΥΜΑ): Κρέας (κοτόπουλο, γαλοπούλα, αρνί, μοσχάρι) ΜΕ συνοδευτικό (λαχανικά, ρύζι, πατάτες, ψωμί). ΕΞΑΙΡΕΣΗ: 1-2 φορές/εβδομάδα ψάρι (σαρδέλες, τσιπούρα, σολομός) ή τόνος σε σαλάτα.
      - Βραδινό: Ελαφρύ (σαλάτες, γιαούρτι, τυρί, λαχανικά, αυγά, σούπα).`;

  const nutritionRules = `
ΚΑΝΟΝΕΣ ΔΙΑΤΡΟΦΗΣ (αυστηρά):
1. Πρωτεΐνη: ΤΟΥΛΑΧΙΣΤΟΝ 30g ανά γεύμα (συνολικά 1.6-2.2g/kg για άτομο)
2. Ίνες: 25-35g/ημέρα (λαχανικά, όσπρια, δημητριακά ολικής)
3. Καλά λιπαρά: Ελαιόλαδο, αβοκάντο, ξηροί καρποί, λιπαρά ψάρια
4. Μικροθρεπτικά: Κάθε ημέρα να περιέχει: Vit C (εσπεριδοειδή/πιπεριές), Vit D (αυγά/ψάρι/εκτός αν vegan), Σίδηρο, Ασβέστιο, Μαγνήσιο
5. ΑΠΟΦΥΓΗ: Επεξεργασμένα τρόφιμα, ζάχαρη, trans λιπαρά, fast food
6. ΕΛΛΗΝΙΚΑ ΠΡΟΪΟΝΤΑ: Φέτα, ελιές, ελαιόλαδο, ντομάτα, αγγούρι, κολοκυθάκια, μελιτζάνες, κριθαράκι, χόρτα, μέλι, γιαούρτι στραγγιστό
7. Νερό: Υπενθύμιση 8-10 ποτήρια/ημέρα σε κάθε ημέρα`;

  return `${personInfo}
Στόχος θερμίδων: ${calTarget}
${zigzagInfo}
Στόχος διατροφής: ${goalMap[goal] || goalMap.balanced}
Άτομα: ${persons}, Ημέρες: ${days}, Budget: ${budget}€/εβδομάδα
Περιορισμοί: ${restrText}

${meatGuidelines}
${nutritionRules}

Δημιούργησε πλάνο ${days} ημερών με ΠΡΑΓΜΑΤΙΚΕΣ Ελληνικές/Μεσογειακές συνταγές.
Το πρωινό ΠΑΝΤΑ ελαφρύ (300-450 kcal), το μεσημεριανό ΠΑΝΤΑ κυρίως γεύμα (600-800 kcal), το βραδινό ΠΑΝΤΑ ελαφρύ (350-500 kcal).

Επέστρεψε ΜΟΝΟ αυτό το JSON:
{
  "plan": [
    {
      "day": 1,
      "dayName": "Δευτέρα",
      "waterGlasses": 8,
      "meals": {
        "breakfast": {
          "name": "Ομελέτα με φέτα και ντομάτα",
          "description": "Κλασική ελληνική ομελέτα με φρέσκα λαχανικά",
          "prepTip": "Χρησιμοποίησε ελαιόλαδο αντί βούτυρο",
          "time": 10,
          "macros": { "kcal": 380, "protein": 22, "carbs": 12, "fat": 28, "fiber": 2 },
          "micronutrients": ["Vit B12", "Σελήνιο", "Χολίνη"],
          "ingredients": ["αυγά", "φέτα", "ντομάτα", "ελαιόλαδο", "μαϊντανός"]
        },
        "lunch": {
          "name": "Κοτόπουλο με ρύζι και σαλάτα",
          "description": "Ψητό κοτόπουλο με ρύζι basmati και χωριάτικη σαλάτα",
          "prepTip": "Μαρινάρισε με λεμόνι, ελαιόλαδο, ρίγανη",
          "time": 35,
          "macros": { "kcal": 650, "protein": 48, "carbs": 58, "fat": 18, "fiber": 5 },
          "micronutrients": ["Vit B3", "Σελήνιο", "Φώσφορος", "Vit C"],
          "ingredients": ["κοτόπουλο", "ρύζι basmati", "ντομάτα", "αγγούρι", "ελιές", "φέτα", "λεμόνι", "ελαιόλαδο"]
        },
        "dinner": {
          "name": "Γιαούρτι με μέλι και καρύδια",
          "description": "Στραγγιστό γιαούρτι με ελληνικό μέλι, καρύδια και κανέλα",
          "prepTip": "Χρησιμοποίησε γιαούρτι 2% ή πλήρες",
          "time": 5,
          "macros": { "kcal": 320, "protein": 20, "carbs": 28, "fat": 12, "fiber": 1 },
          "micronutrients": ["Ασβέστιο", "Προβιοτικά", "Vit D", "Ωμέγα-3"],
          "ingredients": ["γιαούρτι στραγγιστό", "μέλι", "καρύδια", "κανέλα"]
        }
      },
      "dayMacros": { "kcal": 1350, "protein": 90, "carbs": 98, "fat": 58, "fiber": 8 },
      "nutritionNote": "Σήμερα υψηλή πρωτεΐνη από αυγά + κοτόπουλο. Καλά λιπαρά από ελαιόλαδο και καρύδια."
    }
  ],
  "summary": {
    "totalDays": ${days},
    "avgKcalPerDay": 1400,
    "avgProteinPerDay": 95,
    "avgFiberPerDay": 28,
    "keyNutrients": ["Πρωτεΐνη", "Ωμέγα-3", "Vit C", "Ασβέστιο", "Σίδηρος"],
    "dietStyle": "Μεσογειακή",
    "estimatedIngredients": ["αυγά", "κοτόπουλο", "γιαούρτι στραγγιστό", "φέτα", "ελαιόλαδο", "ρύζι", "ντομάτες", "αγγούρι"]
  }
}`;
}

router.post('/', async (req, res) => {
  const {
    persons=2, budget=80, restrictions=[], goal='balanced', days=7,
    tdee=null, zigzag=null, gender='male', age=30, weight=75, height=175, activityLevel='moderate'
  } = req.body;

  if (!process.env.GROQ_API_KEY)
    return res.status(500).json({ message: 'Λείπει το GROQ_API_KEY στο .env' });

  try {
    console.log(`🤖 Groq llama-3.3-70b | ${days}d | TDEE:${tdee||'auto'} | Goal:${goal}`);
    const planData = await callGroq(buildPrompt({ persons, budget, restrictions, goal, days, tdee, zigzag, gender, age, weight, height, activityLevel }));
    if (!planData?.plan?.length)
      return res.status(500).json({ message: 'Το AI δεν επέστρεψε πλάνο.' });

    const allIngredients = new Set();
    planData.plan.forEach(d =>
      Object.values(d.meals).forEach(m => (m.ingredients||[]).forEach(i => allIngredients.add(i.toLowerCase().trim())))
    );
    (planData.summary?.estimatedIngredients||[]).forEach(i => allIngredients.add(i.toLowerCase().trim()));

    const priceMap = {};
    await Promise.all([...allIngredients].map(async i => { const r = await findBestPrice(i); if(r) priceMap[i]=r; }));

    const shoppingList = [...allIngredients].map(i => ({
      ingredient:i, found:!!priceMap[i], price:priceMap[i]?.price||null,
      store:priceMap[i]?.store||null, productName:priceMap[i]?.name||i, unit:priceMap[i]?.unit||null,
    })).sort((a,b) => a.found===b.found ? 0 : a.found ? -1 : 1);

    const enrichedPlan = planData.plan.map(d => ({
      ...d,
      meals: Object.fromEntries(Object.entries(d.meals).map(([t,m]) => [t, {
        ...m,
        ingredients:(m.ingredients||[]).map(i => ({
          name:i, found:!!priceMap[i.toLowerCase().trim()],
          price:priceMap[i.toLowerCase().trim()]?.price||null,
          store:priceMap[i.toLowerCase().trim()]?.store||null,
        })),
      }])),
    }));

    const found = shoppingList.filter(i => i.found).length;
    const cost  = shoppingList.filter(i => i.found).reduce((s,i) => s+(i.price||0), 0);

    res.json({
      plan: enrichedPlan,
      summary: planData.summary,
      shoppingList,
      stats: {
        totalIngredients: allIngredients.size,
        foundInDB: found,
        notFound: allIngredients.size - found,
        estimatedCost: Math.round(cost*100)/100,
        coveragePercent: Math.round(found/allIngredients.size*100),
      },
    });
  } catch(err) {
    console.error('❌ Meal Plan:', err.message);
    res.status(500).json({ message: `Σφάλμα AI: ${err.message}` });
  }
});

module.exports = router;