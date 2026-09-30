import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  createSnapshot,
  restoreSnapshot,
  runRestoreDrill,
  RestoreDrillError,
} from './restore-drill.mjs';

const here = dirname(fileURLToPath(import.meta.url));

const SAMPLE = {
  'a.txt': 'hello world\n',
  'nested/b.json': '{"k":1}\n',
  'empty': '',
};

test('normal path: snapshot round-trips byte-for-byte', () => {
  const restored = restoreSnapshot(createSnapshot(SAMPLE));
  assert.deepEqual(restored, SAMPLE);
});

test('normal path: runRestoreDrill reports file count, bytes and checksum', () => {
  const report = runRestoreDrill(SAMPLE);
  assert.equal(report.ok, true);
  assert.equal(report.fileCount, 3);
  assert.equal(report.bytes, Buffer.byteLength(SAMPLE['a.txt']) + Buffer.byteLength(SAMPLE['nested/b.json']));
  assert.match(report.checksum, /^[0-9a-f]{64}$/);
});

test('normal path: drills the repo\'s own critical config files', () => {
  const files = {};
  for (const rel of ['codecov.yml', 'Makefile']) {
    files[rel] = readFileSync(resolve(here, '..', rel), 'utf8');
  }
  assert.equal(runRestoreDrill(files).ok, true);
});

test('edge case: empty backup is valid', () => {
  assert.deepEqual(restoreSnapshot(createSnapshot({})), {});
});

test('failure: truncated snapshot is rejected', () => {
  const snap = createSnapshot(SAMPLE);
  assert.throws(() => restoreSnapshot(snap.slice(0, snap.length - 10)), RestoreDrillError);
});

test('failure: tampered file content is detected via checksum', () => {
  const parsed = JSON.parse(createSnapshot(SAMPLE));
  parsed.entries[0].content += 'x'; // change content, leave stored sha256
  assert.throws(() => restoreSnapshot(JSON.stringify(parsed)), /checksum mismatch/);
});

test('failure: dropping a file is detected via the top-level digest', () => {
  const parsed = JSON.parse(createSnapshot(SAMPLE));
  parsed.entries.pop();
  assert.throws(() => restoreSnapshot(JSON.stringify(parsed)), /digest mismatch/);
});

test('failure: non-string content is rejected at snapshot time', () => {
  assert.throws(() => createSnapshot({ x: 123 }), RestoreDrillError);
});
