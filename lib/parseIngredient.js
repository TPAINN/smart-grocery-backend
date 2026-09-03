/*
 * Turns one free-text ingredient line into {quantity, unit, name, notes}.
 *
 * Recipe sites write the same measurement a dozen ways: "2 κ.σ.", "2 κουταλιές
 * της σούπας" and "2 κουτ. σούπας" are one unit, and "1/2", "½" and "μισό" are
 * one quantity. Matching a scraped line against a supermarket product needs the
 * NAME on its own, without the amount glued to the front or the preparation
 * note trailing behind.
 *
 * Deliberately not a general parser: it recognises the forms Greek recipe sites
 * actually emit and leaves anything else in `name` untouched, because a wrong
 * split is worse than no split — an unmatched ingredient costs one blank row,
 * while a mis-split one silently matches the wrong product and shows the user a
 * wrong price.
 */

/*
 * Greek text and \b do not mix: \b is defined over [A-Za-z0-9_], so it fires
 * BETWEEN a Latin letter and a Greek one and never between two Greek letters.
 * Anchoring a Greek keyword with \b either fails silently or matches mid-word,
 * so every boundary here is an explicit "next character is not a letter" check.
 */
const LETTER = /[A-Za-zΑ-Ωα-ωΆ-ώϊϋΐΰ]/;

/* Canonical unit -> every spelling seen in the wild, longest first so that
   "κουταλιά της σούπας" is never truncated by the shorter "κουταλιά". */
const UNITS = [
  ['tbsp',  ['κουταλιές της σούπας', 'κουταλιά της σούπας', 'κουταλιές σούπας', 'κουταλιά σούπας',
             'κουτ. σούπας', 'κ. σούπας', 'κ.σ.', 'κ.σ', 'κσ']],
  ['tsp',   ['κουταλάκια του γλυκού', 'κουταλάκι του γλυκού', 'κουταλάκια γλυκού', 'κουταλάκι γλυκού',
             'κουτ. γλυκού', 'κ. γλυκού', 'κ.γ.', 'κ.γ', 'κγ']],
  ['cup',   ['φλιτζάνια τσαγιού', 'φλιτζάνι τσαγιού', 'φλιτζάνια', 'φλιτζάνι', 'φλ.', 'κούπες', 'κούπα']],
  ['g',     ['γραμμάρια', 'γραμμ.', 'γραμ.', 'γρ.', 'γρ', 'gr', 'g']],
  ['kg',    ['κιλά', 'κιλό', 'kg']],
  ['ml',    ['χιλιοστόλιτρα', 'ml', 'μλ']],
  ['l',     ['λίτρα', 'λίτρο', 'lt', 'l']],
  ['clove', ['σκελίδες', 'σκελίδα']],
  ['bunch', ['ματσάκια', 'ματσάκι', 'μάτσα', 'μάτσο']],
  ['pinch', ['πρέζες', 'πρέζα']],
  ['can',   ['κονσέρβες', 'κονσέρβα', 'κουτάκια', 'κουτάκι']],
  ['pack',  ['συσκευασίες', 'συσκευασία', 'πακέτα', 'πακέτο']],
  ['slice', ['φέτες', 'φέτα']],
  ['pc',    ['τεμάχια', 'τεμάχιο', 'τεμ.', 'τεμ']],
];

/* Spelled-out amounts. Greek recipes mix these with digits freely. */
const WORD_NUMBERS = {
  'μισό': 0.5, 'μισή': 0.5, 'μιάμιση': 1.5, 'ενάμισι': 1.5,
  'ένα': 1, 'ένας': 1, 'μία': 1, 'μια': 1,
  'δύο': 2, 'δυο': 2, 'τρία': 3, 'τρεις': 3, 'τέσσερα': 4, 'τέσσερις': 4,
  'πέντε': 5, 'έξι': 6, 'επτά': 7, 'εφτά': 7, 'οκτώ': 8, 'οχτώ': 8,
  'εννέα': 9, 'εννιά': 9, 'δέκα': 10, 'δώδεκα': 12,
};

const VULGAR = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3 };

/* Two decimals is plenty for a shopping quantity, and it keeps 1/3 from
   reaching the UI as 0.3333333333333333. */
const round2 = (n) => Math.round(n * 100) / 100;

