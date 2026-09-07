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
   dessert that contains "σαλατα". */
const RULES = [
  ['Επιδόρπια',   /φρουτοσαλατα|σαλατα φρουτων|επιδορπ|γλυκ|dessert|κεικ|cake|μπισκοτ|τουρτ|ταρτ|tart|brownie|cheesecake|παγωτ|κρεμα καραμελε|σοκολατοπ|μους σοκολ|λουκουμαδ|μπακλαβ|γαλακτομπουρεκ|ραβανι|κανταιφι|χαλβα|μελομακαρον|κουραμπιεδ|τσουρεκ|donut|muffin|cupcake|pudding/],
  ['Πρωινό',      /πρωιν|breakfast|βρωμη|oatmeal|granola|pancake|τηγανιτ|αυγα ματια|ομελετ|omelette|omelet|φρυγανι|τοστ|toast/],
  ['Ροφήματα',    /ροφημ|smoothie|shake|drink|κοκτειλ|cocktail|χυμο|λεμοναδ|φραπε|καφε|τσαι|σοκολατα ροφημα/],
    // σουπ(?!ι): «σουπιά» is cuttlefish, and was being served as soup.
  ['Σούπες',      /σουπ(?!ι)|βελουτε|μαγειριτσ|ψαροσουπ|κοτοσουπ|φασολαδ|φακες|ρεβιθαδ|soup|broth/],
  ['Σαλάτες',     /σαλατ|salad|ταμπουλε|coleslaw/],
  ['Ορεκτικά',    /ορεκτικ|μεζε|appetizer|starter|dip |ντιπ|τζατζικ|τυροκαυτερ|μελιτζανοσαλατ|ταραμοσαλατ|φαβα|ντολμαδ|τυροπιτακ|κεφτεδακ|σαγανακ|μπρουσκετ|bruschetta|κρουτον|πικαντικ μπουκι|finger food/],
  ['Ζυμαρικά',    /ζυμαρικ|μακαρον|pasta|σπαγγετ|spaghetti|πεννε|penne|ταλιατελ|tagliatelle|λαζανι|lasagn|παστιτσι|κριθαρακ|χυλοπιτ|νιοκ|gnocchi|φετουτσιν|fettuccine|ραβιολ|ravioli|noodle|κοφτο μακαρονακ/],
  ['Σνακ',        /σνακ|snack|μπαρ δημητριακ|energy ball|ενεργειακ μπαλ|ποπ κορν|popcorn/],
  ['Συνοδευτικά', /συνοδευτ|side dish|γαρνιτουρ|πουρε|ριζι πιλαφ|πατατες φουρνου συνοδ/],
];

/**
 * @param {{title?: string}} recipe
 * @returns {string} one of the category names above, or 'Κυρίως'
 */
function recipeCategory(recipe) {
  const r = recipe || {};
  const text = fold(r.title);
  for (const [name, pattern] of RULES) {
    if (pattern.test(text)) return name;
  }
  return 'Κυρίως';
}

module.exports = { recipeCategory, fold };
