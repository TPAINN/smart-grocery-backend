// routes/meals.js
// TheMealDB proxy — truly free, no rate-limit documented, open crowd-sourced DB.
// Translation stack: static dicts → batch AI (Claude/Gemini/Groq) → MyMemory API fallback.

const express   = require('express');
const router    = express.Router();
const axios     = require('axios');
const { callAI } = require('../services/aiService');

const BASE = 'https://www.themealdb.com/api/json/v1/1';

// In-memory TTL cache
const cache      = new Map();
const CACHE_TTL  = 30 * 60 * 1000;  // 30 min for raw data
const TR_TTL     = 6  * 60 * 60 * 1000; // 6 h for translated results

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > entry.ttl) { cache.delete(key); return null; }
  return entry.data;
}
function cacheSet(key, data, ttl = CACHE_TTL) {
  cache.set(key, { data, ts: Date.now(), ttl });
}

// ── Greek translation dictionaries ────────────────────────────────────────────

const CATEGORY_GR = {
  'Beef': 'Μοσχάρι', 'Chicken': 'Κοτόπουλο', 'Dessert': 'Γλυκό',
  'Lamb': 'Αρνί', 'Pork': 'Χοιρινό', 'Seafood': 'Θαλασσινά',
  'Vegetarian': 'Χορτοφαγικό', 'Pasta': 'Ζυμαρικά', 'Side': 'Συνοδευτικό',
  'Starter': 'Ορεκτικό', 'Vegan': 'Vegan', 'Miscellaneous': 'Διάφορα',
  'Breakfast': 'Πρωινό', 'Goat': 'Κατσίκι',
};

const AREA_GR = {
  'Greek': 'Ελληνική', 'Italian': 'Ιταλική', 'Spanish': 'Ισπανική',
  'Turkish': 'Τουρκική', 'Moroccan': 'Μαροκινή', 'French': 'Γαλλική',
  'British': 'Βρετανική', 'American': 'Αμερικανική', 'Chinese': 'Κινέζικη',
  'Indian': 'Ινδική', 'Japanese': 'Ιαπωνική', 'Mexican': 'Μεξικανική',
  'Thai': 'Ταϊλανδέζικη', 'Vietnamese': 'Βιετναμέζικη', 'Jamaican': 'Τζαμαϊκανή',
  'Croatian': 'Κροατική', 'Dutch': 'Ολλανδική', 'Egyptian': 'Αιγυπτιακή',
  'Filipino': 'Φιλιππινέζικη', 'Irish': 'Ιρλανδική', 'Kenyan': 'Κενυατική',
  'Malaysian': 'Μαλαισιανή', 'Polish': 'Πολωνική', 'Portuguese': 'Πορτογαλική',
  'Russian': 'Ρωσική', 'Tunisian': 'Τυνησιακή', 'Unknown': 'Άγνωστη',
};

