/**
 * Frida names read like database entries ("Chicken, breast, flesh and skin, raw"). This turns them into what a person would say
 * ("Chicken breast with skin, raw") without touching the dataset itself, so its attribution and ids stay as published.
 */

/** How the food was prepared; kept at the end of the name. */
const STATES = new Set(['raw', 'boiled', 'fried', 'roasted', 'grilled', 'baked', 'steamed', 'stewed', 'cooked', 'smoked', 'dried', 'canned', 'frozen', 'pickled', 'salted', 'fresh']);

/** Cuts and parts that belong to the animal before them: "Chicken, breast" is "Chicken breast". */
const PARTS = new Set(['breast', 'leg', 'thigh', 'drumstick', 'wing', 'fillet', 'liver', 'heart', 'mince', 'minced', 'loin', 'shoulder', 'neck', 'belly', 'tenderloin', 'steak', 'rib', 'ribs']);

const WORDS: [RegExp, string][] = [
  [/\bfidm\.?/gi, 'fat in dry matter'],
  [/\bkonventional\b/gi, 'conventional'],
  [/\bdanish\b/gi, 'Danish'],
  [/\bmed\b/gi, 'with'],
  [/\s*%\s*/g, '% '],
];

export function friendlyFoodName(raw: string): string {
  let parts = raw
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return raw;
  parts = parts.map((p) => (/^flesh and skin$/i.test(p) ? 'with skin' : /^flesh$/i.test(p) ? '' : /^flesh without skin$/i.test(p) ? 'without skin' : p)).filter(Boolean);
  // "Chicken, breast, ..." -> "Chicken breast, ..."
  if (parts.length > 1 && PARTS.has(parts[1]!.toLowerCase())) parts.splice(0, 2, `${parts[0]} ${parts[1]!.toLowerCase()}`);
  // "with skin" reads as part of the name, not as a comma item.
  const joined: string[] = [];
  for (const p of parts) {
    if (/^(with|without) skin$/i.test(p) && joined.length > 0) joined[0] = `${joined[0]} ${p.toLowerCase()}`;
    else joined.push(p);
  }
  // The state (raw, boiled...) goes last.
  const state = joined.filter((p) => STATES.has(p.toLowerCase()));
  const rest = joined.filter((p) => !STATES.has(p.toLowerCase()));
  let name = [...rest, ...state].join(', ');
  for (const [re, to] of WORDS) name = name.replace(re, to);
  name = name.replace(/%\s+(?=[,)]|$)/g, '%').replace(/\s{2,}/g, ' ').replace(/\.$/, '').trim();
  return name.charAt(0).toUpperCase() + name.slice(1);
}
