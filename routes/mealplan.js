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

// Extract grams from ingredient string like "200γρ κοτόπουλο στήθος" or "2 αυγά (120γρ)"
function extractGrams(ingredientStr) {
  if (typeof ingredientStr !== 'string') return null;
  const match = ingredientStr.match(/(\d+)\s*[γg]ρ?/i);
  return match ? parseInt(match[1]) : null;
}

// Estimate per-use cost from full product price
// Most supermarket products are sold per kg or per unit
// If pricePerUnit contains "/κιλ" or similar, calculate proportionally
function estimateIngredientCost(productPrice, pricePerUnit, gramsUsed) {
  if (!productPrice || !gramsUsed) return productPrice;
  // If we have a per-kilo price, use it directly
  if (pricePerUnit) {
    const perKiloMatch = pricePerUnit.match(/([\d,.]+)\s*€?\s*\/\s*κιλ/i);
    if (perKiloMatch) {
      const pricePerKg = parseFloat(perKiloMatch[1].replace(',', '.'));
      return Math.round(pricePerKg * gramsUsed / 1000 * 100) / 100;
    }
  }
  // Fallback: assume product is ~1kg, estimate proportionally
  // Cap at full product price
  const estimated = Math.round(productPrice * gramsUsed / 1000 * 100) / 100;
  return Math.min(estimated, productPrice);
}