const MEAL_NAMES_GR = {
  // ── Greek ──────────────────────────────────────────────────────────
  'Moussaka': 'Μουσακάς',
  'Spanakopita': 'Σπανακόπιτα',
  'Garides Saganaki': 'Γαρίδες Σαγανάκι',
  'Gigantes Plaki': 'Γίγαντες Πλακί',
  'Chicken Quinoa Greek Salad': 'Ελληνική Σαλάτα Κοτόπουλου Κινόα',
  'Greek Beef Stew': 'Στιφάδο Μοσχαριού',
  'Greek Lemon Chicken Soup': 'Αβγολέμονο',
  'Grilled Pork Sausages': 'Λουκάνικα Σχάρας',
  'Greek Salad': 'Χωριάτικη Σαλάτα',
  'Stifado': 'Στιφάδο',
  'Loukoumades': 'Λουκουμάδες',
  'Pastitsio': 'Παστίτσιο',
  'Tiropita': 'Τυρόπιτα',
  'Baklava': 'Μπακλαβάς',
  'Tzatziki': 'Τζατζίκι',
  'Revithokeftedes': 'Ρεβιθοκεφτέδες',
  'Briam': 'Μπριάμ',
  'Souvlaki': 'Σουβλάκι',
  'Loukaniko': 'Λουκάνικο',
  'Keftedes': 'Κεφτέδες',
  'Horiatiki': 'Χωριάτικη',
  'Fasolada': 'Φασολάδα',
  'Taramosalata': 'Ταραμοσαλάτα',
  'Avgolemono': 'Αβγολέμονο',
  'Dakos': 'Ντάκος',
  'Gemista': 'Γεμιστά',
  'Kleftiko': 'Κλέφτικο',
  'Imam Bayildi': 'Ιμάμ Μπαϊλντί',
  'Dolmades': 'Ντολμάδες',
  'Pita Bread': 'Πίτα',
  'Halloumi': 'Χαλούμι',
  'Shakshuka': 'Σακσούκα',
  'Lamb kofta': 'Κεφτεδάκια Αρνιού',
  // ── Italian ────────────────────────────────────────────────────────
  'Spaghetti Bolognese': 'Σπαγγέτι Μπολονέζ',
  'Spaghetti Carbonara': 'Σπαγγέτι Καρμπονάρα',
  'Margherita Pizza': 'Πίτσα Μαργαρίτα',
  'Risotto Milanese': 'Ριζότο Μιλανέζε',
  'Penne Arrabiata': 'Πέννε Αραμπιάτα',
  'Tiramisu': 'Τιραμισού',
  'Ossobuco alla Milanese': 'Οσομπούκο Μιλανέζε',
  'Chicken Milanese': 'Κοτόπουλο Μιλανέζε',
  'Lasagne': 'Λαζάνια',
  'Pappardelle alla Bolognese': 'Παπαρδέλε Μπολονέζ',
  'Pizza Express Margherita': 'Πίτσα Μαργαρίτα',
  'Risotto alla Milanese': 'Ριζότο Μιλανέζε',
  'Ribollita': 'Ριμπολίτα',
  'Panzanella': 'Παντζανέλα',
  'Bruschetta': 'Μπρουσκέτα',
  'Arancini Balls': 'Αρανσίνι',
  'Penne Alla Siciliana': 'Πέννε Σικελιάνα',
  'Chicken Parmesan': 'Κοτόπουλο Παρμιτζιάνα',
  'Eggplant Parmigiana': 'Μελιτζάνα Παρμιτζιάνα',
  'Pasta e Fagioli': 'Ζυμαρικά με Φασόλια',
  'Cacio e Pepe': 'Κάτσιο ε Πέπε',
  'Saltimbocca alla Romana': 'Σαλτιμπόκα',
  'Ravioli alle Verdure': 'Ραβιόλι Λαχανικών',
  'Minestrone Soup': 'Μινεστρόνε',
  'Polenta': 'Πολέντα',
  'Focaccia': 'Φοκάτσα',
  'Calzone': 'Καλτσόνε',
  'Piadina': 'Πιαδίνα',
  // ── Spanish ────────────────────────────────────────────────────────
  'Paella de Marisco': 'Παέλια Θαλασσινών',
  'Paella': 'Παέλια',
  'Gazpacho': 'Γκαζπάτσο',
  'Spanish Omelette': 'Ισπανική Ομελέτα',
  'Tortilla de Patatas': 'Τορτίγια Πατάτας',
  'Churros': 'Τσούρος',
  'Patatas Bravas': 'Πατάτες Μπράβας',
  'Chicken Spanish Stew': 'Ισπανικό Κοτόπουλο',
  'Gambas Al Ajillo': 'Γαρίδες με Σκόρδο',
  'Albondigas': 'Σφαιρίδια Κρέατος',
  // ── French ─────────────────────────────────────────────────────────
  'Beef Bourguignon': 'Μοσχάρι Βουργκινιόν',
  'Coq au Vin': 'Κοκ ο Βαν',
  'Crème Brûlée': 'Κρεμ Μπρουλέ',
  'French Onion Soup': 'Γαλλική Κρεμμυδόσουπα',
  'Ratatouille': 'Ρατατούιγ',
  'Quiche Lorraine': 'Κις Λορέν',
  'Croissant': 'Κρουασάν',
  'Crêpes Suzette': 'Κρεπ Σουζέτ',
  'Cassoulet': 'Κασουλέ',
  'Boeuf Bourguignon': 'Μοσχάρι Βουργκινιόν',
  'Poulet Rôti': 'Ψητό Κοτόπουλο',
  'Nicoise Salad': 'Σαλάτα Νισουάζ',
  'French Crepes': 'Κρέπες',
  // ── Turkish ────────────────────────────────────────────────────────
  'Turkish Meatballs': 'Τουρκικοί Κεφτέδες',
  'Turkish Scrambled Eggs': 'Μεμέν (Τουρκικά Αυγά)',
  'Kebab': 'Κεμπάπ',
  'Adana kebab': 'Κεμπάπ Αντάνα',
  'Mansaf': 'Μανσάφ',
  'Doner Kebab': 'Ντόνερ Κεμπάπ',
  'Lamb Kofta': 'Κεμπάπ Αρνιού',
  'Chicken Kofta': 'Κεμπάπ Κοτόπουλου',
  'Manti': 'Μαντί',
  'Baklava': 'Μπακλαβάς',
  'Turkish Delight': 'Λουκούμι',
  // ── Moroccan ────────────────────────────────────────────────────────
  'Chicken Tagine': 'Κοτόπουλο Ταζίν',
  'Moroccan Lamb': 'Μαροκινό Αρνί',
  'Couscous': 'Κους-Κους',
  'Lamb Tagine': 'Αρνίσιο Ταζίν',
  'Harira': 'Χαρίρα',
  'Bastilla': 'Μπαστίλα',
  'Chermoula': 'Τσερμούλα',
  // ── British ─────────────────────────────────────────────────────────
  'Beef Wellington': 'Μοσχάρι Ουέλινγκτον',
  'Fish and Chips': 'Ψάρι με Πατάτες',
  'Shepherd\'s Pie': 'Πάι Ποιμένα',
  'Cottage Pie': 'Κότατζ Πάι',
  'Full English Breakfast': 'Αγγλικό Πρωινό',
  'Chicken Tikka Masala': 'Κοτόπουλο Τίκα Μασάλα',
  'Toad In The Hole': 'Λουκάνικα σε Κουρκούτι',
  'Beef Stew': 'Μοσχαρίσιο Στιφάδο',
  'Bangers and Mash': 'Λουκάνικα με Πουρέ',
  'Bread and Butter Pudding': 'Πουτίγκα Ψωμιού',
  'Treacle Tart': 'Τάρτα Μελάσας',
  'Eton Mess': 'Εϊτον Μεσ',
  'Sticky Toffee Pudding': 'Πουτίγκα Τόφι',
  'Victoria Sponge Cake': 'Κέικ Βικτώρια',
  // ── Indian ──────────────────────────────────────────────────────────
  'Butter Chicken': 'Κοτόπουλο Βουτύρου',
  'Chicken Curry': 'Κάρι Κοτόπουλου',
  'Lamb Curry': 'Κάρι Αρνιού',
  'Beef Curry': 'Κάρι Μοσχαριού',
  'Dal': 'Ντάλ',
  'Biryani': 'Μπιριάνι',
  'Tikka Masala': 'Τίκα Μασάλα',
  'Palak Paneer': 'Παλάκ Πανίρ',
  'Saag Aloo': 'Σάαγκ Άλου',
  'Naan Bread': 'Ψωμί Νάαν',
  'Samosa': 'Σαμόσα',
  'Korma': 'Κόρμα',
  // ── Other ────────────────────────────────────────────────────────
  'Beef Tacos': 'Τάκος Μοσχαριού',
  'Chicken Enchiladas': 'Εντσιλάδας Κοτόπουλου',
  'Guacamole': 'Γκουακαμόλε',
  'Burritos': 'Μπουρίτο',
  'Fajitas': 'Φαχίτας',
  'Pad Thai': 'Παντ Τάι',
  'Tom Yum Soup': 'Σούπα Τομ Γιουμ',
  'Green Curry': 'Πράσινο Κάρι',
  'Sushi': 'Σούσι',
  'Ramen': 'Ράμεν',
  'Teriyaki Chicken': 'Κοτόπουλο Τεριγιάκι',
  'Miso Soup': 'Σούπα Μίσο',
  'Fried Rice': 'Τηγανητό Ρύζι',
  'Kung Pao Chicken': 'Κοτόπουλο Κουνγκ Πάο',
  'Sweet and Sour Pork': 'Χοιρινό Γλυκόξινο',
  'Wonton Soup': 'Σούπα Γουόντον',
  'Scrambled Eggs': 'Αυγά Scrambled',
  'Omelette': 'Ομελέτα',
  'Pancakes': 'Τηγανίτες',
  'French Toast': 'Γαλλική Φρυγανιά',
  'Banana Pancakes': 'Τηγανίτες Μπανάνας',
};

