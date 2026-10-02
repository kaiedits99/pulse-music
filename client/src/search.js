// Client-side twin of server/search.js — the two MUST behave identically, so the artists and
// albums matched in the browser agree with the tracks matched by GET /api/songs?q=.
// (server/test/search.test.js checks that they stay in step.)
//
// Matching ignores case, accents and punctuation ("beyonce" finds "Beyoncé", "kpop" finds "K-Pop")
// and every whitespace-separated word has to match at least one searched field.

const SPECIAL_LETTERS = { 'ł': 'l', 'ø': 'o', 'đ': 'd', 'ð': 'd', 'þ': 'th', 'ß': 'ss', 'æ': 'ae', 'œ': 'oe', 'ı': 'i' };

export function foldText(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .normalize('NFD')
    .toLowerCase()
    .replace(/\p{M}+/gu, '')
    .replace(/[łøđðþßæœı]/g, (ch) => SPECIAL_LETTERS[ch])
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

export function searchTerms(query) {
  return String(query ?? '')
    .slice(0, 120)
    .split(/\s+/)
    .map(foldText)
    .filter(Boolean)
    .slice(0, 8);
}

/** True when every word of `query` is found in at least one of `fields`. A blank query matches nothing. */
export function matchesQuery(query, fields) {
  const terms = searchTerms(query);
  if (!terms.length) return false;
  const folded = fields.map(foldText);
  return terms.every((term) => folded.some((field) => field.includes(term)));
}
