const normalize = (text) => text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const PET_MARKERS = /(^|\s)(γατα|γατος|γατων|γατας|σκυλος|σκυλου|σκυλων|κατοικιδι|ζωοτρ|petshop|pet shop|\bcat\b|\bdog\b)/;
const isPetQuery = (q) => /(γατα|γατ |σκυλ|κατοικιδι|ζωοτρ|\bcat\b|\bdog\b)/.test(q);

function isIrrelevantProduct(name, q, qEsc) {
  if (!isPetQuery(q) && PET_MARKERS.test(name)) return true;
  const flavorIdx = name.search(/(γευση|αρωμα|με γευση|με αρωμα)/);
  if (flavorIdx > 0) {
    const beforeDescriptor = name.substring(0, flavorIdx);
    if (!new RegExp(`(^|\\s)${qEsc}`).test(beforeDescriptor)) return true;
  }
  return false;
}

function scoreMatch(productName, query) {
  const name = normalize(productName);
  const q = normalize(query);
  const qEsc = escapeRegex(q);
  let score = 0;
  if (name === q) score = 100;
  else if (name.startsWith(q + ' ')) score = 90;
  else if (new RegExp(`(^|\\s)${qEsc}(\\s|$)`).test(name)) score = 80;
  else if (new RegExp(`(^|\\s)${qEsc}`).test(name)) score = 60;
  else if (name.includes(q)) score = 20;
  if (score === 0) return 0;
  if (!isPetQuery(q) && PET_MARKERS.test(name)) return Math.round(score * 0.1);
  const flavorIdx = name.search(/(γευση|αρωμα|με γευση|με αρωμα)/);
  if (flavorIdx > 0) {
    const beforeDescriptor = name.substring(0, flavorIdx);
    const queryInMainPart = new RegExp(`(^|\\s)${qEsc}`).test(beforeDescriptor);
    if (!queryInMainPart) return Math.round(score * 0.3);
  }
  return score;
}

function scoreMultiWord(productName, terms) {
  let totalScore = 0;
  const name = normalize(productName);
  for (const term of terms) {
    const s = scoreMatch(productName, term);
    if (s === 0) return 0;
    totalScore += s;
  }
  const q = terms[0];
  const qEsc = escapeRegex(q);
  if (!isIrrelevantProduct(name, q, qEsc)) {
    const queryStr = terms.map(escapeRegex).join('.*');
    if (new RegExp(queryStr).test(name)) totalScore += 10;
    const firstTermEsc = escapeRegex(normalize(terms[0]));
    if (new RegExp(`^${firstTermEsc}`).test(name)) totalScore += 20;
  }
  return totalScore;
}

function test(query, products) {
  const terms = normalize(query).split(/\s+/).filter(t => t.length > 1);
  console.log(`\n=== Query: "${query}" ===`);
  products
    .map(p => ({ name: p, score: scoreMultiWord(p, terms) }))
    .sort((a, b) => b.score - a.score)
    .forEach(r => {
      const shown = r.score > 10 ? '✅' : '❌';
      console.log(`${shown} ${String(r.score).padStart(4)}  ${r.name}`);
    });
}

test('κοτόπουλο', [
  'Κοτόπουλο Φρέσκο 1kg',
  'Κοτόπουλο Μπούτια Φρέσκα',
  'Κοτόπουλο Στήθος Φιλέτο',
  'Σουβλάκια Κοτόπουλου',
  'Ζωμός Κοτόπουλου',
  'Μπιφτέκια Κοτόπουλου',
  'Τροφή Γάτας με Γεύση Κοτόπουλου',
  'Τροφή Σκύλου Κοτόπουλο & Ρύζι',
  'Purina Cat με Γεύση Κοτόπουλου',
  'Κοτοπουλόσουπα',
]);

test('γαλα', [
  'Γάλα Φρέσκο Πλήρες 1lt',
  'Γάλα Εβαπορέ',
  'Γαλακτομπούρεκο',
  'Τροφή Γάτας Γαλακτος',
  'Σοκολάτα Γάλακτος',
  'Ρόφημα Γάλακτος',
]);

test('σκυλος τροφη', [
  'Τροφή Σκύλου Κοτόπουλο',
  'Τροφή Σκύλου Βοδινό',
  'Κοτόπουλο Φρέσκο',
  'Γάλα Φρέσκο',
]);
