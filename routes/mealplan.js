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

ΑΥΣΤΗΡΟΙ ΚΑΝΟΝΕΣ MACROS (ΥΠΟΧΡΕΩΤΙΚΟΙ - ΜΗΝ ΠΑΡΑΒΑΙΝΕΙΣ):
1. ΑΚΡΙΒΕΙΑ ΘΕΡΜΙΔΩΝ: Οι θερμίδες ΠΡΕΠΕΙ να υπολογίζονται ΑΚΡΙΒΩΣ από τον τύπο:
   kcal = (protein × 4) + (carbs × 4) + (fat × 9)
   Παράδειγμα: protein=30g, carbs=50g, fat=15g → kcal = (30×4)+(50×4)+(15×9) = 120+200+135 = 455 kcal
   ΠΟΤΕ μην βάζεις τυχαίο αριθμό θερμίδων — πρέπει να βγαίνει από τον τύπο.

2. ΡΕΑΛΙΣΤΙΚΟ ΕΛΑΙΟΛΑΔΟ: Κάθε γεύμα που μαγειρεύεται με ελαιόλαδο πρέπει να έχει ΤΟΥΛΑΧΙΣΤΟΝ 1-2 κ.σ. (15-30ml ≈ 14-28γρ ≈ 120-250 θερμίδες). Μην βάζεις "1/4 κ.γ." ή "μερικές σταγόνες".

3. ΠΟΙΚΙΛΙΑ ΥΠΟΧΡΕΩΤΙΚΗ:
   - Πρωινό: Τουλάχιστον 4 διαφορετικά είδη που εναλλάσσονται κυκλικά (π.χ. ομελέτα, γιαούρτι με μέλι/granola, τοστ/τυρί, βρόμη με φρούτα)
   - Μεσημεριανό: Τουλάχιστον 5 διαφορετικά πιάτα (π.χ. κοτόπουλο σχάρας, φακές, μακαρόνια, ψάρι, μοσχάρι/χοιρινό)
   - Βραδινό: Τουλάχιστον 5 διαφορετικά (π.χ. σαλάτα με τυρί, γιαούρτι, αυγά, σούπα, ψητά λαχανικά)
   ΜΗΝ επαναλαμβάνεις το ίδιο γεύμα σε διαδοχικές ημέρες.

4. ΡΕΑΛΙΣΤΙΚΕΣ ΠΟΣΟΤΗΤΕΣ (όλα σε γραμμάρια ωμά):
   - Κρέας/ψάρι: 150-250γρ ωμό
   - Ρύζι/ζυμαρικά: 60-100γρ ωμό  
   - Όσπρια: 80-120γρ ωμά
   - Λαχανικά: 150-300γρ
   - Ελαιόλαδο: 15-30γρ (1-2 κ.σ.)
   - Τυρί φέτα: 30-60γρ
   - Γιαούρτι: 150-200γρ

5. ΡΕΑΛΙΣΤΙΚΕΣ ΤΙΜΕΣ ΕΛΛΗΝΙΚΟΥ ΣΟΥΠΕΡ ΜΑΡΚΕΤ:
   - Ελαιόλαδο: ~12€/λίτρο
   - Φέτα: ~12-14€/κιλό
   - Κοτόπουλο στήθος: ~9-11€/κιλό
   - Μοσχαρίσιος κιμάς: ~11-13€/κιλό
   - Γιαούρτι στραγγιστό: ~3-4€/500γρ
   - Αυγά: ~3-4€/10τεμ

ΓΕΝΙΚΟΙ ΚΑΝΟΝΕΣ:
- Χρησιμοποίησε ΜΟΝΟ υλικά από ελληνικά σούπερ μάρκετ.
- Τα ονόματα γευμάτων να είναι ΑΝΑΓΝΩΡΙΣΙΜΑ ελληνικά πιάτα.
- Κάθε υλικό ΝΑ ΕΧΕΙ ποσότητα σε γραμμάρια.
- description: 1-2 προτάσεις παρασκευής (απλά, κατανοητά).
- prepTip: 1 χρήσιμη συμβουλή μαγειρικής.
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

    const allIngredients = new Set();
    planData.plan.forEach(d =>
      Object.values(d.meals).forEach(m => (m.ingredients||[]).forEach(i => {
        // ingredients now include grams — extract just the name for price lookup
        const name = typeof i === 'string' ? i.replace(/^\d+[γg]ρ?\s*/i,'').split('(')[0].trim() : i;
        allIngredients.add(name.toLowerCase().trim());
      }))
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
        ingredients:(m.ingredients||[]).map(i => {
          const rawName = typeof i === 'string' ? i : i.name;
          const cleanName = rawName.replace(/^\d+[γg]ρ?\s*/i,'').split('(')[0].trim().toLowerCase();
          return {
            name: rawName,
            found: !!priceMap[cleanName],
            price: priceMap[cleanName]?.price||null,
            store: priceMap[cleanName]?.store||null,
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