// Common ingredient word replacements (longest-first to avoid partial matches)
const ING_WORDS_GR = [
  ['olive oil',          'ελαιόλαδο'],
  ['tomato paste',       'πελτές ντομάτας'],
  ['tomato puree',       'πουρέ ντομάτας'],
  ['red wine',           'κόκκινο κρασί'],
  ['white wine',         'λευκό κρασί'],
  ['butter beans',       'βούτυρο φασόλια'],
  ['kidney beans',       'κόκκινα φασόλια'],
  ['chickpeas',          'ρεβίθια'],
  ['dried oregano',      'αποξηραμένη ρίγανη'],
  ['chopped parsley',    'ψιλοκομμένος μαϊντανός'],
  ['garlic clove',       'σκελίδα σκόρδου'],
  ['garlic cloves',      'σκελίδες σκόρδου'],
  ['ground beef',        'κιμάς μοσχαριού'],
  ['ground lamb',        'κιμάς αρνιού'],
  ['ground cinnamon',    'κανέλα σκόνη'],
  ['ground cumin',       'κύμινο σκόνη'],
  ['black pepper',       'μαύρο πιπέρι'],
  ['olive oil',          'ελαιόλαδο'],
  ['lemon juice',        'χυμός λεμονιού'],
  ['chicken breast',     'στήθος κοτόπουλου'],
  ['chicken thigh',      'μπούτι κοτόπουλου'],
  ['chicken stock',      'ζωμός κοτόπουλου'],
  ['beef stock',         'ζωμός μοσχαριού'],
  ['vegetable stock',    'ζωμός λαχανικών'],
  ['feta cheese',        'τυρί φέτα'],
  ['cheddar cheese',     'τυρί τσένταρ'],
  ['parmesan cheese',    'τυρί παρμεζάνα'],
  ['cream cheese',       'τυρί κρέμα'],
  ['sour cream',         'ξινή κρέμα'],
  ['heavy cream',        'κρέμα γάλακτος'],
  ['double cream',       'κρέμα γάλακτος'],
  ['natural yogurt',     'φυσικό γιαούρτι'],
  ['greek yogurt',       'ελληνικό γιαούρτι'],
  ['plain flour',        'αλεύρι μαλακό'],
  ['self-raising flour', 'αλεύρι με μπέικιν'],
  ['baking powder',      'μπέικιν πάουντερ'],
  ['bread crumbs',       'τριμμένη φρυγανιά'],
  ['breadcrumbs',        'τριμμένη φρυγανιά'],
  ['pine nuts',          'κουκουνάρια'],
  ['bay leaves',         'φύλλα δάφνης'],
  ['bay leaf',           'φύλλο δάφνης'],
  ['lamb chops',         'παϊδάκια αρνιού'],
  ['lamb mince',         'κιμάς αρνιού'],
  ['spring onion',       'φρέσκο κρεμμύδι'],
  ['spring onions',      'φρέσκα κρεμμύδια'],
  ['red onion',          'κόκκινο κρεμμύδι'],
  ['yellow onion',       'κίτρινο κρεμμύδι'],
  ['cherry tomatoes',    'ντοματίνια'],
  ['sun-dried tomatoes', 'αποξηραμένες ντομάτες'],
  ['beef mince',         'κιμάς μοσχαριού'],
  ['pork mince',         'κιμάς χοιρινού'],
  ['minced beef',        'κιμάς μοσχαριού'],
  ['minced lamb',        'κιμάς αρνιού'],
  ['minced pork',        'κιμάς χοιρινού'],
  ['canned tomatoes',    'κονσέρβα ντομάτας'],
  ['tinned tomatoes',    'κονσέρβα ντομάτας'],
  ['kalamata olives',    'ελιές καλαμάτας'],
  ['black olives',       'μαύρες ελιές'],
  ['green olives',       'πράσινες ελιές'],
  ['capers',             'κάπαρη'],
  ['anchovies',          'αντζούγιες'],
  ['olive oil',          'ελαιόλαδο'],
  // Single words
  ['tomatoes',           'ντομάτες'],
  ['tomato',             'ντομάτα'],
  ['onions',             'κρεμμύδια'],
  ['onion',              'κρεμμύδι'],
  ['garlic',             'σκόρδο'],
  ['potatoes',           'πατάτες'],
  ['potato',             'πατάτα'],
  ['carrots',            'καρότα'],
  ['carrot',             'καρότο'],
  ['spinach',            'σπανάκι'],
  ['eggplant',           'μελιτζάνα'],
  ['aubergine',          'μελιτζάνα'],
  ['zucchini',           'κολοκυθάκι'],
  ['courgette',          'κολοκυθάκι'],
  ['mushrooms',          'μανιτάρια'],
  ['mushroom',           'μανιτάρι'],
  ['peppers',            'πιπεριές'],
  ['pepper',             'πιπεριά'],
  ['cucumber',           'αγγούρι'],
  ['celery',             'σέλερι'],
  ['leek',               'πράσο'],
  ['cauliflower',        'κουνουπίδι'],
  ['broccoli',           'μπρόκολο'],
  ['beans',              'φασόλια'],
  ['lentils',            'φακές'],
  ['olives',             'ελιές'],
  ['cheese',             'τυρί'],
  ['feta',               'φέτα'],
  ['yogurt',             'γιαούρτι'],
  ['milk',               'γάλα'],
  ['cream',              'κρέμα'],
  ['butter',             'βούτυρο'],
  ['eggs',               'αυγά'],
  ['egg',                'αυγό'],
  ['flour',              'αλεύρι'],
  ['rice',               'ρύζι'],
  ['pasta',              'ζυμαρικά'],
  ['bread',              'ψωμί'],
  ['oil',                'λάδι'],
  ['salt',               'αλάτι'],
  ['sugar',              'ζάχαρη'],
  ['honey',              'μέλι'],
  ['vinegar',            'ξίδι'],
  ['wine',               'κρασί'],
  ['water',              'νερό'],
  ['lemon',              'λεμόνι'],
  ['lime',               'λάιμ'],
  ['orange',             'πορτοκάλι'],
  ['chicken',            'κοτόπουλο'],
  ['beef',               'μοσχάρι'],
  ['lamb',               'αρνί'],
  ['pork',               'χοιρινό'],
  ['fish',               'ψάρι'],
  ['shrimp',             'γαρίδες'],
  ['prawns',             'γαρίδες'],
  ['salmon',             'σολομός'],
  ['tuna',               'τόνος'],
  ['cod',                'μπακαλιάρος'],
  ['oregano',            'ρίγανη'],
  ['thyme',              'θυμάρι'],
  ['basil',              'βασιλικός'],
  ['parsley',            'μαϊντανός'],
  ['cilantro',           'κόλιανδρος'],
  ['mint',               'δυόσμος'],
  ['cinnamon',           'κανέλα'],
  ['cumin',              'κύμινο'],
  ['paprika',            'πάπρικα'],
  ['turmeric',           'κουρκουμάς'],
  ['nutmeg',             'μοσχοκάρυδο'],
  ['rosemary',           'δεντρολίβανο'],
  ['sage',               'φασκόμηλο'],
  ['chilli',             'τσίλι'],
  ['chili',              'τσίλι'],
  ['saffron',            'σαφράν'],
  ['stock',              'ζωμός'],
  ['broth',              'ζωμός'],
  ['chopped',            'ψιλοκομμένο'],
  ['diced',              'κομματάκια'],
  ['sliced',             'σε φέτες'],
  ['minced',             'κιμάς'],
  ['grated',             'τριμμένο'],
  ['crushed',            'λιωμένο'],
  ['peeled',             'καθαρισμένο'],
  ['dried',              'αποξηραμένο'],
  ['fresh',              'φρέσκο'],
  ['frozen',             'κατεψυγμένο'],
  ['cooked',             'μαγειρεμένο'],
  ['raw',                'ωμό'],
  ['large',              'μεγάλο'],
  ['small',              'μικρό'],
  ['medium',             'μέτριο'],
  ['whole',              'ολόκληρο'],
  ['boneless',           'χωρίς κόκκαλα'],
  ['skinless',           'χωρίς πέτσα'],
  ['trimmed',            'καθαρισμένο'],
  ['roughly',            'χοντροκομμένα'],
  ['finely',             'λεπτά'],
  ['halved',             'στα δύο'],
  ['quartered',          'στα τέταρτα'],
  ['beaten',             'χτυπημένο'],
  ['boiled',             'βρασμένο'],
  ['roasted',            'ψητό'],
  ['fried',              'τηγανητό'],
  ['pinch',              'πρέζα'],
  ['handful',            'χούφτα'],
  ['tbs',                'κ.σ.'],
  ['tbsp',               'κ.σ.'],
  ['tsp',                'κ.γ.'],
  ['cup',                'φλιτζάνι'],
  ['cups',               'φλιτζάνια'],
  ['clove',              'σκελίδα'],
  ['cloves',             'σκελίδες'],
  ['sprig',              'κλωνάρι'],
  ['sprigs',             'κλωνάρια'],
  ['bunch',              'ματσάκι'],
  ['can',                'κονσέρβα'],
  ['tin',                'κονσέρβα'],
  ['packet',             'πακέτο'],
  ['jar',                'βαζάκι'],
  ['tablespoon',         'κουτ. σούπας'],
  ['teaspoon',           'κουτ. γλυκού'],
  ['pound',              'λίβρα'],
  ['ounce',              'ουγκιά'],
  ['gram',               'γρ.'],
  ['ml',                 'μλ'],
  ['litre',              'λίτρο'],
  ['liter',              'λίτρο'],
  ['to taste',           'κατά γούστο'],
  ['as needed',          'όσο χρειαστεί'],
  ['for frying',         'για τηγάνισμα'],
  ['for garnish',        'για γαρνίρισμα'],
  ['optional',           'προαιρετικό'],
  // More ingredients
  ['coconut milk',       'γάλα καρύδας'],
  ['soy sauce',          'σάλτσα σόγιας'],
  ['fish sauce',         'σάλτσα ψαριού'],
  ['oyster sauce',       'σάλτσα στρειδιών'],
  ['worcestershire sauce', 'σάλτσα Worcestershire'],
  ['hot sauce',          'πικάντικη σάλτσα'],
  ['tomato sauce',       'σάλτσα ντομάτας'],
  ['bbq sauce',          'σάλτσα μπάρμπεκιου'],
  ['tahini',             'ταχίνι'],
  ['hummus',             'χούμους'],
  ['pesto',              'πέστο'],
  ['mayonnaise',         'μαγιονέζα'],
  ['mustard',            'μουστάρδα'],
  ['ketchup',            'κέτσαπ'],
  ['sriracha',           'σιράτσα'],
  ['dijon mustard',      'μουστάρδα ντιζόν'],
  ['balsamic vinegar',   'βαλσάμικο ξίδι'],
  ['red wine vinegar',   'κόκκινο ξίδι'],
  ['white wine vinegar', 'λευκό ξίδι'],
  ['apple cider vinegar', 'ξίδι μηλόξυδο'],
  ['sunflower oil',      'ηλιέλαιο'],
  ['vegetable oil',      'φυτικό λάδι'],
  ['sesame oil',         'λάδι σησαμιού'],
  ['coconut oil',        'λάδι καρύδας'],
  ['beef mince',         'κιμάς μοσχαριού'],
  ['lamb mince',         'κιμάς αρνιού'],
  ['turkey breast',      'στήθος γαλοπούλας'],
  ['duck breast',        'στήθος πάπιας'],
  ['bacon',              'μπέικον'],
  ['ham',                'ζαμπόν'],
  ['sausage',            'λουκάνικο'],
  ['chorizo',            'τσόριθο'],
  ['prosciutto',         'προσούτο'],
  ['pancetta',           'παντσέτα'],
  ['mozzarella',         'μοτσαρέλα'],
  ['ricotta',            'ρικότα'],
  ['parmesan',           'παρμεζάνα'],
  ['goat cheese',        'κατσικίσιο τυρί'],
  ['cottage cheese',     'κότατζ τυρί'],
  ['gorgonzola',         'γκοργκοντζόλα'],
  ['brie',               'μπρί'],
  ['camembert',          'καμεμπέρ'],
  ['puff pastry',        'σφολιάτα'],
  ['filo pastry',        'φύλλο κρούστας'],
  ['short crust pastry', 'ζύμη τάρτας'],
  ['pie crust',          'ζύμη πάι'],
  ['breadcrumbs',        'τριμμένη φρυγανιά'],
  ['panko',              'πάνκο'],
  ['cornflour',          'κορν φλάουρ'],
  ['cornstarch',         'αμυλο καλαμποκιού'],
  ['baking soda',        'μαγειρική σόδα'],
  ['vanilla extract',    'εκχύλισμα βανίλιας'],
  ['vanilla',            'βανίλια'],
  ['chocolate chips',    'κομματάκια σοκολάτας'],
  ['dark chocolate',     'μαύρη σοκολάτα'],
  ['milk chocolate',     'γαλακτερή σοκολάτα'],
  ['white chocolate',    'λευκή σοκολάτα'],
  ['cocoa powder',       'κακάο σε σκόνη'],
  ['icing sugar',        'άχνη ζάχαρη'],
  ['brown sugar',        'καστανή ζάχαρη'],
  ['caster sugar',       'κρυσταλλική ζάχαρη'],
  ['golden syrup',       'χρυσό σιρόπι'],
  ['maple syrup',        'σιρόπι σφενδάμου'],
  ['condensed milk',     'ζαχαρούχο γάλα'],
  ['evaporated milk',    'εβαπορέ γάλα'],
  ['almond milk',        'αμυγδαλόγαλα'],
  ['oat milk',           'γάλα βρώμης'],
  ['soy milk',           'γάλα σόγιας'],
  ['dry yeast',          'ξηρή μαγιά'],
  ['fresh yeast',        'φρέσκια μαγιά'],
  ['almonds',            'αμύγδαλα'],
  ['walnuts',            'καρύδια'],
  ['cashews',            'κάσιους'],
  ['pistachios',         'φιστίκια'],
  ['peanuts',            'φιστίκια αράπικα'],
  ['hazelnuts',          'φουντούκια'],
  ['sesame seeds',       'σουσάμι'],
  ['sunflower seeds',    'ηλιόσποροι'],
  ['pumpkin seeds',      'κολοκυθόσποροι'],
  ['raisins',            'σταφίδες'],
  ['sultanas',           'σουλτανίνες'],
  ['dates',              'χουρμάδες'],
  ['figs',               'σύκα'],
  ['apricots',           'βερίκοκα'],
  ['blueberries',        'μύρτιλλα'],
  ['strawberries',       'φράουλες'],
  ['raspberries',        'βατόμουρα'],
  ['mango',              'μάνγκο'],
  ['pineapple',          'ανανάς'],
  ['avocado',            'αβοκάντο'],
  ['banana',             'μπανάνα'],
  ['apple',              'μήλο'],
  ['pear',               'αχλάδι'],
  ['grapes',             'σταφύλια'],
  ['kiwi',               'ακτινίδιο'],
  ['peas',               'μπιζέλια'],
  ['corn',               'καλαμπόκι'],
  ['sweet corn',         'γλυκό καλαμπόκι'],
  ['artichoke',          'αγκινάρα'],
  ['asparagus',          'σπαράγγια'],
  ['pumpkin',            'κολοκύθα'],
  ['butternut squash',   'κολοκύθα βουτύρου'],
  ['sweet potato',       'γλυκοπατάτα'],
  ['turnip',             'γογγύλι'],
  ['beetroot',           'παντζάρι'],
  ['radish',             'ραπανάκι'],
  ['fennel',             'μάραθο'],
  ['pak choi',           'πακ τσόι'],
  ['bok choy',           'πακ τσόι'],
  ['tofu',               'τόφου'],
  ['tempeh',             'τέμπε'],
  ['lentil',             'φακή'],
  ['chickpea',           'ρεβίθι'],
  ['black beans',        'μαύρα φασόλια'],
  ['pinto beans',        'πίντο φασόλια'],
  ['white beans',        'άσπρα φασόλια'],
  ['broad beans',        'κουκιά'],
  ['edamame',            'εντάμαμε'],
  ['quinoa',             'κινόα'],
  ['couscous',           'κους κους'],
  ['bulgur',             'πλιγούρι'],
  ['freekeh',            'φρίκε'],
  ['semolina',           'σιμιγδάλι'],
  ['oats',               'βρώμη'],
  ['polenta',            'πολέντα'],
  ['basmati rice',       'ρύζι μπασμάτι'],
  ['risotto rice',       'ρύζι για ριζότο'],
  ['arborio',            'αρμπόριο'],
  ['tagliatelle',        'ταλιατέλε'],
  ['fettuccine',         'φετουτσίνε'],
  ['linguine',           'λινγκουίνε'],
  ['rigatoni',           'ριγκατόνι'],
  ['farfalle',           'φαρφάλε'],
  ['orzo',               'κριθαράκι'],
  ['ginger',             'τζίντζερ'],
  ['galangal',           'γκαλάνγκαλ'],
  ['lemongrass',         'λεμονόχορτο'],
  ['kaffir lime',        'κάφιρ λάιμ'],
  ['star anise',         'γλυκάνισο'],
  ['cardamom',           'κάρδαμο'],
  ['cloves',             'γαρύφαλλα'],
  ['allspice',           'μπαχάρι'],
  ['fenugreek',          'τριγωνέλλα'],
  ['sumac',              'σουμάκ'],
  ['za\'atar',           'ζαατάρ'],
  ['harissa',            'χαρίσα'],
  ['ras el hanout',      'ράς ελ χανούτ'],
  ['curry paste',        'πάστα κάρι'],
  ['curry powder',       'σκόνη κάρι'],
  ['garam masala',       'γκαράμ μασάλα'],
  ['turmeric',           'κουρκουμάς'],
  ['coriander seeds',    'σπόροι κόλιανδρου'],
  ['fennel seeds',       'σπόροι μάραθου'],
  ['mustard seeds',      'σπόροι μουστάρδας'],
  ['chilli flakes',      'νιφάδες τσίλι'],
  ['smoked paprika',     'καπνιστή πάπρικα'],
  ['sweet paprika',      'γλυκιά πάπρικα'],
  ['cayenne pepper',     'καγιέν'],
  ['white pepper',       'λευκό πιπέρι'],
  ['mixed herbs',        'μείγμα μυρωδικών'],
  ['italian seasoning',  'ιταλικά μυρωδικά'],
  ['herbes de provence', 'προβηγκιανά βότανα'],
];