const SYSTEM_PROMPT = `Είσαι πιστοποιημένος διαιτολόγος και σεφ με εξειδίκευση στη Μεσογειακή και Ελληνική κουζίνα.
Δημιουργείς ΡΕΑΛΙΣΤΙΚΑ, ΜΑΓΕΙΡΕΨΙΜΑ γεύματα που φτιάχνονται πραγματικά σε ελληνικά σπίτια.

═══ ΑΥΣΤΗΡΟΙ ΚΑΝΟΝΕΣ MACROS (ΥΠΟΧΡΕΩΤΙΚΟΙ) ═══

1. ΑΚΡΙΒΕΙΑ ΘΕΡΜΙΔΩΝ — Υπολόγισε ΠΡΩΤΑ τα macros ανά υλικό, ΜΕΤΑ άθροισέ τα:
   Για ΚΑΘΕ υλικό υπολόγισε: πρωτεΐνη, υδατάνθρακες, λιπαρά ανά 100γρ × ποσότητα/100
   Παράδειγμα 200γρ κοτόπουλο στήθος ωμό: 23g πρωτ/100g → 46g πρωτ, 0g carbs, 1.2g λιπ/100g → 2.4g λιπ
   ΤΕΛΟΣ: kcal = (Σ protein × 4) + (Σ carbs × 4) + (Σ fat × 9)

   ΑΝΑΦΟΡΑ MACROS ΑΝΑ 100g ΩΜΟ ΤΡΟΦΙΜΟ (χρησιμοποίησε αυτές τις τιμές):
   - Κοτόπουλο στήθος: 23g P, 0g C, 1.2g F → 104 kcal
   - Γαλοπούλα στήθος: 24g P, 0g C, 1g F → 105 kcal
   - Μοσχαρίσιος κιμάς: 19g P, 0g C, 12g F → 188 kcal
   - Χοιρινό: 21g P, 0g C, 7g F → 151 kcal
   - Σολομός: 20g P, 0g C, 13g F → 201 kcal
   - Αυγό (60γρ): 7.5g P, 0.6g C, 5.3g F → 80 kcal
   - Φέτα: 14g P, 1g C, 21g F → 250 kcal
   - Γιαούρτι στραγγιστό 2%: 10g P, 4g C, 2g F → 74 kcal
   - Ελαιόλαδο (1 κ.σ.=14γρ): 0g P, 0g C, 14g F → 126 kcal
   - Ρύζι (ωμό): 7g P, 78g C, 0.6g F → 345 kcal
   - Ζυμαρικά (ωμά): 13g P, 71g C, 1.5g F → 350 kcal
   - Φακές (ωμές): 25g P, 60g C, 1g F → 353 kcal
   - Πατάτες: 2g P, 17g C, 0.1g F → 77 kcal
   - Βρόμη: 13g P, 66g C, 7g F → 379 kcal
   - Ψωμί ολικής: 9g P, 43g C, 3g F → 237 kcal
   - Μέλι (1 κ.σ.=21γρ): 0g P, 17g C, 0g F → 64 kcal

2. ΡΕΑΛΙΣΤΙΚΟ ΕΛΑΙΟΛΑΔΟ: Κάθε μαγειρεμένο γεύμα: ΤΟΥΛΑΧΙΣΤΟΝ 1 κ.σ. (14γρ = 126kcal). Σαλάτες: 1-2 κ.σ. Μην βάζεις ποτέ κάτω από 10γρ.

3. ΠΟΙΚΙΛΙΑ (ΚΡΙΣΙΜΟ — ΚΑΝΕΝΑ γεύμα δεν επαναλαμβάνεται):
   - 7 ΔΙΑΦΟΡΕΤΙΚΑ πρωινά (ομελέτα, βρόμη, τοστ, γιαούρτι-μέλι-granola, pancake βρώμης, αυγά ποσέ, smoothie bowl)
   - 7 ΔΙΑΦΟΡΕΤΙΚΑ μεσημεριανά (κοτόπουλο ψητό, φακές, ψάρι, μοσχάρι/κιμάς, μακαρόνια, αρνάκι/χοιρινό, γεμιστά/μπριάμ)
   - 7 ΔΙΑΦΟΡΕΤΙΚΑ βραδινά (σαλάτα χωριάτικη, σούπα, ομελέτα λαχανικών, γιαούρτι, τόνος σαλάτα, ψητά λαχανικά, αυγά-τυρί)
   ΜΗΝ επαναλαμβάνεις κανένα γεύμα. Κάθε ημέρα ΠΡΕΠΕΙ να είναι μοναδική.

4. ΡΕΑΛΙΣΤΙΚΕΣ ΠΟΣΟΤΗΤΕΣ (γραμμάρια ωμά, ΑΝΑ ΑΤΟΜΟ):
   - Κρέας/ψάρι: 150-250γρ
   - Ρύζι/ζυμαρικά: 70-100γρ ωμό
   - Όσπρια: 80-120γρ ωμά
   - Λαχανικά: 150-300γρ
   - Ελαιόλαδο: 14-28γρ (1-2 κ.σ.)
   - Τυρί φέτα: 40-60γρ
   - Γιαούρτι: 150-200γρ
   - Αυγά: 2-3 τεμ (120-180γρ)

═══ ΓΕΝΙΚΟΙ ΚΑΝΟΝΕΣ ═══
- ΜΟΝΟ υλικά από ελληνικά σούπερ μάρκετ
- Ονόματα: ΑΝΑΓΝΩΡΙΣΙΜΑ ελληνικά πιάτα
- Κάθε υλικό: ποσότητα σε γραμμάρια (ωμό βάρος)
- description: 2-3 προτάσεις παρασκευής (σαφείς, βήμα-βήμα)
- prepTip: 1 χρήσιμη συμβουλή
- Κάθε γεύμα: ΤΟΥΛΑΧΙΣΤΟΝ 3 υλικά, ΜΗΝ κάνεις γεύματα με 1-2 υλικά μόνο
Απαντάς ΜΟΝΟ σε raw JSON χωρίς markdown, χωρίς κείμενο εκτός JSON.`;

