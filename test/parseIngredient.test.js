const test = require('node:test');
const assert = require('node:assert/strict');
const { parseIngredient } = require('../lib/parseIngredient.js');

/*
 * The parser exists so an ingredient line can be matched against a supermarket
 * product, and a match only works on the NAME — amount stripped off the front,
 * preparation note off the back.
 *
 * The rule shaping most expectations here: a wrong split is worse than no
 * split. Leaving a line alone costs one unmatched ingredient; mis-splitting it
 * silently matches the wrong product and puts a wrong price in front of the
 * user. So quantity and unit stay null whenever the line does not clearly state
 * them, and nothing is invented.
 */

test('a bare ingredient gets no invented quantity or unit', () => {
  assert.deepEqual(parseIngredient('αλάτι'), {
    quantity: null, unit: null, name: 'αλάτι', notes: '', raw: 'αλάτι',
  });
});

const q = (line) => parseIngredient(line);

test('a multi-word bare ingredient stays intact', () => {
  const r = q('φρέσκο τριμμένο πιπέρι');
  assert.equal(r.name, 'φρέσκο τριμμένο πιπέρι');
  assert.equal(r.quantity, null);
});

test('a leading bullet is stripped without touching the name', () => {
  assert.equal(q('- αλεύρι για όλες τις χρήσεις').name, 'αλεύρι για όλες τις χρήσεις');
});

test('digits and a metric unit split cleanly', () => {
  const r = q('500 γρ. κιμά μοσχαρίσιο');
  assert.equal(r.quantity, 500);
  assert.equal(r.unit, 'g');
  assert.equal(r.name, 'κιμά μοσχαρίσιο');
});

test('a count with no unit keeps the quantity and the plain name', () => {
  const r = q('3 αυγά');
  assert.equal(r.quantity, 3);
  assert.equal(r.unit, null);
  assert.equal(r.name, 'αυγά');
});

test('kilograms normalise to kg', () => {
  const r = q('1 κιλό πατάτες');
  assert.equal(r.quantity, 1);
  assert.equal(r.unit, 'kg');
  assert.equal(r.name, 'πατάτες');
});

test('millilitres normalise to ml', () => {
  const r = q('200 ml γάλα');
  assert.equal(r.unit, 'ml');
  assert.equal(r.name, 'γάλα');
});

test('litres normalise to l', () => {
  const r = q('1 λίτρο ζωμό κότας');
  assert.equal(r.unit, 'l');
  assert.equal(r.name, 'ζωμό κότας');
});

test('a slash fraction becomes a decimal', () => {
  assert.equal(q('1/2 φλιτζάνι ζάχαρη').quantity, 0.5);
});

test('a vulgar fraction becomes a decimal', () => {
  assert.equal(q('½ κουταλάκι γλυκού κανέλα').quantity, 0.5);
});

test('a mixed number written with a vulgar fraction keeps its whole part', () => {
  assert.equal(q('1½ φλιτζάνι αλεύρι').quantity, 1.5);
});

test('a mixed number written with a slash keeps its whole part', () => {
  assert.equal(q('1 1/2 κούπα γάλα').quantity, 1.5);
});

test('a repeating fraction is rounded rather than shown in full', () => {
  assert.equal(q('⅓ φλιτζάνι λάδι').quantity, 0.33);
});

test('a comma is read as a decimal separator, not a note', () => {
  const r = q('1,5 κιλό κοτόπουλο');
  assert.equal(r.quantity, 1.5);
  assert.equal(r.name, 'κοτόπουλο');
});

test('a spelled-out number is understood', () => {
  const r = q('δύο κρεμμύδια');
  assert.equal(r.quantity, 2);
  assert.equal(r.name, 'κρεμμύδια');
});

test('"μισό" is half, not one', () => {
  assert.equal(q('μισό κιλό ντομάτες').quantity, 0.5);
});

test('a longer spelled-out number wins over a shorter one it contains', () => {
  // "μιάμιση" starts with "μια"; reading it as 1 would silently lose the half.
  assert.equal(q('μιάμιση κούπα ζάχαρη').quantity, 1.5);
});

test('a word that merely starts like a number is not read as one', () => {
  assert.equal(q('μιαλή σάλτσα').quantity, null);
});

test('a range takes its lower bound', () => {
  const r = q('2-3 σκελίδες σκόρδο');
  assert.equal(r.quantity, 2);
  assert.equal(r.unit, 'clove');
  assert.equal(r.name, 'σκόρδο');
});

test('the abbreviated tablespoon is recognised', () => {
  const r = q('2 κ.σ. ελαιόλαδο');
  assert.equal(r.unit, 'tbsp');
  assert.equal(r.name, 'ελαιόλαδο');
});

test('the fully spelled tablespoon maps to the same unit', () => {
  assert.equal(q('2 κουταλιές της σούπας ελαιόλαδο').unit, 'tbsp');
});

test('the abbreviated teaspoon is not confused with the tablespoon', () => {
  assert.equal(q('1 κ.γ. αλάτι').unit, 'tsp');
});

test('the fully spelled teaspoon maps to the same unit', () => {
  assert.equal(q('1 κουταλάκι του γλυκού μπέικιν πάουντερ').unit, 'tsp');
});

test('cups normalise regardless of spelling', () => {
  assert.equal(q('2 φλιτζάνια τσαγιού αλεύρι').unit, 'cup');
  assert.equal(q('2 κούπες αλεύρι').unit, 'cup');
});

test('a parenthesised note leaves the name clean', () => {
  const r = q('1 κρεμμύδι (ψιλοκομμένο)');
  assert.equal(r.name, 'κρεμμύδι');
  assert.equal(r.notes, 'ψιλοκομμένο');
});

test('a trailing clause after a comma becomes a note, not a second ingredient', () => {
  const r = q('2 καρότα, σε ροδέλες');
  assert.equal(r.name, 'καρότα');
  assert.equal(r.notes, 'σε ροδέλες');
});

test('an article glued on after the unit is dropped from the name', () => {
  assert.equal(q('2 κ.σ. από ελαιόλαδο').name, 'ελαιόλαδο');
});

test('a unit spelling that merely begins the ingredient name is not a unit', () => {
  // "γρ" opens "γραβιέρα"; matching it would leave the name as "αβιέρα".
  const r = q('200 γραβιέρα');
  assert.equal(r.unit, null);
  assert.equal(r.name, 'γραβιέρα');
});

test('a unit word with no quantity in front of it is not treated as a unit', () => {
  // "Φέτα" is a cheese here, not a slice.
  const r = q('Φέτα Δωδώνη');
  assert.equal(r.unit, null);
  assert.equal(r.name, 'Φέτα Δωδώνη');
});

test('an empty line yields empty fields rather than throwing', () => {
  assert.deepEqual(q('   '), { quantity: null, unit: null, name: '', notes: '', raw: '' });
});

test('the original line is always preserved for display', () => {
  assert.equal(q('500 γρ. κιμά').raw, '500 γρ. κιμά');
});