// Apply ingredient word-level translation using the dictionary
function translateIngredient(ing) {
  let result = ing;
  for (const [en, gr] of ING_WORDS_GR) {
    const regex = new RegExp(`\\b${en}\\b`, 'gi');
    if (regex.test(result)) {
      result = result.replace(regex, gr);
    }
  }
  return result;
}

// ── Translation cache ─────────────────────────────────────────────────────────
const trCache = new Map();

// ── MyMemory: last-resort per-text fallback ───────────────────────────────────
async function translateViaMyMemory(text) {
  if (!text || !text.trim()) return text;
  try {
    const { data } = await axios.get('https://api.mymemory.translated.net/get', {
      params: { q: text.slice(0, 500), langpair: 'en|el' },
      timeout: 5000,
    });
    const t = data?.responseData?.translatedText;
    return (t && t !== text) ? t : text;
  } catch {
    return text;
  }
}

// ── AI: batch-translate an array of titles in one call ────────────────────────
// Returns a map { englishTitle → greekTitle } for all titles not in static dict.
async function batchTranslateTitles(titles) {
  const missing = [...new Set(titles.filter(t => t && !MEAL_NAMES_GR[t] && !trCache.has(`title:${t}`)))];
  if (missing.length === 0) return;

  const SYSTEM = 'You are a culinary translator. Translate recipe names from English to natural Greek. Return ONLY valid JSON, no markdown.';
  const USER   = `Translate these recipe names to Greek. Return {"results":[{"en":"...","gr":"..."},...]}:\n${JSON.stringify(missing)}`;

  try {
    const raw     = await callAI(SYSTEM, USER);
    const cleaned = raw.replace(/```json|```/g, '').trim();
    const parsed  = JSON.parse(cleaned);
    for (const { en, gr } of (parsed.results || [])) {
      if (en && gr && gr !== en) {
        MEAL_NAMES_GR[en] = gr;
        trCache.set(`title:${en}`, gr);
      }
    }
  } catch {
    // Silently fall through — per-title fallback will handle it
  }
}

