// routes/mealplan.js — Premium AI Meal Planner
// Uses aiService.js → Gemini 1.5 Flash (primary) + Groq (fallback)
const express = require('express');
const router  = express.Router();
const Product = require('../models/Product');
const { callAI } = require('../services/aiService');

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

const SYSTEM_PROMPT = `Είσαι πιστοποιημένος διαιτολόγος και σεφ με εξειδίκευση στη Μεσογειακή και Ελληνική κουζίνα.
Δημιουργείς ΡΕΑΛΙΣΤΙΚΑ, ΜΑΓΕΙΡΕΨΙΜΑ γεύματα που φτιάχνονται πραγματικά σε ελληνικά σπίτια.
ΚΑΝΟΝΕΣ:
- Χρησιμοποίησε ΜΟΝΟ υλικά που πουλιούνται σε ελληνικά σούπερ μάρκετ (όχι εξωτικά).
- Τα ονόματα γευμάτων να είναι ΑΝΑΓΝΩΡΙΣΙΜΑ ελληνικά πιάτα (π.χ. Κοτόπουλο Σχάρας με Ρύζι, Φακές Σούπα, Μακαρόνια Μπολονέζ, Σαλάτα Χωριάτικη, Ντολμαδάκια, Στραγγιστό Γιαούρτι με Μέλι).
- Τα υλικά να έχουν ΣΥΓΚΕΚΡΙΜΕΝΕΣ ΠΟΣΟΤΗΤΕΣ (π.χ. "200γρ κοτόπουλο στήθος", "1 φλιτζάνι ρύζι", "2 αυγά μέτρια", "50γρ φέτα", "1 κουταλιά ελαιόλαδο").
- ΜΗΝ χρησιμοποιείς γενικούς όρους: γράψε "μοσχαρίσιος κιμάς" ΟΧΙ "κρέας", "κολοκύθια" ΟΧΙ "λαχανικά".
- Τα macros να είναι ΡΕΑΛΙΣΤΙΚΑ για τις συγκεκριμένες ποσότητες.
- description: 1-2 προτάσεις πώς παρασκευάζεται το πιάτο (απλά, κατανοητά).
- prepTip: 1 χρήσιμη συμβουλή μαγειρικής για αυτό το πιάτο.
Απαντάς ΜΟΝΟ σε raw JSON χωρίς markdown, χωρίς κείμενο εκτός JSON.`;

