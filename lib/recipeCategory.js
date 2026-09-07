/*
 * Which shelf a scraped recipe lands on.
 *
 * Two rules earn this its own file.
 *
 * Accents are stripped before matching. Greek category words carry a tone
 * inside the stem as often as after it — /σαλατ/ does not match "σαλάτα" and
 * /σουπ/ does not match "σούπα", while /γλυκ/ happens to match "γλυκό" because
 * its tone sits on the final letter. Matching accented text against unaccented
 * patterns therefore fails silently for exactly the categories whose keyword is
 * accented in the middle, and that is the whole explanation for a catalogue
 * that reads Κυρίως 111, Επιδόρπια 40, Σαλάτες 4, Σούπες 4, Συνοδευτικά 4.
 *
 * And only the title decides. Ingredients were hints once, which would file any
 * stew containing a spoon of ζάχαρη under Επιδόρπια. The description and the
 * site's keywords followed them out on measured evidence: in the first
 * catalogue built with this classifier, «ΒΡΑΣΤΟ ΚΡΕΑΣ ΚΑΙ ΜΟΣΧΑΡΙΣΙΟΣ
 * ΖΩΜΟΣ» and «ΡΕΒΥΘΟΚΕΦΤΕΔΕΣ & DIP» both landed under Σούπες, matched on
 * prose and SEO tags. A title names the dish; everything around it only
 * mentions things.
 */

/* Greek tonos/dialytika and Latin diacritics, decomposed then dropped. Final
   sigma folds to sigma so "συνταγές"/"σαλατεσ" match the same stem. */
function fold(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\u03c2/g, '\u03c3');
}

/* Ordered: the first match wins, so anything that reads as a dessert is tested
   before the savoury courses it can share a word with — φρουτοσαλάτα is a
   dessert that contains "σαλατα".

   `title` is the full rule, dish names included, because in a title a dish name
   IS the dish. `prose` is the narrow one, and which rules get one was measured
   rather than guessed — each pattern was run over the descriptions of the 205
   recipes in the live catalogue whose titles left them unresolved:

     ζυμαρικ|pasta      5 hits, 5 right     σαλατ       5 hits, 2 right
     σνακ|snack          7 hits, 6 right     πρωιν       6 hits, 4 right
     γλυκο as a word   14 hits, 13 right    συνοδευτ   4 hits, 0 right

   So Ζυμαρικά, Σνακ, Επιδόρπια, Σούπες, Ορεκτικά and Ροφήματα read
   prose; Σαλάτες, Πρωινό and Συνοδευτικά do not. A description that says
   a dish is served «με μια δροσερή σαλάτα» is describing the side, not the
   dish. A rule with `prose: null` never fires on prose at all. */
const RULES = [
  { name: 'Επιδόρπια',
    title: /φρουτοσαλατα|σαλατα φρουτων|επιδορπ|γλυκ|dessert|κεικ|cake|μπισκοτ|τουρτ|ταρτ|tart|brownie|cheesecake|παγωτ|κρεμα καραμελε|σοκολατοπ|μους σοκολ|λουκουμαδ|μπακλαβ|γαλακτομπουρεκ|ραβανι|κανταιφι|χαλβα|μελομακαρον|κουραμπιεδ|τσουρεκ|donut|muffin|cupcake|pudding/,
    prose: /επιδορπ|ζαχαροπλαστ|dessert|γλυκισμ|(^|[^α-ω])γλυκο([^α-ω]|$)/ },
  { name: 'Πρωινό',
    title: /πρωιν|breakfast|βρωμη|oatmeal|granola|pancake|τηγανιτ|αυγα ματια|ομελετ|omelette|omelet|φρυγανι|τοστ|toast/,
    prose: null },
  { name: 'Ροφήματα',
    title: /ροφημ|smoothie|shake|drink|κοκτειλ|cocktail|χυμο|λεμοναδ|φραπε|καφε|τσαι|σοκολατα ροφημα/,
    prose: /ροφημ|smoothie|cocktail|κοκτειλ/ },
  { name: 'Σούπες',
    // σουπ(?!ι): «σουπιά» is cuttlefish, and was being served as soup.
    title: /σουπ(?!ι)|βελουτε|μαγειριτσ|ψαροσουπ|κοτοσουπ|φασολαδ|φακες|ρεβιθαδ|soup|broth/,
    prose: /σουπ(?!ι)|soup/ },
  { name: 'Σαλάτες',
    title: /σαλατ|salad|ταμπουλε|coleslaw/,
    prose: null },
  { name: 'Ορεκτικά',
    title: /ορεκτικ|μεζε|appetizer|starter|dip|ντιπ|τζατζικ|τυροκαυτερ|μελιτζανοσαλατ|ταραμοσαλατ|φαβα|ντολμαδ|τυροπιτακ|κεφτεδακ|σαγανακ|μπρουσκετ|bruschetta|κρουτον|finger food/,
    prose: /ορεκτικ|μεζε|appetizer/ },
  { name: 'Ζυμαρικά',
    title: /ζυμαρικ|μακαρον|pasta|σπαγγετ|spaghetti|πεννε|penne|ταλιατελ|tagliatelle|λαζανι|lasagn|παστιτσι|κριθαρακ|χυλοπιτ|νιοκ|gnocchi|φετουτσιν|fettuccine|ραβιολ|ravioli|noodle|κοφτο μακαρονακ/,
    prose: /ζυμαρικ|pasta/ },
  { name: 'Σνακ',
    title: /σνακ|snack|μπαρ δημητριακ|energy ball|ενεργειακ μπαλ|ποπ κορν|popcorn/,
    prose: /σνακ|snack/ },
  { name: 'Συνοδευτικά',
    title: /συνοδευτ|side dish|γαρνιτουρ|πουρε|ριζι πιλαφ/,
    prose: null },
];

/**
 * @param {{title?: string, description?: string, keywords?: string[]}} recipe
 * @returns {string} one of the category names above, or 'Κυρίως'
 */
function recipeCategory(recipe) {
  const r = recipe || {};
  const title = fold(r.title);
  for (const rule of RULES) if (rule.title.test(title)) return rule.name;

  /* The title said nothing. Title-only was tried on the live catalogue and was
     worse — it sent 36 desserts back to Κυρίως in a single pass, because
     «Τιραμισού» and «Μπανόφι» carry no dessert word while their descriptions
     open with «ένα γλυκό». */
  const prose = fold([r.description, ...(r.keywords || [])].filter(Boolean).join(' '));
  if (prose) for (const rule of RULES) if (rule.prose && rule.prose.test(prose)) return rule.name;

  return 'Κυρίως';
}

module.exports = { recipeCategory, fold };
