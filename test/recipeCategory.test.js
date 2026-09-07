const test = require('node:test');
const assert = require('node:assert/strict');
const { recipeCategory } = require('../lib/recipeCategory.js');

/*
 * Which shelf a recipe lands on.
 *
 * The old version lowercased its hints and matched them against unaccented
 * patterns, which works for a word whose accent falls after the stem and
 * silently fails for one whose accent falls inside it. /σαλατ/ never matches
 * "σαλάτα" and /σουπ/ never matches "σούπα", while /γλυκ/ does match "γλυκό"
 * because the tone sits on the last letter.
 *
 * That is not a cosmetic difference. It is why the live catalogue reads
 * Κυρίως 111, Επιδόρπια 40, and Σαλάτες 4 / Σούπες 4 / Συνοδευτικά 4 — the
 * three categories whose keyword carries an accent in the stem. Every salad we
 * ever scraped is filed under "Κυρίως".
 */

test('an accented category word is recognised', () => {
  assert.equal(recipeCategory({ title: 'Σαλάτα του Καίσαρα' }), 'Σαλάτες');
  assert.equal(recipeCategory({ title: 'Σούπα λαχανικών' }), 'Σούπες');
  assert.equal(recipeCategory({ title: 'Επιδόρπιο με γιαούρτι' }), 'Επιδόρπια');
  assert.equal(recipeCategory({ title: 'Συνοδευτικό ρυζιού' }), 'Συνοδευτικά');
});

test('the unaccented spelling still works', () => {
  // Titles arrive from the sites in every casing and accenting there is.
  assert.equal(recipeCategory({ title: 'ΣΑΛΑΤΕΣ ΤΟΥ ΚΑΛΟΚΑΙΡΙΟΥ' }), 'Σαλάτες');
  assert.equal(recipeCategory({ title: 'ΣΟΥΠΑ ΤΡΑΧΑΝΑΣ' }), 'Σούπες');
});

test('the categories a Greek kitchen needs but nothing filed under', () => {
  // Both were landing in Κυρίως, which is why that bucket holds two thirds of
  // the catalogue on its own.
  assert.equal(recipeCategory({ title: 'Τζατζίκι' }), 'Ορεκτικά');
  assert.equal(recipeCategory({ title: 'Ντολμαδάκια γιαλαντζί' }), 'Ορεκτικά');
  assert.equal(recipeCategory({ title: 'Μακαρόνια με κιμά' }), 'Ζυμαρικά');
  assert.equal(recipeCategory({ title: 'Παστίτσιο' }), 'Ζυμαρικά');
});

test('the title decides first, and it decides alone', () => {
  /* Ingredients were hints once, which would file any stew containing a spoon
     of ζάχαρη under Επιδόρπια. Prose is nearly as bad: «ΒΡΑΣΤΟ ΚΡΕΑΣ ΚΑΙ
     ΜΟΣΧΑΡΙΣΙΟΣ ΖΩΜΟΣ» landed under Σούπες because its description mentions
     ζωμό, and «ΡΕΒΥΘΟΚΕΦΤΕΔΕΣ & DIP» because of the site's SEO tags. */
  assert.equal(
    recipeCategory({
      title: 'Μοσχάρι κοκκινιστό',
      description: 'Σερβίρεται με σάλτσα από ζωμό και μια δροσερή σαλάτα',
      ingredients: ['ζάχαρη', 'γλυκό κρασί'],
    }),
    'Κυρίως',
  );
});

test('prose is a fallback, and only for the words that name a category', () => {
  /* Title-only was tried and was worse: it sent 36 desserts back to Κυρίως in
     one pass over the live catalogue, because a title like «Τιραμισού» or
     «Μπανόφι» contains no dessert word at all while its description opens with
     «ένα γλυκό». So when the title says nothing, the description and keywords
     are read — but only for the handful of words that literally name a
     category, never for the dish-name heuristics that caused the false
     positives above. */
  assert.equal(
    recipeCategory({ title: 'Τιραμισού', description: 'Το πιο κλασικό ιταλικό γλυκό' }),
    'Επιδόρπια',
  );
  assert.equal(
    recipeCategory({ title: 'Μπανόφι', keywords: ['επιδόρπια', 'εύκολο'] }),
    'Επιδόρπια',
  );
  // ζωμός names an ingredient, not a category, so it stays out of the fallback.
  assert.equal(
    recipeCategory({ title: 'Βραστό κρέας', description: 'και μοσχαρίσιος ζωμός' }),
    'Κυρίως',
  );
  // Neither does τραχανάς, which is as often a meatball as a soup.
  assert.equal(
    recipeCategory({ title: 'Αραντσίνι', keywords: ['τραχανάς', 'κεφτέδες'] }),
    'Κυρίως',
  );
});

test('a soup word inside another dish name is not a soup', () => {
  // «σουπιά» is cuttlefish. It was filed under Σούπες.
  assert.equal(recipeCategory({ title: 'Σουπιά στο φούρνο με πιπεριές' }), 'Κυρίως');
  assert.equal(recipeCategory({ title: 'Σουπιές κρασάτες' }), 'Κυρίως');
  // The real thing still is one.
  assert.equal(recipeCategory({ title: 'Σούπα βελουτέ με φάβα' }), 'Σούπες');
  assert.equal(recipeCategory({ title: 'Φασολάδα της γιαγιάς' }), 'Σούπες');
});

test('a dessert wins over the salad in its own name', () => {
  // "Φρουτοσαλάτα" is a dessert; "σαλάτα" appears inside the word.
  assert.equal(recipeCategory({ title: 'Φρουτοσαλάτα με μέλι' }), 'Επιδόρπια');
  assert.equal(recipeCategory({ title: 'Σαλάτα φρούτων' }), 'Επιδόρπια');
});

test('a savoury salad is still a salad', () => {
  assert.equal(recipeCategory({ title: 'Χωριάτικη σαλάτα' }), 'Σαλάτες');
  assert.equal(recipeCategory({ title: 'Σαλάτα με κινόα και αβοκάντο' }), 'Σαλάτες');
});

test('the remaining categories keep working', () => {
  assert.equal(recipeCategory({ title: 'Πρωινό με βρώμη' }), 'Πρωινό');
  assert.equal(recipeCategory({ title: 'Υγιεινό σνακ με ξηρούς καρπούς' }), 'Σνακ');
  assert.equal(recipeCategory({ title: 'Smoothie μπανάνα' }), 'Ροφήματα');
  assert.equal(recipeCategory({ title: 'Κέικ σοκολάτας' }), 'Επιδόρπια');
});

test('anything unrecognised is a main course, as before', () => {
  assert.equal(recipeCategory({ title: 'Γεμιστά' }), 'Κυρίως');
  assert.equal(recipeCategory({}), 'Κυρίως');
  assert.equal(recipeCategory(null), 'Κυρίως');
});
