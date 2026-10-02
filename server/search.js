// Catalog search helpers shared by the REST routes and the database layer.
//
// Matching is deliberately forgiving, the way people actually type:
//   * case-insensitive:                 "AFROBEATS"  finds  "Afrobeats"
//   * accent-insensitive:               "zaneta"     finds  "Żaneta", "beyonce" finds "Beyoncé"
//   * punctuation/spacing-insensitive:  "kpop"       finds  "K-Pop",  "hip hop" finds "Hip-Hop"
//
// A query is split on whitespace and EVERY term has to match at least one of the
// searched columns (title, artist or genre for tracks), so "luna pop" narrows
// instead of widening. `instr()` is used instead of LIKE, so there are no
// wildcard characters to escape — user input can never act as a pattern.

// Letters that Unicode decomposition does not reduce to a base letter.
const SPECIAL_LETTERS = { 'ł': 'l', 'ø': 'o', 'đ': 'd', 'ð': 'd', 'þ': 'th', 'ß': 'ss', 'æ': 'ae', 'œ': 'oe', 'ı': 'i' };

/** Lower-case, strip accents and drop everything that is not a letter or digit. */
export function foldText(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .normalize('NFD')
    .toLowerCase()
    .replace(/\p{M}+/gu, '')
    .replace(/[łøđðþßæœı]/g, (ch) => SPECIAL_LETTERS[ch])
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

const MAX_QUERY_LENGTH = 120;
const MAX_TERMS = 8;

/** The folded, non-empty terms of a free-text query. */
export function searchTerms(query) {
  return String(query ?? '')
    .slice(0, MAX_QUERY_LENGTH)
    .split(/\s+/)
    .map(foldText)
    .filter(Boolean)
    .slice(0, MAX_TERMS);
}

/**
 * SQL fragment + positional params that keep rows where every term of `query`
 * matches at least one of `columns`. `sql` is '' when the query has no usable
 * terms, so callers can skip adding a WHERE condition.
 * Relies on the `pulse_fold()` SQL function registered in db.js.
 */
export function searchClause(columns, query) {
  const sql = [];
  const params = [];
  for (const term of searchTerms(query)) {
    sql.push(`(${columns.map((column) => `instr(pulse_fold(${column}), ?) > 0`).join(' OR ')})`);
    for (let i = 0; i < columns.length; i += 1) params.push(term);
  }
  return { sql: sql.join(' AND '), params };
}
