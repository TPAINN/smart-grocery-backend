const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

/*
 * Which environment variables are allowed to stop the service from starting: only the ones it cannot answer
 * without. Read as source, because requiring server.js starts a server.
 */
const SRC = fs.readFileSync(require.resolve('../server.js'), 'utf8');
const list = (name) => {
  const m = SRC.match(new RegExp(`const ${name} = \\[([^\\]]*)\\]`));
  assert.ok(m, `server.js must define ${name}`);
  return m[1].split(',').map(s => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
};

test('only what the service cannot answer without is required', () => {
  assert.deepEqual(list('REQUIRED_ENV').sort(), ['JWT_SECRET', 'MONGO_URI']);
});

test('payments are gone for good', () => {
  assert.ok(!fs.existsSync(require.resolve('../server.js').replace('server.js', 'routes/stripe.js')));
  assert.doesNotMatch(SRC, /stripe/i);
  const pkg = JSON.parse(fs.readFileSync(require.resolve('../package.json'), 'utf8'));
  assert.equal(pkg.dependencies?.stripe, undefined);
});