// ── AI: translate a full instruction text ────────────────────────────────────
async function translateInstructionsAI(text) {
  if (!text || text.length < 20) return text || '';
  const cacheKey = `inst:${text.slice(0, 100)}`;
  if (trCache.has(cacheKey)) return trCache.get(cacheKey);

  const SYSTEM = `You are a culinary translator. Translate the recipe instructions from English to natural, clear Greek suitable for a home cook.
Rules:
- Keep step numbering (Step 1, Step 2 → Βήμα 1, Βήμα 2)
- Translate measurements naturally (cup → φλιτζάνι, tbsp → κ.σ., tsp → κ.γ.)
- Use common Greek cooking vocabulary
- Do NOT include any English text in the output
- Return ONLY the translated text, no explanations`;

  try {
    const result = await callAI(SYSTEM, text.slice(0, 2500));
    if (result && result.trim() && result.trim().length > 20) {
      const clean = result.trim();
      trCache.set(cacheKey, clean);
      return clean;
    }
  } catch { /* fall through */ }

  // Fallback: MyMemory in chunks
  const sentences = text.match(/[^.!?\n]+[.!?\n]+/g) || [text];
  const chunks = [];
  let current = '';
  for (const s of sentences) {
    if ((current + s).length > 450) { if (current) chunks.push(current.trim()); current = s; }
    else current += s;
  }
  if (current.trim()) chunks.push(current.trim());
  const parts = [];
  for (const chunk of chunks) {
    parts.push(await translateViaMyMemory(chunk));
    await new Promise(r => setTimeout(r, 60));
  }
  const fallback = parts.join(' ');
  trCache.set(cacheKey, fallback);
  return fallback;
}

