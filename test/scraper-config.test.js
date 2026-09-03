const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'services', 'scraper.js'), 'utf8');

/*
 * Two Lidl regexes once shipped with their backslashes stripped:
 *
 *   /(-?d+)s*%/          instead of  /(-?\d+)\s*%/
 *   /(d+)s*[/|]s*(d+)/   instead of  /(\d+)\s*[/|]\s*(\d+)/
 *
 * They match the literal letters "d" and "s", so they never fire. Nothing
 * crashed — the load-more counter simply reported 0/0 forever and the loop's
 * own termination condition could never be true. It went unnoticed for months.
 *
 * A bare `d+` or `s*` inside a regex literal is always this mistake: to match a
 * literal "d" followed by one-or-more of anything you would write it very
 * differently. Catching it here costs nothing and the failure mode it prevents
 * is silent.
 */
test('no regex in the scraper has lost its backslashes', () => {
  const offenders = [];
  SRC.split('\n').forEach((line, i) => {
    // regex literals only, and only where a shorthand class was clearly meant
    for (const m of line.matchAll(/\/(?![/*])((?:\\.|\[[^\]]*\]|[^/\\\n])+)\/[gimsuy]*/g)) {
      const body = m[1];
      if (/(?<!\\)\bd\+|(?<!\\)\bs\*|(?<!\\)\bw\+|(?<!\\)\bd\{/.test(body)) {
        offenders.push(`  line ${i + 1}: ${line.trim().slice(0, 90)}`);
      }
    }
  });
  assert.equal(offenders.length, 0, `regex missing a backslash:\n${offenders.join('\n')}`);
});

/*
 * Masoutis categories only resolve when the `item` query parameter is present.
 * Twenty of twenty-four configured URLs lacked it and returned an empty page
 * with HTTP 200, so the scrape reported success while collecting nothing
 * outside the four promotional pages that happened to carry it.
 */
test('every Masoutis category URL carries the item parameter it needs', () => {
  const block = /const MASOUTIS_URLS\s*=\s*\[([\s\S]*?)\];/.exec(SRC)[1];
  const urls = [...block.matchAll(/"(https:\/\/www\.masoutis\.gr\/[^"]+)"/g)].map((m) => m[1]);
  assert.ok(urls.length > 0, 'no Masoutis URLs found');
  const missing = urls.filter((u) => !/[?&]item=\d+/.test(u));
  assert.deepEqual(missing, [], `Masoutis URLs without ?item=:\n  ${missing.join('\n  ')}`);
});

/*
 * Every chain the dispatcher can route to must have a config entry, and every
 * config must carry the selector its extractor keys off. A chain whose config
 * silently loses its `card` collects nothing while still reporting success —
 * the same shape of failure as the two above.
 */
test('every dispatched chain has a config with a card selector', () => {
  const dispatched = [...SRC.matchAll(/case '([^']+)':\s*await scrape/g)].map((m) => m[1]);
  assert.ok(dispatched.length >= 8, `expected at least 8 chains, found ${dispatched.length}`);

  const missing = dispatched.filter((chain) => {
    const at = SRC.indexOf(`'${chain}': {`);
    /* `card` is always among the first properties of an entry, so a generous
       window avoids depending on whether that entry is written on one line
       or spread over several. */
    return at === -1 || !/card\s*:/.test(SRC.slice(at, at + 400));
  });
  assert.deepEqual(missing, [], `chains dispatched but missing a card selector: ${missing.join(', ')}`);
});

/*
 * A stray control character once sat inside a regex literal in this very file:
 * `/card\s*:/` had been written to disk as `/\x08card\s*:/`, so it matched
 * nothing and the chain-config test reported all eight chains as broken. The
 * character is invisible in an editor and in a diff; only `cat -A` showed it.
 *
 * Same family as the missing-backslash bug above — a regex that looks right and
 * cannot match — so it gets the same cheap guard, across every source file
 * rather than just this one.
 */
test('no source file contains a stray control character', () => {
  const roots = ['services', 'lib', 'test'];
  const offenders = [];

  for (const dir of roots) {
    let entries;
    try { entries = fs.readdirSync(path.join(__dirname, '..', dir)); } catch { continue; }
    for (const file of entries.filter((f) => f.endsWith('.js'))) {
      const full = path.join(__dirname, '..', dir, file);
      const text = fs.readFileSync(full, 'utf8');
      for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        /* Tab, newline and carriage return are the only legitimate ones. */
        if (code < 32 && code !== 9 && code !== 10 && code !== 13) {
          offenders.push(`${dir}/${file} @${i}: U+${code.toString(16).padStart(4, '0')}`);
        }
      }
    }
  }

  assert.deepEqual(offenders, [], `control characters found:\n  ${offenders.join('\n  ')}`);
});
