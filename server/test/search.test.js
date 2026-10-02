import { test } from 'node:test';
import assert from 'node:assert/strict';
import { foldText, searchTerms, searchClause } from '../search.js';
import * as browser from '../../client/src/search.js';

test('foldText ignores case, accents and punctuation', () => {
  assert.equal(foldText('Żaneta Ńowak'), 'zanetanowak'); // accents fold, spacing and punctuation drop out
  assert.equal(foldText('Łukasz Ørsted'), 'lukaszorsted');
  assert.equal(foldText('Beyoncé'), 'beyonce');
  assert.equal(foldText('K-Pop'), 'kpop');
  assert.equal(foldText('R&B / Soul'), 'rbsoul');
  assert.equal(foldText('Hip-Hop'), 'hiphop');
  assert.equal(foldText('İstanbul'), 'istanbul');
  assert.equal(foldText('東京 2020'), '東京2020');
  assert.equal(foldText(null), '');
  assert.equal(foldText(undefined), '');
  assert.equal(foldText(42), '42');
});

test('searchTerms splits on whitespace and drops symbol-only words', () => {
  assert.deepEqual(searchTerms('  Luna   Ray '), ['luna', 'ray']);
  assert.deepEqual(searchTerms('luna & ray'), ['luna', 'ray']);
  assert.deepEqual(searchTerms('%_ -- &&'), []);
  assert.deepEqual(searchTerms(''), []);
  assert.deepEqual(searchTerms(undefined), []);
  assert.equal(searchTerms('a b c d e f g h i j k l').length, 8, 'capped so a pasted paragraph cannot build a huge query');
});

test('searchClause ANDs the terms and ORs the columns, using bound parameters only', () => {
  const { sql, params } = searchClause(['s.title', 'a.name', 's.genre'], "luna pop'; DROP TABLE songs;--");
  assert.equal(sql.split(' AND ').length, 5); // luna, pop, drop, table, songs
  assert.equal(params.length, 15); // 5 terms × 3 columns
  assert.equal(sql.match(/\?/g).length, params.length, 'one placeholder per bound parameter');
  assert.ok(!sql.includes('DROP'), 'user text never reaches the SQL string');
  assert.deepEqual(params.slice(0, 3), ['luna', 'luna', 'luna']);
  assert.deepEqual(searchClause(['s.title'], '   '), { sql: '', params: [] });
});

test('the browser copy of the matcher behaves exactly like the server one', () => {
  // The Search page matches artists and albums in the browser while tracks are matched by the
  // API — if the two ever disagreed, the same query would find different things in each place.
  const samples = [
    '', '   ', 'Żaneta', 'zaneta', 'K-Pop', 'kpop', 'Beyoncé', 'Łukasz Ørsted', 'Æsir & Straße', 'İstanbul',
    'Sigur Rós', 'AC/DC', '東京 2020', 'Ελληνικά', 'Привет мир', '🎵 lo-fi 🎵', 'a  b\tc\nd', '%_ --',
    "'; DROP TABLE songs;--", 'x'.repeat(300), 'one two three four five six seven eight nine ten'
  ];
  for (const sample of samples) {
    assert.equal(browser.foldText(sample), foldText(sample), `foldText(${JSON.stringify(sample)})`);
    assert.deepEqual(browser.searchTerms(sample), searchTerms(sample), `searchTerms(${JSON.stringify(sample)})`);
  }
  assert.equal(browser.foldText(null), foldText(null));
  assert.equal(browser.foldText(undefined), foldText(undefined));
});

test('matchesQuery needs every word to hit one of the fields, and a blank query matches nothing', () => {
  assert.equal(browser.matchesQuery('luna pop', ['Luna Ray', 'Pop']), true);
  assert.equal(browser.matchesQuery('luna jazz', ['Luna Ray', 'Pop']), false);
  assert.equal(browser.matchesQuery('zaneta', ['Żaneta', 'K-Pop']), true);
  assert.equal(browser.matchesQuery('kpop', ['Żaneta', 'K-Pop']), true);
  assert.equal(browser.matchesQuery('ray', ['Luna Ray', null, undefined]), true);
  assert.equal(browser.matchesQuery('', ['anything']), false);
  assert.equal(browser.matchesQuery('%', ['100%']), false); // symbols alone are not a query
});