// ── Translate a single title (dict → cache → AI single → MyMemory) ───────────
async function translateTitle(title) {
  if (!title) return title;
  if (MEAL_NAMES_GR[title]) return MEAL_NAMES_GR[title];
  const cacheKey = `title:${title}`;
  if (trCache.has(cacheKey)) return trCache.get(cacheKey);
  // Partial dict match
  for (const [en, gr] of Object.entries(MEAL_NAMES_GR)) {
    if (title.toLowerCase().includes(en.toLowerCase())) {
      const result = title.replace(new RegExp(en, 'i'), gr);
      trCache.set(cacheKey, result);
      return result;
    }
  }
  // Single AI call for one title
  try {
    const result = await callAI(
      'Translate this recipe name to Greek. Return ONLY the Greek translation, nothing else.',
      title
    );
    if (result && result.trim() && result.trim() !== title) {
      const clean = result.trim();
      MEAL_NAMES_GR[title] = clean;
      trCache.set(cacheKey, clean);
      return clean;
    }
  } catch { /* fall through */ }
  // Last resort: MyMemory
  const mm = await translateViaMyMemory(title);
  trCache.set(cacheKey, mm);
  return mm;
}

// ── Full meal translation ─────────────────────────────────────────────────────
async function translateMeal(meal) {
  const [titleGr, instructionsGr] = await Promise.all([
    translateTitle(meal.title),
    translateInstructionsAI(meal.instructions),
  ]);
  const ingredientsGr = (meal.ingredients || []).map(translateIngredient);

  return {
    ...meal,
    title:         titleGr,
    titleOriginal: meal.title,
    category:      CATEGORY_GR[meal.category] || meal.category,
    area:          AREA_GR[meal.area]          || meal.area,
    ingredients:   ingredientsGr,
    instructions:  instructionsGr,
  };
}

