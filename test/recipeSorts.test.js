const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

/*
 * The fallback service must order the recipe list exactly as the Vercel
 * function does. A reader who falls back to Render should see the same
 * catalogue in the same order, not a differently sorted one — and the two
 * copies of the sort map live in different repositories, so nothing but a test
 * keeps them honest.
 *
 * Read as source rather than required, because routes/recipes.js pulls in
 * mongoose, models and the scraper the moment it is loaded.
 */
const SRC = fs.readFileSync(require.resolve('../routes/recipes.js'), 'utf8');

function sortMap() {
  const start = SRC.indexOf('const RECIPE_SORTS = {');
  assert.notEqual(start, -1, 'routes/recipes.js must define RECIPE_SORTS');
  const end = SRC.indexOf('\n};', start);
  // eslint-disable-next-line no-eval
  return eval(`(${SRC.slice(start + 'const RECIPE_SORTS = '.length, end + 2)})`);
}

test('the sort names match the ones the client sends', () => {
  assert.deepEqual(
    Object.keys(sortMap()).sort(),
    ['calories', 'newest', 'popular', 'protein', 'quick'],
  );
});

test('every ordering ends on a unique key', () => {
  /* Without it, two recipes written in the same millisecond have no defined
     order and MongoDB may resolve it differently for page 1 and page 2 —
     repeating some rows and skipping others as the reader pages. */
  for (const [name, spec] of Object.entries(sortMap())) {
    const keys = Object.keys(spec.sort);
    assert.equal(keys[keys.length - 1], '_id', `${name} must break ties on _id`);
  }
});

test('an ascending sort over a nullable field says which field it needs', () => {
  /* 50 of 379 recipes carry no time — GymBeam publishes a reading time and
     nothing else — and null sorts before every number, so «Γρήγορες» opened on
     ten recipes of unknown length until these sorts started excluding what
     they cannot rank. */
  const m = sortMap();
  assert.equal(m.quick.require, 'time');
  assert.equal(m.calories.require, 'calories');
  assert.equal(m.protein.require, undefined, 'descending needs no filter');
  assert.equal(m.popular.require, undefined);
  assert.equal(m.newest.require, undefined);
});

test('the route applies the requirement as a filter and returns the facet', () => {
  assert.match(SRC, /if \(spec\.require\) filter\[spec\.require\] = \{ \$gt: 0 \}/);
  assert.match(SRC, /categories: categories\.map/);
});
