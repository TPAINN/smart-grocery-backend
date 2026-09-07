const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

/*
 * Which environment variables are allowed to stop the service from starting.
 *
 * The Stripe keys were on the required list, and in production a missing one
 * called process.exit(1). That meant the public price catalogue — the entire
 * product, and nothing to do with payments — refused to boot over an
 * unconfigured payment feature, with Render restarting it into the same
 * failure. Read as source, because requiring server.js starts a server.
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

test('payment keys are optional and merely warned about', () => {
  assert.deepEqual(list('OPTIONAL_ENV').sort(), ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET']);
  assert.match(SRC, /console\.warn\(`[^`]*Not configured/);
});

test('the payment routes refuse on their own rather than at boot', () => {
  const stripeSrc = fs.readFileSync(require.resolve('../routes/stripe.js'), 'utf8');
  assert.doesNotMatch(stripeSrc, /^const stripe = new Stripe/m, 'client must not be built at import');
  assert.match(stripeSrc, /res\.status\(503\)/);
});
