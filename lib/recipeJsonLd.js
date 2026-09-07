/*
 * Reading the schema.org Recipe block off a recipe page.
 *
 * This used to be four lines inside a page.evaluate: JSON.parse each ld+json
 * script, catch and drop failures, look for @type === 'Recipe'. Each of those
 * shortcuts costs a whole site.
 *
 *   · A silent catch. Two of the five sites added on 2026-09-07 emit a
 *     description containing a raw newline inside a JSON string. That is
 *     invalid JSON, every parser rejects it, and the catch turned "one stray
 *     character in their markup" into "this site has no recipes" with nothing
 *     in the log to say so.
 *   · An exact @type match. Sites publish the recipe as a bare object, inside a
 *     top-level array, inside an @graph, or with @type as an array of types.
 *   · `s.text || s` over recipeInstructions. A HowToSection has no `text`, so
 *     that expression returns the section object and stringifies it into the
 *     literal "[object Object]" — long enough to survive the length filter and
 *     be saved as a cooking step.
 */

/**
 * Escape control characters that appear INSIDE string literals.
 *
 * Newlines between tokens are legal JSON formatting and must be left alone;
 * only the ones inside a string are illegal. Escaping both would break every
 * pretty-printed block on the web, so this tracks string state as it walks.
 *
 * @param {string} text
 * @returns {string}
 */
function repairJsonLd(text) {
  const BACKSLASH = String.fromCharCode(92);
  let out = '';
  let inString = false;
  let escaped = false;
  for (const ch of String(text)) {
    if (escaped)             { out += ch; escaped = false; continue; }
    if (ch === BACKSLASH)    { out += ch; escaped = true;  continue; }
    if (ch === '"')          { out += ch; inString = !inString; continue; }
    if (inString && ch < ' ') {
      const code = ch.charCodeAt(0);
      const named = code === 10 ? 'n' : code === 13 ? 'r' : code === 9 ? 't' : null;
      out += named ? BACKSLASH + named : ' ';
      continue;
    }
    out += ch;
  }
  return out;
}

const isType = (node, type) => {
  const t = node && node['@type'];
  return Array.isArray(t) ? t.includes(type) : t === type;
};

/**
 * @param {string[]} texts  contents of every <script type="application/ld+json">
 * @returns {object|null}   the Recipe node, or null if the page has none
 */
function findRecipe(texts) {
  const nodes = [];
  for (const text of texts || []) {
    let parsed;
    try { parsed = JSON.parse(text); }
    catch { try { parsed = JSON.parse(repairJsonLd(text)); } catch { continue; } }
    const top = Array.isArray(parsed) ? parsed : [parsed];
    nodes.push(...top);
    for (const n of top) if (Array.isArray(n && n['@graph'])) nodes.push(...n['@graph']);
  }
  return nodes.find(n => isType(n, 'Recipe')) || null;
}

const strip = s => String(s ?? '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();

/**
 * Flatten recipeInstructions to plain step strings, whatever shape a site used.
 * @param {*} instructions
 * @returns {string[]}
 */
function recipeSteps(instructions) {
  const out = [];
  const walk = (node) => {
    if (node == null) return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (typeof node === 'string') { const s = strip(node); if (s) out.push(s); return; }
    if (Array.isArray(node.itemListElement)) { node.itemListElement.forEach(walk); return; }
    if (node.text != null) { const s = strip(node.text); if (s) out.push(s); return; }
    if (node.name != null) { const s = strip(node.name); if (s) out.push(s); }
  };
  walk(instructions);
  return out;
}

/*
 * Which picture to show.
 *
 * The recipe's own image, not the page's og:image. og:image is a social
 * preview and pages get it wrong: on two Argiro recipes it is the literal
 * string "http://8624" — a WordPress attachment id where a URL belongs — and
 * preferring it stored both recipes pointing at a host that does not exist,
 * while the JSON-LD beside it held the correct file all along.
 *
 * And nothing that is not an https URL is a picture. The image proxy refuses
 * anything else anyway, so a value like that only ever produces a blank card.
 *
 * @param {object} recipe   the Recipe node
 * @param {string} [ogImage] the page's og:image, used only as a fallback
 * @returns {string} an https URL, or '' when neither yields one
 */
function recipeImage(recipe, ogImage) {
  const first = (v) => {
    if (typeof v === 'string') return v;
    if (Array.isArray(v)) { for (const x of v) { const s = first(x); if (s) return s; } return ''; }
    if (v && typeof v === 'object') return first(v.url || v.contentUrl || '');
    return '';
  };
  const usable = (s) => {
    try { return new URL(String(s)).protocol === 'https:' ? String(s) : ''; }
    catch { return ''; }
  };
  return usable(first(recipe && recipe.image)) || usable(ogImage) || '';
}

module.exports = { repairJsonLd, findRecipe, recipeSteps, recipeImage };