function parseQuantity(text) {
  const t = text.trim();

  /* Ranges ("2-3 πατάτες") and "ή" alternatives take the lower bound: buying
     the smaller amount and topping up beats over-buying on every line. */
  const range = /^(\d+(?:[.,]\d+)?)\s*(?:-|–|έως|ως|ή)\s*(\d+(?:[.,]\d+)?)/.exec(t);
  if (range) return { value: parseFloat(range[1].replace(',', '.')), rest: t.slice(range[0].length) };

  /* "1½" and "1 ½" — a whole part followed by a vulgar fraction. */
  const mixedVulgar = /^(\d+)\s*([½¼¾⅓⅔])/.exec(t);
  if (mixedVulgar) {
    return {
      value: round2(parseInt(mixedVulgar[1], 10) + VULGAR[mixedVulgar[2]]),
      rest: t.slice(mixedVulgar[0].length),
    };
  }

  /* "1 1/2" — a mixed number written with a slash. Checked before the bare
     fraction below so the whole part is not dropped on the floor. */
  const mixedSlash = /^(\d+)\s+(\d+)\s*\/\s*(\d+)/.exec(t);
  if (mixedSlash) {
    const d = parseInt(mixedSlash[3], 10);
    if (d) {
      return {
        value: round2(parseInt(mixedSlash[1], 10) + parseInt(mixedSlash[2], 10) / d),
        rest: t.slice(mixedSlash[0].length),
      };
    }
  }

  const fraction = /^(\d+)\s*\/\s*(\d+)/.exec(t);
  if (fraction) {
    const d = parseInt(fraction[2], 10);
    if (d) return { value: round2(parseInt(fraction[1], 10) / d), rest: t.slice(fraction[0].length) };
  }

  const vulgar = /^([½¼¾⅓⅔])/.exec(t);
  /* round2 matters here as much as in the mixed cases: ⅓ is 0.333... and
     would otherwise reach the UI at full float width. */
  if (vulgar) return { value: round2(VULGAR[vulgar[1]]), rest: t.slice(vulgar[0].length) };

  /* Plain number. Greek recipes use the comma as the decimal separator. */
  const num = /^(\d+(?:[.,]\d+)?)/.exec(t);
  if (num) return { value: parseFloat(num[1].replace(',', '.')), rest: t.slice(num[0].length) };

  /* Spelled-out amount, longest first so "μιάμιση" is not read as "μια". */
  const lower = t.toLowerCase();
  for (const word of Object.keys(WORD_NUMBERS).sort((a, b) => b.length - a.length)) {
    if (!lower.startsWith(word)) continue;
    const after = t[word.length];
    if (after && LETTER.test(after)) continue;   // matched inside a longer word
    return { value: WORD_NUMBERS[word], rest: t.slice(word.length) };
  }

  return { value: null, rest: t };
}

function parseUnit(text) {
  const t = text.replace(/^[\s.]+/, '');
  const lower = t.toLowerCase();

  for (const [canonical, spellings] of UNITS) {
    for (const spelling of spellings) {
      if (!lower.startsWith(spelling)) continue;
      /* A unit must not be the head of a longer word: "γρ" opens "γραβιέρα",
         and "l" opens half the Latin-script ingredients on the page. */
      const after = t[spelling.length];
      if (after && LETTER.test(after)) continue;
      return { unit: canonical, rest: t.slice(spelling.length) };
    }
  }
  return { unit: null, rest: t };
}

/*
 * Preparation notes: everything in brackets, plus a trailing clause after a
 * comma. "κρεμμύδι, ψιλοκομμένο" is one ingredient with a note, not two.
 */
function splitNotes(text) {
  const notes = [];
  let name = text.replace(/[([]([^)\]]*)[)\]]/g, (_, inner) => {
    const v = inner.trim();
    if (v) notes.push(v);
    return ' ';
  });

  const comma = name.indexOf(',');
  if (comma !== -1) {
    const tail = name.slice(comma + 1).trim();
    if (tail) notes.push(tail);
    name = name.slice(0, comma);
  }

  return { name: name.replace(/\s+/g, ' ').trim(), notes: notes.join(', ') };
}

/*
 * `quantity` and `unit` are null when the line does not state them — "αλάτι"
 * has no amount, and inventing 1 would put a phantom number in the UI and skew
 * any cost built on top of it.
 */
function parseIngredient(raw) {
  const line = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!line) return { quantity: null, unit: null, name: '', notes: '', raw: '' };

  /* Leading list bullets survive plenty of scrapes. */
  const cleaned = line.replace(/^[-–—•*·]\s*/, '');

  const q = parseQuantity(cleaned);
  /* A unit with no quantity in front of it is almost always a false positive:
     "Φέτα Δωδώνη" opens with the `slice` spelling. */
  const u = q.value === null ? { unit: null, rest: q.rest } : parseUnit(q.rest);

  const { name, notes } = splitNotes(u.rest);

  /* Greek recipes glue an article onto the ingredient after the unit:
     "2 κ.σ. από ελαιόλαδο", "1 φλιτζάνι με αλεύρι". */
  const stripped = name.replace(/^(?:από|με|του|της|το|τα|οι|ο|η)\s+/i, '').trim();

  return { quantity: q.value, unit: u.unit, name: stripped || name, notes, raw: line };
}

module.exports = { parseIngredient, UNITS, WORD_NUMBERS };
