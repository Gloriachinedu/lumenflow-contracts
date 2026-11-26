import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  createSnapshot,
  restoreSnapshot,
  runRestoreDrill,
  runRestoreDrillFromLatestBackup,
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

test('normal path: runRestoreDrill measures RTO as a non-negative number', () => {
  const report = runRestoreDrill(SAMPLE);
  assert.equal(typeof report.rtoSeconds, 'number');
  assert.ok(Number.isFinite(report.rtoSeconds));
  assert.ok(report.rtoSeconds >= 0);
});

test('normal path: runRestoreDrill report has the expected JSON shape', () => {
  const report = runRestoreDrill(SAMPLE);
  assert.deepEqual(Object.keys(report).sort(), [
    'bytes',
    'checksum',
    'fileCount',
    'ok',
    'rtoSeconds',
    'smokeTests',
  ]);
  assert.equal(typeof report.ok, 'boolean');
  assert.equal(typeof report.fileCount, 'number');
  assert.equal(typeof report.bytes, 'number');
  assert.match(report.checksum, /^[0-9a-f]{64}$/);
  assert.ok(Array.isArray(report.smokeTests));
  for (const result of report.smokeTests) {
    assert.equal(typeof result.name, 'string');
    assert.equal(typeof result.passed, 'boolean');
  }
  // Report must be JSON-serializable.
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(report)));
});

test('normal path: latest-backup restore drills the newest snapshot', () => {
  const backups = [
    { id: 'older', snapshot: createSnapshot({ 'a.txt': 'old\n' }) },
    { id: 'latest', snapshot: createSnapshot(SAMPLE) },
  ];
  const report = runRestoreDrillFromLatestBackup(backups);
  assert.equal(report.ok, true);
  assert.equal(report.backupId, 'latest');
  assert.equal(report.fileCount, 3);
  assert.ok(report.rtoSeconds >= 0);
});

test('edge case: latest-backup restore with no backups fails clearly', () => {
  assert.throws(() => runRestoreDrillFromLatestBackup([]), RestoreDrillError);
});

test('failure: smoke-test failure propagates from runRestoreDrill', () => {
  const failingSmokeTest = () => {
    throw new Error('smoke test exploded');
  };
  assert.throws(
    () => runRestoreDrill(SAMPLE, { smokeTests: [failingSmokeTest] }),
    /smoke test exploded/,
  );
});

test('failure: smoke-test failure propagates from latest-backup restore', () => {
  const backups = [{ id: 'latest', snapshot: createSnapshot(SAMPLE) }];
  const failingSmokeTest = () => {
    throw new Error('smoke test exploded');
  };
  assert.throws(
    () => runRestoreDrillFromLatestBackup(backups, { smokeTests: [failingSmokeTest] }),
    /smoke test exploded/,
  );
});
