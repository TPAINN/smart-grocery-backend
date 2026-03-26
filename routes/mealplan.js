// routes/mealplan.js — Premium AI Meal Planner
// Uses aiService.js → Gemini 2.0 Flash (primary) + Groq (fallback) + Bytez (emergency)
const express = require('express');
const router  = express.Router();
const Product = require('../models/Product');
const { callAI } = require('../services/aiService');
const authMiddleware = require('../middleware/authMiddleware');

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
    const r = await Product.find({ $and: f, price: { $gt: 0 } }).sort({ price:1 }).limit(3).lean();
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

═══ ΚΑΝΟΝΑΣ #1 — ΘΕΡΜΙΔΕΣ (ΚΡΙΣΙΜΟ) ═══
Ο χρήστης δίνει ένα ΗΜΕΡΗΣΙΟ ΣΤΟΧΟ θερμίδων στο prompt.
ΠΡΕΠΕΙ: breakfast_kcal + lunch_kcal + dinner_kcal = ημερήσιος_στόχος (±5%)
ΑΝ το άθροισμα είναι λιγότερο από 90% του στόχου → ΑΥΞΗΣΕ τις ποσότητες υλικών.

ΥΠΟΛΟΓΙΣΜΟΣ MACROS ανά υλικό (χρησιμοποίησε αυτές τις τιμές):
  - Κοτόπουλο στήθος: 23gP, 0gC, 1.2gF /100g → 104kcal
  - Γαλοπούλα στήθος: 24gP, 0gC, 1gF /100g → 105kcal
  - Μοσχαρίσιος κιμάς: 19gP, 0gC, 12gF /100g → 188kcal
  - Χοιρινό: 21gP, 0gC, 7gF /100g → 151kcal
  - Σολομός: 20gP, 0gC, 13gF /100g → 201kcal
  - Αυγό (60γρ/τεμ): 7.5gP, 0.6gC, 5.3gF → 80kcal
  - Φέτα: 14gP, 1gC, 21gF /100g → 250kcal
  - Γιαούρτι στραγγιστό 2%: 10gP, 4gC, 2gF /100g → 74kcal
  - Ελαιόλαδο (14γρ=1κ.σ.): 0gP, 0gC, 14gF → 126kcal
  - Ρύζι ωμό: 7gP, 78gC, 0.6gF /100g → 345kcal
  - Ζυμαρικά ωμά: 13gP, 71gC, 1.5gF /100g → 350kcal
  - Φακές ωμές: 25gP, 60gC, 1gF /100g → 353kcal
  - Πατάτες: 2gP, 17gC, 0.1gF /100g → 77kcal
  - Βρόμη: 13gP, 66gC, 7gF /100g → 379kcal
  - Ψωμί ολικής: 9gP, 43gC, 3gF /100g → 237kcal
  - Μέλι (21γρ=1κ.σ.): 0gP, 17gC, 0gF → 64kcal
  - Καρύδια/Αμύγδαλα: 15gP, 14gC, 65gF /100g → 654kcal
  - Τόνος κονσέρβα: 25gP, 0gC, 5gF /100g → 145kcal

ΤΥΠΙΚΗ ΚΑΤΑΝΟΜΗ kcal ανά γεύμα:
  Πρωινό 25%, Μεσημεριανό 40%, Βραδινό 35%
  Ελαιόλαδο: MIN 14γρ (1κ.σ.) σε κάθε μαγειρεμένο γεύμα, MIN 28γρ (2κ.σ.) σε ψητά/στιφάδο

═══ ΚΑΝΟΝΑΣ #2 — ΠΟΙΚΙΛΙΑ (ΚΡΙΣΙΜΟ) ═══
ΚΑΝΕΝΑ γεύμα δεν επαναλαμβάνεται σε ολόκληρο το πλάνο.
  Πρωινά: ομελέτα, βρόμη, τοστ, γιαούρτι-μέλι-granola, αυγά ποσέ, pancake βρώμης, smoothie bowl
  Μεσημεριανά: κοτόπουλο ψητό, φακές, ψάρι, κιμάς, μακαρόνια, χοιρινό/αρνί, γεμιστά/μπριάμ
  Βραδινά: σαλάτα χωριάτικη, σούπα, ομελέτα λαχανικών, τόνος σαλάτα, ψητά λαχανικά, αυγά-τυρί