// Normalise a TheMealDB meal object into our Recipe model shape
function normaliseMeal(m) {
  if (!m) return null;
  const ingredients = [];
  for (let i = 1; i <= 20; i++) {
    const name    = m[`strIngredient${i}`]?.trim();
    const measure = m[`strMeasure${i}`]?.trim();
    if (name) ingredients.push(measure ? `${measure} ${name}` : name);
  }
  return {
    _id:          `mealdb_${m.idMeal}`,
    externalId:   m.idMeal,
    source:       'themealdb',
    title:        m.strMeal,
    image:        m.strMealThumb || null,
    category:     m.strCategory || null,
    area:         m.strArea     || null,
    instructions: m.strInstructions || '',
    youtube:      m.strYoutube  || null,
    tags:         m.strTags ? m.strTags.split(',').map(t => t.trim()).filter(Boolean) : [],
    ingredients,
    kcal: null, protein: null, carbs: null, fat: null,
  };
}

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /api/meals/greek
router.get('/greek', async (req, res) => {
  const cacheKey = 'greek_area_gr';
  const cached = cacheGet(cacheKey);
  if (cached) return res.json(cached);

  try {
    const { data: listData } = await axios.get(`${BASE}/filter.php`, {
      params: { a: 'Greek' }, timeout: 8000,
    });
    const meals = listData?.meals || [];

    const detailed = await Promise.all(
      meals.slice(0, 30).map(async m => {
        try {
          const { data } = await axios.get(`${BASE}/lookup.php`, {
            params: { i: m.idMeal }, timeout: 6000,
          });
          return normaliseMeal(data?.meals?.[0]);
        } catch { return normaliseMeal(m); }
      })
    );

    const valid = detailed.filter(Boolean);

    // Pre-warm title cache with a single batch AI call
    await batchTranslateTitles(valid.map(m => m.title));

    // Translate all meals sequentially to respect API rate limits
    const translated = [];
    for (const meal of valid) {
      translated.push(await translateMeal(meal));
    }

    const result = { meals: translated, total: meals.length };
    cacheSet(cacheKey, result, TR_TTL);
    res.json(result);
  } catch (err) {
    console.error('❌ TheMealDB greek:', err.message);
    res.status(502).json({ meals: [], total: 0, error: 'TheMealDB unavailable' });
  }
});