function buildPrompt({ persons, budget, restrictions, goal, days, tdee, zigzag, gender, age, weight, height, activityLevel, macroRatios }) {
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

  // Build macro ratio instructions
  const mr = macroRatios || { protein: 30, carbs: 40, fat: 30 };
  const totalPct = (mr.protein || 30) + (mr.carbs || 40) + (mr.fat || 30);
  const proteinPct = Math.round((mr.protein / totalPct) * 100);
  const carbsPct   = Math.round((mr.carbs   / totalPct) * 100);
  const fatPct     = Math.round((mr.fat     / totalPct) * 100);

  // Calculate per-meal macro targets based on TDEE
  const dailyKcal = tdee || 1800;
  const proteinKcal = Math.round(dailyKcal * proteinPct / 100);
  const carbsKcal   = Math.round(dailyKcal * carbsPct   / 100);
  const fatKcal     = Math.round(dailyKcal * fatPct     / 100);
  const dailyProteinG = Math.round(proteinKcal / 4);
  const dailyCarbsG   = Math.round(carbsKcal   / 4);
  const dailyFatG     = Math.round(fatKcal     / 9);

  const macroInstructions = `
ΣΤΟΧΟΣ MACROS (αυστηρά — υπολόγισε kcal ΠΑΝΤΑ ως protein×4 + carbs×4 + fat×9):
  Ημερήσιος στόχος: ${dailyKcal} kcal | ${dailyProteinG}g πρωτεΐνη (${proteinPct}%) | ${dailyCarbsG}g υδατάνθρακες (${carbsPct}%) | ${dailyFatG}g λιπαρά (${fatPct}%)
  
  Κατανομή ανά γεύμα (ενδεικτική):
  - Πρωινό (~${Math.round(dailyKcal*0.25)} kcal): protein~${Math.round(dailyProteinG*0.25)}g, carbs~${Math.round(dailyCarbsG*0.25)}g, fat~${Math.round(dailyFatG*0.25)}g
  - Μεσημεριανό (~${Math.round(dailyKcal*0.40)} kcal): protein~${Math.round(dailyProteinG*0.40)}g, carbs~${Math.round(dailyCarbsG*0.40)}g, fat~${Math.round(dailyFatG*0.40)}g
  - Βραδινό (~${Math.round(dailyKcal*0.35)} kcal): protein~${Math.round(dailyProteinG*0.35)}g, carbs~${Math.round(dailyCarbsG*0.35)}g, fat~${Math.round(dailyFatG*0.35)}g

  ΥΠΟΧΡΕΩΤΙΚΟΣ ΕΛΕΓΧΟΣ: Πριν γράψεις το JSON κάθε γεύματος, ΥΠΟΛΟΓΙΣΕ:
  kcal_check = (protein × 4) + (carbs × 4) + (fat × 9)
  Βεβαιώσου ότι το kcal στο JSON ΙΣΟΥΤΑΙ με το kcal_check (±5 kcal ανοχή).`;

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

${macroInstructions}

${meatGuidelines}

ΚΑΝΟΝΕΣ ΔΙΑΤΡΟΦΗΣ (αυστηρά):
1. Πρωτεΐνη: ΤΟΥΛΑΧΙΣΤΟΝ 25g ανά γεύμα
2. Ίνες: 25-35g/ημέρα
3. Καλά λιπαρά: Ελαιόλαδο MIN 1 κ.σ. (14γρ) σε κάθε μαγειρεμένο γεύμα
4. ΕΛΛΗΝΙΚΑ ΠΡΟΪΟΝΤΑ: Φέτα, ελιές, ελαιόλαδο, ντομάτα, αγγούρι, κολοκυθάκια, χόρτα, μέλι, γιαούρτι στραγγιστό
5. ΠΟΣΟΤΗΤΕΣ: Κάθε υλικό ΝΑ ΕΧΕΙ ποσότητα σε γραμμάρια (ωμό βάρος)
6. ΠΟΙΚΙΛΙΑ: Εναλλαγή 4+ πρωινών, 5+ μεσημεριανών, 5+ βραδινών — μην επαναλαμβάνεις

Δημιούργησε πλάνο ${days} ημερών.

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
          "macros": { "kcal": 380, "protein": 22, "carbs": 40, "fat": 20 },
          "macroCheck": "22×4 + 40×4 + 20×9 = 88+160+180 = 428 — ΔΙΟΡΘΩΣΕ αν δεν βγαίνει",
          "micronutrients": ["Vit B12"],
          "ingredients": ["200γρ αυγά (4 αυγά)", "30γρ φέτα", "15γρ ελαιόλαδο (1 κ.σ.)"]
        },
        "lunch": {
          "name": "string",
          "description": "string",
          "prepTip": "string",
          "time": 35,
          "macros": { "kcal": 650, "protein": 48, "carbs": 58, "fat": 22 },
          "macroCheck": "48×4 + 58×4 + 22×9 = 192+232+198 = 622 — ΔΙΟΡΘΩΣΕ αν δεν βγαίνει",
          "micronutrients": ["Vit B3"],
          "ingredients": ["200γρ κοτόπουλο στήθος", "80γρ ρύζι (ωμό)", "20γρ ελαιόλαδο (1.5 κ.σ.)"]
        },
        "dinner": {
          "name": "string",
          "description": "string",
          "prepTip": "string",
          "time": 5,
          "macros": { "kcal": 320, "protein": 20, "carbs": 28, "fat": 12 },
          "macroCheck": "20×4 + 28×4 + 12×9 = 80+112+108 = 300 — ΔΙΟΡΘΩΣΕ αν δεν βγαίνει",
          "micronutrients": ["Ασβέστιο"],
          "ingredients": ["180γρ γιαούρτι στραγγιστό 2%", "15γρ μέλι", "30γρ καρύδια"]
        }
      },
      "dayMacros": { "kcal": 1350, "protein": 90, "carbs": 126, "fat": 54 },
      "nutritionNote": "string"
    }
  ],
  "summary": {
    "totalDays": ${days},
    "avgKcalPerDay": ${dailyKcal},
    "avgProteinPerDay": ${dailyProteinG},
    "avgFiberPerDay": 28,
    "macroRatioAchieved": { "protein": ${proteinPct}, "carbs": ${carbsPct}, "fat": ${fatPct} },
    "keyNutrients": ["Πρωτεΐνη", "Ωμέγα-3"],
    "dietStyle": "Μεσογειακή",
    "estimatedIngredients": ["αυγά", "κοτόπουλο"]
  }
}`;
}

router.post('/', async (req, res) => {
  const {
    persons=2, budget=80, restrictions=[], goal='balanced', days=7,
    tdee=null, zigzag=null, gender='male', age=30, weight=75, height=175, activityLevel='moderate',
    macroRatios={ protein:30, carbs:40, fat:30 },
  } = req.body;

  if (!process.env.GEMINI_API_KEY && !process.env.GROQ_API_KEY)
    return res.status(500).json({ message: 'Δεν βρέθηκε κανένα AI API key στο .env' });

  // Normalise macroRatios so they always sum to 100
  const mrTotal = (macroRatios.protein||30) + (macroRatios.carbs||40) + (macroRatios.fat||30);
  const normMR = {
    protein: Math.round((macroRatios.protein||30) / mrTotal * 100),
    carbs:   Math.round((macroRatios.carbs||40)   / mrTotal * 100),
    fat:     Math.round((macroRatios.fat||30)      / mrTotal * 100),
  };

  // Fix any rounding drift
  const diff = 100 - normMR.protein - normMR.carbs - normMR.fat;
  normMR.carbs += diff;

  try {
    const planData = await callAI(
      SYSTEM_PROMPT,
      buildPrompt({ persons, budget, restrictions, goal, days, tdee, zigzag, gender, age, weight, height, activityLevel, macroRatios: normMR })
    );

    if (!planData?.plan?.length)
      return res.status(500).json({ message: 'Το AI δεν επέστρεψε πλάνο.' });

    // ── Server-side macro correction: enforce kcal = P×4 + C×4 + F×9 ────────
    planData.plan = planData.plan.map(day => ({
      ...day,
      meals: Object.fromEntries(
        Object.entries(day.meals).map(([mealType, meal]) => {
          if (meal?.macros) {
            const p = meal.macros.protein || 0;
            const c = meal.macros.carbs   || 0;
            const f = meal.macros.fat     || 0;
            meal.macros.kcal = Math.round(p * 4 + c * 4 + f * 9);
          }
          return [mealType, meal];
        })
      ),
    }));

    // Recompute dayMacros from corrected meal macros
    planData.plan = planData.plan.map(day => {
      const meals = Object.values(day.meals).filter(Boolean);
      day.dayMacros = {
        kcal:    meals.reduce((s, m) => s + (m.macros?.kcal    || 0), 0),
        protein: meals.reduce((s, m) => s + (m.macros?.protein || 0), 0),
        carbs:   meals.reduce((s, m) => s + (m.macros?.carbs   || 0), 0),
        fat:     meals.reduce((s, m) => s + (m.macros?.fat     || 0), 0),
      };
      return day;
    });
    // ── End macro correction ──────────────────────────────────────────────────

    // Collect all unique ingredients with their quantities
    const ingredientMap = new Map(); // name → { totalGrams, rawNames[] }
    planData.plan.forEach(d =>
      Object.values(d.meals).forEach(m => (m.ingredients||[]).forEach(i => {
        const rawName = typeof i === 'string' ? i : i;
        const cleanName = rawName.replace(/^\d+[γg]ρ?\s*/i,'').split('(')[0].trim().toLowerCase();
        const grams = extractGrams(rawName);
        if (!ingredientMap.has(cleanName)) {
          ingredientMap.set(cleanName, { totalGrams: 0, rawNames: [] });
        }
        const entry = ingredientMap.get(cleanName);
        if (grams) entry.totalGrams += grams;
        entry.rawNames.push(rawName);
      }))
    );
    (planData.summary?.estimatedIngredients||[]).forEach(i => {
      const key = i.toLowerCase().trim();
      if (!ingredientMap.has(key)) ingredientMap.set(key, { totalGrams: 0, rawNames: [i] });
    });

    const priceMap = {};
    await Promise.all([...ingredientMap.keys()].map(async i => { const r = await findBestPrice(i); if(r) priceMap[i]=r; }));

    const shoppingList = [...ingredientMap.entries()].map(([name, data]) => {
      const product = priceMap[name];
      const estimatedPrice = product
        ? (data.totalGrams > 0
            ? estimateIngredientCost(product.price, product.unit, data.totalGrams)
            : product.price)
        : null;
      return {
        ingredient: name, found: !!product, price: estimatedPrice,
        store: product?.store || null, productName: product?.name || name, unit: product?.unit || null,
        totalGrams: data.totalGrams || null,
      };
    }).sort((a,b) => a.found===b.found ? 0 : a.found ? -1 : 1);

    const enrichedPlan = planData.plan.map(d => ({
      ...d,
      meals: Object.fromEntries(Object.entries(d.meals).map(([t,m]) => [t, {
        ...m,
        ingredients:(m.ingredients||[]).map(i => {
          const rawName = typeof i === 'string' ? i : i.name;
          const cleanName = rawName.replace(/^\d+[γg]ρ?\s*/i,'').split('(')[0].trim().toLowerCase();
          const grams = extractGrams(rawName);
          const product = priceMap[cleanName];
          const estPrice = product && grams
            ? estimateIngredientCost(product.price, product.unit, grams)
            : product?.price || null;
          return {
            name: rawName,
            found: !!product,
            price: estPrice,
            store: product?.store || null,
          };
        }),
      }])),
    }));

    const found = shoppingList.filter(i => i.found).length;
    const cost  = shoppingList.filter(i => i.found).reduce((s,i) => s+(i.price||0), 0);

    // Compute achieved macro ratio from plan averages
    const avgDay = planData.plan.reduce((acc, d) => {
      acc.kcal    += d.dayMacros?.kcal    || 0;
      acc.protein += d.dayMacros?.protein || 0;
      acc.carbs   += d.dayMacros?.carbs   || 0;
      acc.fat     += d.dayMacros?.fat     || 0;
      return acc;
    }, { kcal:0, protein:0, carbs:0, fat:0 });
    const n = planData.plan.length || 1;
    const avgKcal = Math.round(avgDay.kcal / n);
    const achievedRatio = avgKcal > 0 ? {
      protein: Math.round((avgDay.protein / n * 4) / (avgDay.kcal / n) * 100),
      carbs:   Math.round((avgDay.carbs   / n * 4) / (avgDay.kcal / n) * 100),
      fat:     Math.round((avgDay.fat     / n * 9) / (avgDay.kcal / n) * 100),
    } : normMR;

    res.json({
      plan: enrichedPlan,
      summary: { ...planData.summary, macroRatioAchieved: achievedRatio, avgKcalPerDay: avgKcal },
      shoppingList,
      macroRatioTarget: normMR,
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