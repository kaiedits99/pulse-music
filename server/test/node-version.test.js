// The Node.js version is pinned on purpose, in three places that must agree:
// `package.json > engines.node` (what npm and Render read), `.node-version` (which Render's
// toolchain prefers over package.json) and `render.yaml` (the Blueprint's NODE_VERSION).
//
// Why this is worth a test: better-sqlite3 is a native module. Its publisher ships prebuilt
// binaries for specific Node versions and otherwise falls back to compiling from source, which
// fails once V8's C++ API has moved on. A range with no upper bound — the ">=20" this project
// used to carry — always resolves to the newest Node release, so a deploy on 2026-10-02 picked
// Node 26 and `npm ci` died inside node-gyp. These tests fail if the pin is loosened, dropped,
// or left inconsistent between the three files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { root } from './helpers.js';

const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const pkg = JSON.parse(read('package.json'));
const pinnedMajor = () => /^(\d+)\.x$/.exec(String(pkg.engines?.node ?? ''))?.[1];

test('engines.node pins a single Node major instead of allowing any newer release', () => {
  const range = String(pkg.engines?.node ?? '');
  assert.match(
    range,
    /^\d+\.x$/,
    `engines.node must be a single pinned major such as "24.x" (got "${range}"); a range without an ` +
      'upper bound resolves to the newest Node release and breaks the native database driver'
  );
});

test('.node-version and render.yaml NODE_VERSION agree with engines.node', () => {
  const pinned = pinnedMajor();
  assert.ok(pinned, 'engines.node must be pinned before it can be compared');
  assert.equal(
    read('.node-version').trim(),
    pinned,
    '.node-version must name the same Node major as engines.node'
  );
  const fromRender = /key: NODE_VERSION\s*\n\s*value: "?(\d+)/.exec(read('render.yaml'))?.[1];
  assert.equal(
    fromRender,
    pinned,
    'render.yaml NODE_VERSION must name the same Node major as engines.node'
  );
});

test('the pinned Node major is one better-sqlite3 says it supports', () => {
  const pinned = pinnedMajor();
  const entry = JSON.parse(read('package-lock.json')).packages?.['node_modules/better-sqlite3'] ?? {};
  const declared = String(entry.engines?.node ?? '');
  const supported = declared.split('||').map((part) => part.trim());
  assert.ok(
    supported.includes(`${pinned}.x`),
    `better-sqlite3 ${entry.version} does not list Node ${pinned}.x as supported (it says "${declared}"), ` +
      'so a fresh install would compile it from source instead of using a prebuilt binary'
  );
});