═══ ΚΑΝΟΝΑΣ #3 — ΠΟΙΟΤΗΤΑ ΠΕΡΙΕΧΟΜΕΝΟΥ ═══
  description: ΠΑΝΤΑ 3 σαφή βήματα μαγειρέματος (Βήμα 1/2/3), ΠΟΤΕ γενικές φράσεις
  prepTip: ΣΥΓΚΕΚΡΙΜΕΝΗ χρήσιμη συμβουλή (χρόνος, θερμοκρασία, τεχνική), ΠΟΤΕ "χρησιμοποιήστε φρέσκο"
  nutritionNote: ΕΞΑΤΟΜΙΚΕΥΜΕΝΗ σημείωση για τα συγκεκριμένα τρόφιμα της ημέρας
  snacks: ΔΙΑΦΟΡΕΤΙΚΑ σνακ κάθε μέρα — γενικευμένες προτάσεις (φρούτα, ξηροί καρποί, χουρμάδες κτλ)

═══ ΚΑΝΟΝΑΣ #4 — ΠΟΣΟΤΗΤΕΣ (ωμό βάρος, ανά άτομο) ═══
  Κρέας/ψάρι: 150-250γρ | Ρύζι/ζυμαρικά: 80-100γρ | Όσπρια: 90-120γρ
  Λαχανικά: 150-300γρ | Ελαιόλαδο: 14-42γρ | Φέτα: 40-60γρ | Γιαούρτι: 150-200γρ | Αυγά: 2-3τεμ
  Κάθε γεύμα: MIN 3 υλικά, ΠΑΝΤΑ με ποσότητα σε γραμμάρια

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

  // Compute per-meal calorie targets (used in JSON schema so AI hits the right numbers)
  const bfKcal  = Math.round(dailyKcal * 0.25);
  const luKcal  = Math.round(dailyKcal * 0.40);
  const diKcal  = Math.round(dailyKcal * 0.35);
  const bfP = Math.round(dailyProteinG * 0.25), bfC = Math.round(dailyCarbsG * 0.25), bfF = Math.round(dailyFatG * 0.25);
  const luP = Math.round(dailyProteinG * 0.40), luC = Math.round(dailyCarbsG * 0.40), luF = Math.round(dailyFatG * 0.40);
  const diP = Math.round(dailyProteinG * 0.35), diC = Math.round(dailyCarbsG * 0.35), diF = Math.round(dailyFatG * 0.35);

  return `${personInfo}
ΗΜΕΡΗΣΙΟΣ ΣΤΟΧΟΣ: ${dailyKcal} kcal (breakfast+lunch+dinner ΠΡΕΠΕΙ να αθροίζουν σε ${dailyKcal}±5%)
${zigzagInfo}
Στόχος διατροφής: ${goalMap[goal] || goalMap.balanced}
Άτομα: ${persons}, Ημέρες: ${days}, Budget: ${budget}€/εβδομάδα
Περιορισμοί: ${restrText}

${macroInstructions}

${meatGuidelines}

🚫 ΑΠΑΓΟΡΕΥΕΤΑΙ: ΜΗΝ αντιγράφεις κανένα νούμερο, γεύμα ή υλικό από το παράδειγμα JSON παρακάτω.
   Το παράδειγμα δείχνει ΜΟΝΟ τη ΔΟΜΗ. Υπολόγισε ΔΙΚΑ ΣΟΥ macros από τα ΔΙΚΑ ΣΟΥ υλικά.
✅ Κάθε ημέρα: breakfast(~${bfKcal}kcal) + lunch(~${luKcal}kcal) + dinner(~${diKcal}kcal) = ~${dailyKcal}kcal

Δημιούργησε πλάνο ${days} ημερών.

Επέστρεψε ΜΟΝΟ αυτό το JSON (ΧΩΡΙΣ markdown, ΧΩΡΙΣ κείμενο):
{
  "plan": [
    {
      "day": 1,
      "dayName": "Δευτέρα",
      "waterGlasses": 8,
      "snacks": {
        "morning": "1-2 φρούτα εποχής (πχ μήλο, πορτοκάλι) — ενέργεια χωρίς πείνα",
        "afternoon": "Χούφτα αμύγδαλα ή 3-4 χουρμάδες — φυσική γλυκόζη"
      },
      "meals": {
        "breakfast": {
          "name": "ΜΟΝΑΔΙΚΟ ΠΡΩΙΝΟ (όχι από άλλη ημέρα)",
          "description": "Βήμα 1: [ετοιμασία]. Βήμα 2: [μαγείρεμα]. Βήμα 3: [σερβίρισμα].",
          "prepTip": "ΣΥΓΚΕΚΡΙΜΕΝΗ συμβουλή τεχνικής/χρόνου/θερμοκρασίας",
          "time": 10,
          "macros": { "kcal": ${bfKcal}, "protein": ${bfP}, "carbs": ${bfC}, "fat": ${bfF} },
          "micronutrients": ["Βιταμίνη X"],
          "ingredients": ["200γρ ΥΛΙΚΟ_Α", "30γρ ΥΛΙΚΟ_Β", "14γρ ελαιόλαδο (1 κ.σ.)"]
        },
        "lunch": {
          "name": "ΚΥΡΙΟ ΓΕΥΜΑ ΜΕ ΠΡΩΤΕΪΝΗ",
          "description": "Βήμα 1: [ετοιμασία]. Βήμα 2: [μαγείρεμα]. Βήμα 3: [σερβίρισμα].",
          "prepTip": "ΣΥΓΚΕΚΡΙΜΕΝΗ συμβουλή τεχνικής/χρόνου/θερμοκρασίας",
          "time": 35,
          "macros": { "kcal": ${luKcal}, "protein": ${luP}, "carbs": ${luC}, "fat": ${luF} },
          "micronutrients": ["Βιταμίνη Y"],
          "ingredients": ["200γρ ΥΛΙΚΟ_ΚΡΕΑΣ", "80γρ ΥΛΙΚΟ_ΑΜΥΛΟ", "28γρ ελαιόλαδο (2 κ.σ.)"]
        },
        "dinner": {
          "name": "ΕΛΑΦΡΥ ΒΡΑΔΙΝΟ",
          "description": "Βήμα 1: [ετοιμασία]. Βήμα 2: [μαγείρεμα ή ανάμειξη]. Βήμα 3: [σερβίρισμα].",
          "prepTip": "ΣΥΓΚΕΚΡΙΜΕΝΗ συμβουλή τεχνικής/χρόνου/θερμοκρασίας",
          "time": 10,
          "macros": { "kcal": ${diKcal}, "protein": ${diP}, "carbs": ${diC}, "fat": ${diF} },
          "micronutrients": ["Ασβέστιο"],
          "ingredients": ["200γρ ΥΛΙΚΟ_Α", "20γρ ΥΛΙΚΟ_Β", "14γρ ελαιόλαδο (1 κ.σ.)"]
        }
      },
      "dayMacros": { "kcal": ${dailyKcal}, "protein": ${dailyProteinG}, "carbs": ${dailyCarbsG}, "fat": ${dailyFatG} },
      "nutritionNote": "ΕΞΑΤΟΜΙΚΕΥΜΕΝΗ σημείωση για τα τρόφιμα αυτής της ημέρας"
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
    "estimatedIngredients": ["υλικό1", "υλικό2"]
  }
}`;
}

router.post('/', authMiddleware, async (req, res) => {
  const {
    persons=2, budget=80, restrictions=[], goal='balanced', days=7,
    tdee=null, zigzag=null, gender='male', age=30, weight=75, height=175, activityLevel='moderate',
    macroRatios={ protein:30, carbs:40, fat:30 },
  } = req.body;

  if (!process.env.GEMINI_API_KEY && !process.env.GROQ_API_KEY && !process.env.BYTEZ_API_KEY)
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
      snacks: d.snacks || { morning: 'Φρούτο εποχής', afternoon: 'Χούφτα ξηρούς καρπούς' },
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
        totalIngredients: ingredientMap.size,
        foundInDB: found,
        notFound: ingredientMap.size - found,
        estimatedCost: Math.round(cost*100)/100,
        coveragePercent: Math.round(found/ingredientMap.size*100),
      },
    });
  } catch(err) {
    console.error('❌ Meal Plan:', err.message);
    res.status(500).json({ message: `Σφάλμα AI: ${err.message}` });
  }
});

module.exports = router;