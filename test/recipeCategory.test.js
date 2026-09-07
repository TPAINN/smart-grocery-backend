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

test('only the title decides the category', () => {
  /* Ingredients used to be part of the hints, which was harmless only because
     the accented patterns rarely fired; with the matching repaired, a spoon of
     ζάχαρη would file a beef stew under Επιδόρπια.

     The description and the site's keywords went the same way, and that was
     measured rather than assumed. On the first catalogue built with this
     classifier, «ΒΡΑΣΤΟ ΚΡΕΑΣ ΚΑΙ ΜΟΣΧΑΡΙΣΙΟΣ ΖΩΜΟΣ» and
     «ΡΕΒΥΘΟΚΕΦΤΕΔΕΣ & DIP ΜΕ ΤΥΡΙ ΚΡΕΜΑ» both landed under Σούπες, matched on
     prose and SEO tags rather than on what the dish is. A title names the
     dish; everything around it only mentions things. */
  assert.equal(
    recipeCategory({
      title: 'Μοσχάρι κοκκινιστό',
      description: 'Σερβίρεται με σάλτσα από ζωμό και μια δροσερή σαλάτα',
      keywords: ['σούπα', 'επιδόρπιο'],
      ingredients: ['ζάχαρη', 'γλυκό κρασί'],
    }),
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