function buildPrompt({ persons, budget, restrictions, goal, days, tdee, zigzag, gender, age, weight, height, activityLevel }) {
  const isVegan       = restrictions?.includes('vegan');
  const isVegetarian  = restrictions?.includes('vegetarian') || isVegan;
  const restrText     = restrictions?.length ? restrictions.join(', ') : 'Κανένας';

  const goalMap = {
    balanced:   'ισορροπημένη Μεσογειακή διατροφή',
    weightloss: 'απώλεια βάρους (θερμιδικό έλλειμμα, υψηλή πρωτεΐνη)',
    muscle:     'μυϊκή ανάπτυξη (2g πρωτεΐνη/kg σωματικού βάρους, πλεόνασμα θερμίδων)',
    budget:     'οικονομική αλλά θρεπτική διατροφή',
  };

  const calTarget  = tdee ? `${tdee} kcal/ημέρα (TDEE υπολογισμένο)` : 'ισορροπημένες θερμίδες';
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
      - Μεσημεριανό (ΚΥΡΙΟ ΓΕΥΜΑ): Κρέας (κοτόπουλο, γαλοπούλα, αρνί, μοσχάρι) ΜΕ συνοδευτικό.
      - Βραδινό: Ελαφρύ (σαλάτες, γιαούρτι, τυρί, λαχανικά, αυγά, σούπα).`;

  return `${personInfo}
Στόχος θερμίδων: ${calTarget}
${zigzagInfo}
Στόχος διατροφής: ${goalMap[goal] || goalMap.balanced}
Άτομα: ${persons}, Ημέρες: ${days}, Budget: ${budget}€/εβδομάδα
Περιορισμοί: ${restrText}

${meatGuidelines}

ΚΑΝΟΝΕΣ ΔΙΑΤΡΟΦΗΣ (αυστηρά):
1. Πρωτεΐνη: ΤΟΥΛΑΧΙΣΤΟΝ 25g ανά γεύμα
2. Ίνες: 25-35g/ημέρα
3. Καλά λιπαρά: Ελαιόλαδο, αβοκάντο, ξηροί καρποί, λιπαρά ψάρια
4. ΕΛΛΗΝΙΚΑ ΠΡΟΪΟΝΤΑ: Φέτα, ελιές, ελαιόλαδο, ντομάτα, αγγούρι, κολοκυθάκια, χόρτα, μέλι, γιαούρτι στραγγιστό
5. Νερό: 8-10 ποτήρια/ημέρα
6. ΡΕΑΛΙΣΜΟΣ: Τα υλικά πρέπει να είναι συνηθισμένα — αυτά που βρίσκει κάποιος σε οποιοδήποτε ελληνικό σούπερ μάρκετ.
7. ΠΟΣΟΤΗΤΕΣ: Κάθε υλικό ΝΑ ΕΧΕΙ ποσότητα (γραμμάρια, φλιτζάνια, κομμάτια — ποτέ μόνο το όνομα).

Δημιούργησε πλάνο ${days} ημερών. Πρωινό (300-450 kcal), Μεσημεριανό (600-800 kcal), Βραδινό (350-500 kcal).

Επέστρεψε ΜΟΝΟ αυτό το JSON:
{
  "plan": [
    {
      "day": 1,
      "dayName": "Δευτέρα",
      "waterGlasses": 8,
      "meals": {
        "breakfast": {
          "name": "string",
          "description": "string",
          "prepTip": "string",
          "time": 10,
          "macros": { "kcal": 380, "protein": 22, "carbs": 12, "fat": 28, "fiber": 2 },
          "micronutrients": ["Vit B12"],
          "ingredients": ["αυγά", "φέτα"]
        },
        "lunch": {
          "name": "string",
          "description": "string",
          "prepTip": "string",
          "time": 35,
          "macros": { "kcal": 650, "protein": 48, "carbs": 58, "fat": 18, "fiber": 5 },
          "micronutrients": ["Vit B3"],
          "ingredients": ["κοτόπουλο", "ρύζι"]
        },
        "dinner": {
          "name": "string",
          "description": "string",
          "prepTip": "string",
          "time": 5,
          "macros": { "kcal": 320, "protein": 20, "carbs": 28, "fat": 12, "fiber": 1 },
          "micronutrients": ["Ασβέστιο"],
          "ingredients": ["γιαούρτι στραγγιστό", "μέλι"]
        }
      },
      "dayMacros": { "kcal": 1350, "protein": 90, "carbs": 98, "fat": 58, "fiber": 8 },
      "nutritionNote": "string"
    }
  ],
  "summary": {
    "totalDays": ${days},
    "avgKcalPerDay": 1400,
    "avgProteinPerDay": 95,
    "avgFiberPerDay": 28,
    "keyNutrients": ["Πρωτεΐνη", "Ωμέγα-3"],
    "dietStyle": "Μεσογειακή",
    "estimatedIngredients": ["αυγά", "κοτόπουλο"]
  }
}`;
}

router.post('/', async (req, res) => {
  const {
    persons=2, budget=80, restrictions=[], goal='balanced', days=7,
    tdee=null, zigzag=null, gender='male', age=30, weight=75, height=175, activityLevel='moderate'
  } = req.body;

  if (!process.env.GEMINI_API_KEY && !process.env.GROQ_API_KEY)
    return res.status(500).json({ message: 'Δεν βρέθηκε κανένα AI API key στο .env' });

  try {
    const planData = await callAI(
      SYSTEM_PROMPT,
      buildPrompt({ persons, budget, restrictions, goal, days, tdee, zigzag, gender, age, weight, height, activityLevel })
    );

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