// GET /api/meals/mediterranean
router.get('/mediterranean', async (req, res) => {
  const cacheKey = 'mediterranean_gr';
  const cached = cacheGet(cacheKey);
  if (cached) return res.json(cached);

  try {
    const areas = ['Greek', 'Italian', 'Spanish', 'Turkish', 'Moroccan'];
    const allLists = await Promise.all(
      areas.map(a =>
        axios.get(`${BASE}/filter.php`, { params: { a }, timeout: 8000 })
             .then(r => (r.data?.meals || []).map(m => ({ ...m, area: a })))
             .catch(() => [])
      )
    );
    const flat    = allLists.flat();
    // Sample up to 8 from each area for richer pagination
    const sampled = areas.flatMap(a => flat.filter(m => m.area === a).slice(0, 8));

    const detailed = await Promise.all(
      sampled.map(async m => {
        try {
          const { data } = await axios.get(`${BASE}/lookup.php`, {
            params: { i: m.idMeal }, timeout: 6000,
          });
          return normaliseMeal(data?.meals?.[0]);
        } catch { return normaliseMeal(m); }
      })
    );

    const valid = detailed.filter(Boolean);

    // Pre-warm title cache with a single batch AI call
    await batchTranslateTitles(valid.map(m => m.title));

    const translated = [];
    for (const meal of valid) {
      translated.push(await translateMeal(meal));
    }

    const result = { meals: translated, total: translated.length };
    cacheSet(cacheKey, result, TR_TTL);
    res.json(result);
  } catch (err) {
    console.error('❌ TheMealDB mediterranean:', err.message);
    res.status(502).json({ meals: [], total: 0 });
  }
});

// GET /api/meals/search?q=moussaka
router.get('/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.status(400).json({ meals: [] });

  const cacheKey = `search_gr_${q.toLowerCase()}`;
  const cached = cacheGet(cacheKey);
  if (cached) return res.json(cached);

  try {
    const { data } = await axios.get(`${BASE}/search.php`, {
      params: { s: q }, timeout: 8000,
    });
    const raw = (data?.meals || []).map(normaliseMeal).filter(Boolean);

    // Pre-warm title cache with a single batch AI call
    await batchTranslateTitles(raw.map(m => m.title));

    const translated = [];
    for (const meal of raw) {
      translated.push(await translateMeal(meal));
    }
    const result = { meals: translated, total: translated.length };
    cacheSet(cacheKey, result, TR_TTL);
    res.json(result);
  } catch (err) {
    console.error('❌ TheMealDB search:', err.message);
    res.status(502).json({ meals: [] });
  }
});

// GET /api/meals/random
router.get('/random', async (req, res) => {
  try {
    const { data } = await axios.get(`${BASE}/random.php`, { timeout: 6000 });
    const raw  = normaliseMeal(data?.meals?.[0]);
    const meal = raw ? await translateMeal(raw) : null;
    res.json(meal || null);
  } catch (err) {
    console.error('❌ TheMealDB random:', err.message);
    res.status(502).json(null);
  }
});

// GET /api/meals/categories
router.get('/categories', async (req, res) => {
  const cached = cacheGet('categories');
  if (cached) return res.json(cached);
  try {
    const { data } = await axios.get(`${BASE}/categories.php`, { timeout: 6000 });
    const result = (data?.categories || []).map(c => ({
      ...c,
      strCategory: CATEGORY_GR[c.strCategory] || c.strCategory,
    }));
    cacheSet('categories', result);
    res.json(result);
  } catch {
    res.json([]);
  }
});

module.exports = router;
