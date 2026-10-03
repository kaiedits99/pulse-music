// Guards the whole app against a class of bug that bundlers do NOT catch and that
// takes every screen down at once: using a name that is never imported or declared.
//
// A missing import is invisible to `vite build` — the bundler leaves the identifier as
// a free variable, and the browser throws `ReferenceError` the moment that component
// renders. One of these (PlayerContext calling isLinkedTrack without importing it)
// crashed the entire React tree, so the site showed nothing but the error boundary.
// This test fails before that can happen again.
//
// The rule is deliberately narrow so it stays quiet on correct code: flag a name that
// some client module EXPORTS, is CALLED as `name(...)` in another file, and is neither
// imported nor declared in that file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.dirname(fileURLToPath(import.meta.url));

function walk(dir = SRC, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(js|jsx)$/.test(entry.name) && !/\.test\.(js|jsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/**
 * Replace comments and string/template contents with spaces, keeping every character
 * position (and therefore all surrounding code) intact. A single pass is needed: doing
 * comments first would eat the "//" inside a URL string, and doing strings first would
 * trip over an apostrophe in a comment. Unterminated quotes end at the newline so a
 * stray apostrophe in JSX text can never swallow the rest of the file.
 */
function blankNoise(code) {
  let out = '';
  let i = 0;
  const n = code.length;
  while (i < n) {
    const c = code[i];
    const next = code[i + 1];
    if (c === '/' && next === '/') {
      while (i < n && code[i] !== '\n') { out += ' '; i++; }
      continue;
    }
    if (c === '/' && next === '*') {
      while (i < n && !(code[i] === '*' && code[i + 1] === '/')) { out += code[i] === '\n' ? '\n' : ' '; i++; }
      out += '  '; i += 2;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      out += ' '; i++;
      while (i < n) {
        if (code[i] === '\\') { out += ' '; i += 2; continue; }
        if (code[i] === quote) { out += ' '; i++; break; }
        if (quote !== '`' && code[i] === '\n') break; // unterminated: end at the line
        out += code[i] === '\n' && quote === '`' ? '\n' : ' ';
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** Every name exported by any client module. */
function exportedNames() {
  const names = new Set();
  for (const file of walk()) {
    const code = blankNoise(fs.readFileSync(file, 'utf8'));
    for (const m of code.matchAll(/export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)) {
      names.add(m[1]);
    }
    for (const m of code.matchAll(/export\s*\{([^}]*)\}/g)) { // export { a, b as c }
      for (const part of m[1].split(',')) {
        const alias = part.trim().split(/\s+as\s+/);
        if (alias[alias.length - 1].trim()) names.add(alias[alias.length - 1].trim());
      }
    }
  }
  return names;
}

/** Names the file brings into scope: imports, declarations, params, catch bindings. */
function boundNames(code) {
  const bound = new Set();
  for (const re of [
    /\bimport\s+([^;]+?)\s+from\b/g,                  // import x / { a, b as c } / * as ns
    /\b(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g,
  ]) {
    for (const m of code.matchAll(re)) {
      for (const n of m[1].matchAll(/[A-Za-z_$][\w$]*/g)) bound.add(n[0]);
    }
  }
  for (const re of [
    /\{([^{}]*)\}\s*(?:=[^=]|\)|=>)/g,                 // destructured bindings
    /\(([^()]*)\)\s*(?:=>|\{)/g,                       // parameters
    /(?:^|[\s(,])([A-Za-z_$][\w$]*)\s*=>/g,            // single arrow parameter
    /catch\s*\(\s*([A-Za-z_$][\w$]*)/g,
    /\[([^[\]]*)\]\s*=/g,                              // array destructuring
  ]) {
    for (const m of code.matchAll(re)) {
      for (const n of m[1].matchAll(/[A-Za-z_$][\w$]*/g)) bound.add(n[0]);
    }
  }
  return bound;
}

const strip = blankNoise;

test('no client module calls a name it never imported or declared', () => {
  const exported = exportedNames();
  const problems = [];

  for (const file of walk()) {
    const code = strip(fs.readFileSync(file, 'utf8'));
    const bound = boundNames(code);
    const called = new Set();
    for (const m of code.matchAll(/(?:^|[^\w.$])([A-Za-z_$][\w$]*)\s*\(/g)) called.add(m[1]);

    for (const name of called) {
      if (bound.has(name) || !exported.has(name)) continue;
      problems.push(`${path.relative(SRC, file)} calls ${name}() without importing it`);
    }
  }

  assert.deepEqual(problems, [], `Missing imports crash the app at runtime:\n${problems.join('\n')}`);
});
