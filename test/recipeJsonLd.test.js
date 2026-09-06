const test = require('node:test');
const assert = require('node:assert/strict');
const { findRecipe, recipeSteps, repairJsonLd } = require('../lib/recipeJsonLd.js');

/*
 * Reading the schema.org Recipe block off a page.
 *
 * The old inline version was `try { JSON.parse(s) } catch { null }`, which is
 * the whole reason two of the five sites added here returned nothing at all.
 * Their plugins emit a recipe description containing a raw newline inside a
 * JSON string — invalid JSON, rejected by every parser — and a silent catch
 * turns "this site's markup has one stray character" into "this site has no
 * recipes", with no warning to say which.
 *
 * Verified live on 2026-09-07: greekcookingbykaterina.com and
 * madameginger.com both fail JSON.parse with "Bad control character in string
 * literal", and both parse cleanly once the control characters inside string
 * literals are escaped.
 */

test('a recipe block survives a raw newline inside a string', () => {
  const block = '{"@type":"Recipe","name":"Γαλατόπιτα","description":"Μια πίτα\nχωρίς φύλλο","recipeIngredient":["1 λίτρο γάλα","200 γρ ζάχαρη"]}';
  assert.throws(() => JSON.parse(block), 'the fixture must really be invalid JSON');
  const r = findRecipe([block]);
  assert.equal(r.name, 'Γαλατόπιτα');
  assert.equal(r.recipeIngredient.length, 2);
});

test('repair does not corrupt the newlines that format the document', () => {
  // Newlines BETWEEN tokens are legal and must stay as they are; only the ones
  // inside a string literal are illegal. Escaping both breaks the parse.
  const pretty = '{\n  "@type": "Recipe",\n  "name": "Σούπα"\n}';
  assert.equal(repairJsonLd(pretty), pretty);
  assert.equal(findRecipe([pretty]).name, 'Σούπα');
});

test('an already-escaped backslash is not mistaken for an escape', () => {
  // Written without backslash literals: this file has been mangled in transit
  // before, and a test about escaping must not depend on its own escaping.
  const BS = String.fromCharCode(92);
  const block = '{"@type":"Recipe","name":"a' + BS + BS + '","recipeIngredient":["x"]}';
  assert.equal(findRecipe([block]).name, 'a' + BS);
});

test('the recipe is found however the site nests it', () => {
  assert.equal(findRecipe(['{"@type":"Recipe","name":"A"}']).name, 'A');
  assert.equal(findRecipe(['[{"@type":"WebSite"},{"@type":"Recipe","name":"B"}]']).name, 'B');
  assert.equal(findRecipe(['{"@graph":[{"@type":"WebPage"},{"@type":"Recipe","name":"C"}]}']).name, 'C');
  assert.equal(findRecipe(['{"@type":["Recipe","NewsArticle"],"name":"D"}']).name, 'D');
});

test('a page with no recipe yields null rather than throwing', () => {
  assert.equal(findRecipe(['{"@type":"WebSite"}']), null);
  assert.equal(findRecipe(['not json at all']), null);
  assert.equal(findRecipe([]), null);
  assert.equal(findRecipe(null), null);
});

test('instructions come back as steps whatever shape they arrive in', () => {
  assert.deepEqual(recipeSteps(['Βράζουμε το νερό', 'Ρίχνουμε το ρύζι']),
    ['Βράζουμε το νερό', 'Ρίχνουμε το ρύζι']);
  assert.deepEqual(recipeSteps([{ '@type': 'HowToStep', text: 'Ζεσταίνουμε τον φούρνο' }]),
    ['Ζεσταίνουμε τον φούρνο']);
});

test('a sectioned method is flattened instead of stringified', () => {
  /* live-kitchen.gr wraps its steps in HowToSection. The old code did
     `clean(s.text || s)` on each entry, and a section has no `text`, so it fell
     through to the object itself and produced the literal "[object Object]" —
     long enough to pass the length filter and be saved as an instruction. */
  const sectioned = [
    { '@type': 'HowToSection', name: 'Ζύμη', itemListElement: [
      { '@type': 'HowToStep', text: 'Ανακατεύουμε το αλεύρι' },
      { '@type': 'HowToStep', text: 'Πλάθουμε τη ζύμη' },
    ] },
    { '@type': 'HowToStep', text: 'Ψήνουμε 40 λεπτά' },
  ];
  assert.deepEqual(recipeSteps(sectioned),
    ['Ανακατεύουμε το αλεύρι', 'Πλάθουμε τη ζύμη', 'Ψήνουμε 40 λεπτά']);
  assert.ok(!recipeSteps(sectioned).some(s => s.includes('object Object')));
});

test('html inside a step is stripped and empties are dropped', () => {
  assert.deepEqual(
    recipeSteps(['<p>Σοτάρουμε το <b>κρεμμύδι</b></p>', '   ', { text: '' }, 'ok.']),
    ['Σοτάρουμε το κρεμμύδι', 'ok.'],
  );
});

test('malformed instructions yield an empty list rather than throwing', () => {
  assert.deepEqual(recipeSteps(null), []);
  assert.deepEqual(recipeSteps('Ένα μόνο βήμα που είναι αρκετά μεγάλο'), ['Ένα μόνο βήμα που είναι αρκετά μεγάλο']);
});
