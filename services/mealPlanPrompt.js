// services/mealPlanPrompt.js
// AI system prompt + per-request user prompt builder for the meal planner
// (routes/mealplan.js). Extracted during tidy-up — text and logic unchanged.

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

const WEATHER_HINTS = {
  clear:         'ζεστός καιρός — προτίμησε ελαφριά γεύματα, σαλάτες, ψητά, κρύα πιάτα',
  partly_cloudy: 'ήπιος καιρός — ισορροπημένα γεύματα',
  foggy:         'ομιχλώδης/υγρός καιρός — ζεστές σούπες και θρεπτικά γεύματα',
  rainy:         'βροχερός/κρύος καιρός — ζεστές σούπες, στιφάδα, comfort food',
  stormy:        'θυελλώδης καιρός — χορταστικά, ζεστά γεύματα',
  snowy:         'χιονιάς — ζεστές σούπες οσπρίων, hearty dishes',
  showers:       'βροχές — ζεστά, γεμιστά γεύματα',
};

/**
 * Build the per-request user prompt for the meal-plan AI call: computes
 * macro targets/splits from TDEE and macro ratios, injects weather and
 * dietary-restriction guidance, and appends the JSON response schema.
 * @param {object} params
 * @param {number} params.persons
 * @param {number} params.budget
 * @param {string[]} params.restrictions
 * @param {string} params.goal
 * @param {number} params.days
 * @param {number|null} params.tdee
 * @param {number[]|null} params.zigzag
 * @param {string} params.gender
 * @param {number} params.age
 * @param {number} params.weight
 * @param {number} params.height
 * @param {string} params.activityLevel
 * @param {{protein: number, carbs: number, fat: number}} params.macroRatios
 * @param {{label: string, temp: number|null}|null} params.weather
 * @returns {string} the fully assembled user prompt
 */
function buildPrompt({ persons, budget, restrictions, goal, days, tdee, zigzag, gender, age, weight, height, activityLevel, macroRatios, weather }) {
  const isVegan       = restrictions?.includes('vegan');
  const isVegetarian  = restrictions?.includes('vegetarian') || isVegan;
  const restrText     = restrictions?.length ? restrictions.join(', ') : 'Κανένας';

  const goalMap = {
    balanced:   'ισορροπημένη Μεσογειακή διατροφή',
    maintain:   'ισορροπημένη Μεσογειακή διατροφή (διατήρηση βάρους)',
    weightloss: 'απώλεια βάρους (θερμιδικό έλλειμμα, υψηλή πρωτεΐνη)',
    loss:       'απώλεια βάρους (θερμιδικό έλλειμμα -500 kcal, υψηλή πρωτεΐνη)',
    mild:       'ήπια απώλεια βάρους (-250 kcal ημερησίως, πλούσιο σε πρωτεΐνη)',
    extreme:    'γρήγορη απώλεια βάρους (μεγάλο έλλειμμα, υψηλή πρωτεΐνη, χαμηλοί υδατάνθρακες)',
    muscle:     'μυϊκή ανάπτυξη (2g πρωτεΐνη/kg σωματικού βάρους, πλεόνασμα θερμίδων)',
    budget:     'οικονομική αλλά θρεπτική διατροφή',
  };

  const calTarget  = tdee ? `${tdee} kcal/ημέρα (TDEE υπολογισμένο)` : 'ισορροπημένες θερμίδες';
  const zigzagInfo = zigzag ? `Zigzag ημέρες: ${zigzag.join(', ')} kcal` : '';
  const personInfo = (age && weight && height)
    ? `Προφίλ: ${gender==='male'?'Άνδρας':'Γυναίκα'}, ${age} ετών, ${height}cm, ${weight}kg, δραστηριότητα: ${activityLevel}`
    : '';
  const weatherInfo = weather?.label
    ? `Καιρός σήμερα: ${weather.temp !== null ? weather.temp + '°C, ' : ''}${WEATHER_HINTS[weather.label] || ''}. Προσάρμοσε τα γεύματα αναλόγως.`
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
${weatherInfo}
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

📌 ΚΑΝΟΝΕΣ ΓΙΑ ΣΥΝΤΑΓΕΣ:
   - Κάθε γεύμα έχει ΔΥΟ επιλογές: "breakfast" (Επιλογή Α) και "breakfast_alt" (Επιλογή Β) — ΤΕΛΕΙΩΣ ΔΙΑΦΟΡΕΤΙΚΑ υλικά
   - breakfast/breakfast_alt: ΧΩΡΙΣ κρέας — αυγά, γιαούρτι, βρώμη, ξηροί καρποί, φρούτα, τυρί
   - lunch/lunch_alt: ΚΥΡΙΟ ΓΕΥΜΑ — διαφορετικό κρέας σε κάθε επιλογή (πχ κοτόπουλο vs σολομός)
   - dinner/dinner_alt: ΕΛΑΦΡΥ — σαλάτα, σούπα, αυγά, γιαούρτι, λαχανικά
   - Κάθε συνταγή: ΠΛΗΡΕΙΣ οδηγίες μαγειρέματος step-by-step στο "description"
   - Χρήσιμη συμβουλή μαγειρικής στο "prepTip"
   - Ακριβή υλικά με γραμμάρια στο "ingredients" (πχ "150γρ στήθος κοτόπουλου")

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
          "name": "ΠΡΩΙΝΟ ΕΠΙΛΟΓΗ Α — μοναδικό όνομα συνταγής",
          "description": "Βήμα 1: [προετοιμασία υλικών]. Βήμα 2: [μαγείρεμα/ψήσιμο]. Βήμα 3: [σερβίρισμα και παρουσίαση].",
          "prepTip": "Συγκεκριμένη συμβουλή θερμοκρασίας ή τεχνικής",
          "time": 10,
          "macros": { "kcal": ${bfKcal}, "protein": ${bfP}, "carbs": ${bfC}, "fat": ${bfF} },
          "ingredients": ["200γρ ΥΛΙΚΟ_Α", "30γρ ΥΛΙΚΟ_Β", "14γρ ελαιόλαδο"]
        },
        "breakfast_alt": {
          "name": "ΠΡΩΙΝΟ ΕΠΙΛΟΓΗ Β — εντελώς διαφορετική συνταγή",
          "description": "Βήμα 1: [προετοιμασία]. Βήμα 2: [παρασκευή]. Βήμα 3: [σερβίρισμα].",
          "prepTip": "Χρήσιμη συμβουλή για αυτή τη συνταγή",
          "time": 15,
          "macros": { "kcal": ${bfKcal}, "protein": ${bfP}, "carbs": ${bfC}, "fat": ${bfF} },
          "ingredients": ["ΔΙΑΦΟΡΕΤΙΚΟ_ΥΛΙΚΟ_Α", "ΔΙΑΦΟΡΕΤΙΚΟ_ΥΛΙΚΟ_Β"]
        },
        "lunch": {
          "name": "ΜΕΣΗΜΕΡΙΑΝΟ ΕΠΙΛΟΓΗ Α — κυρίως πιάτο με πρωτεΐνη",
          "description": "Βήμα 1: [μαρινάδα/ετοιμασία]. Βήμα 2: [μαγείρεμα ~X λεπτά]. Βήμα 3: [σερβίρισμα με συνοδευτικό].",
          "prepTip": "Συμβουλή χρόνου ή θερμοκρασίας μαγειρέματος",
          "time": 35,
          "macros": { "kcal": ${luKcal}, "protein": ${luP}, "carbs": ${luC}, "fat": ${luF} },
          "ingredients": ["200γρ ΚΡΕΑΣ/ΨΑΡΙ_Α", "80γρ ΑΜΥΛΟ", "λαχανικά", "28γρ ελαιόλαδο"]
        },
        "lunch_alt": {
          "name": "ΜΕΣΗΜΕΡΙΑΝΟ ΕΠΙΛΟΓΗ Β — διαφορετική πρωτεΐνη",
          "description": "Βήμα 1: [ετοιμασία]. Βήμα 2: [μαγείρεμα]. Βήμα 3: [σερβίρισμα].",
          "prepTip": "Συμβουλή για αυτή τη συνταγή",
          "time": 30,
          "macros": { "kcal": ${luKcal}, "protein": ${luP}, "carbs": ${luC}, "fat": ${luF} },
          "ingredients": ["200γρ ΔΙΑΦΟΡΕΤΙΚΗ_ΠΡΩΤΕΙΝΗ", "συνοδευτικό", "28γρ ελαιόλαδο"]
        },
        "dinner": {
          "name": "ΒΡΑΔΙΝΟ ΕΠΙΛΟΓΗ Α — ελαφρύ γεύμα",
          "description": "Βήμα 1: [ετοιμασία]. Βήμα 2: [παρασκευή ή ανάμειξη]. Βήμα 3: [σερβίρισμα].",
          "prepTip": "Συμβουλή για ελαφρύ βραδινό",
          "time": 10,
          "macros": { "kcal": ${diKcal}, "protein": ${diP}, "carbs": ${diC}, "fat": ${diF} },
          "ingredients": ["200γρ ΥΛΙΚΟ_Α", "20γρ ΥΛΙΚΟ_Β"]
        },
        "dinner_alt": {
          "name": "ΒΡΑΔΙΝΟ ΕΠΙΛΟΓΗ Β — εναλλακτικό ελαφρύ",
          "description": "Βήμα 1: [ετοιμασία]. Βήμα 2: [παρασκευή]. Βήμα 3: [σερβίρισμα].",
          "prepTip": "Συμβουλή για αυτή τη συνταγή",
          "time": 12,
          "macros": { "kcal": ${diKcal}, "protein": ${diP}, "carbs": ${diC}, "fat": ${diF} },
          "ingredients": ["ΔΙΑΦΟΡΕΤΙΚΑ_ΥΛΙΚΑ_ΒΡΑΔΙΝΟΥ"]
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


module.exports = { SYSTEM_PROMPT, buildPrompt };
