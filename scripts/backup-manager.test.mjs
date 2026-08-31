import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import {
  createBackup,
  verifyBackup,
  listBackups,
  BACKUP_FORMAT_VERSION,
} from './backup-manager.mjs';
import { RestoreDrillError } from './restore-drill.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Test helpers ───────────────────────────────────────────────────────────────

function makeTempDir() {
  return mkdtempSync(resolve(tmpdir(), 'lumenflow-backup-test-'));
}

const SAMPLE_FILES = {
  'config.toml': '[workspace]\nmembers = ["contracts/lumenflow"]\n',
  'Makefile': 'build:\n\tcargo build\n',
  'notes.txt': 'deployment notes\n',
};

// ── Normal path ────────────────────────────────────────────────────────────────

test('createBackup writes a valid JSON bundle to targetDir', () => {
  const dir = makeTempDir();
  try {
    const { path, metadata } = createBackup(dir, SAMPLE_FILES);
    assert.match(path, /backup-.+\.json$/);
    assert.equal(metadata.format_version, BACKUP_FORMAT_VERSION);
    assert.equal(metadata.file_count, 3);
    assert.ok(metadata.total_bytes > 0);
    assert.match(metadata.snapshot_checksum, /^[0-9a-f]{64}$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('verifyBackup returns ok=true for a valid backup', () => {
  const dir = makeTempDir();
  try {
    const { path } = createBackup(dir, SAMPLE_FILES);
    const result = verifyBackup(path);
    assert.equal(result.ok, true);
    assert.equal(result.report.fileCount, 3);
    assert.ok(result.report.bytes > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('createBackup + verifyBackup round-trips all file contents', () => {
  const dir = makeTempDir();
  try {
    const { path } = createBackup(dir, SAMPLE_FILES);
    // A successful verifyBackup is sufficient proof of a round-trip;
    // it internally calls runRestoreDrill which does the byte-for-byte compare.
    const result = verifyBackup(path);
    assert.equal(result.ok, true);
    assert.equal(result.report.fileCount, Object.keys(SAMPLE_FILES).length);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('listBackups returns backups ordered newest first', async () => {
  const dir = makeTempDir();
  try {
    createBackup(dir, { 'a.txt': 'first\n' });
    // Small delay to ensure different timestamps
    await new Promise((r) => setTimeout(r, 50));
    createBackup(dir, { 'b.txt': 'second\n' });

    const backups = listBackups(dir);
    assert.equal(backups.length, 2);
    // Newest first
    assert.ok(backups[0].metadata.created_at >= backups[1].metadata.created_at);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('listBackups returns empty array for non-existent directory', () => {
  const result = listBackups('/tmp/definitely-does-not-exist-xyz');
  assert.deepEqual(result, []);
});

// ── Edge cases ─────────────────────────────────────────────────────────────────

test('createBackup handles empty file set', () => {
  const dir = makeTempDir();
  try {
    const { path, metadata } = createBackup(dir, {});
    assert.equal(metadata.file_count, 0);
    assert.equal(metadata.total_bytes, 0);
    // Verify the empty backup is still valid
    const result = verifyBackup(path);
    assert.equal(result.ok, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('createBackup includes extra metadata when provided', () => {
  const dir = makeTempDir();
  try {
    const extra = { git_commit: 'abc123', git_ref: 'main' };
    const { metadata } = createBackup(dir, SAMPLE_FILES, extra);
    assert.equal(metadata.git_commit, 'abc123');
    assert.equal(metadata.git_ref, 'main');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── Failure cases ──────────────────────────────────────────────────────────────

test('verifyBackup throws RestoreDrillError for missing file', () => {
  assert.throws(
    () => verifyBackup('/tmp/definitely-does-not-exist.json'),
    RestoreDrillError,
  );
});

test('verifyBackup throws RestoreDrillError for invalid JSON', () => {
  const dir = makeTempDir();
  try {
    const badPath = resolve(dir, 'backup-bad.json');
    writeFileSync(badPath, 'NOT JSON', 'utf8');
    assert.throws(() => verifyBackup(badPath), RestoreDrillError);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('verifyBackup throws on tampered file content', () => {
  const dir = makeTempDir();
  try {
    const { path } = createBackup(dir, SAMPLE_FILES);
    const bundle = JSON.parse(readFileSync(path, 'utf8'));
    // Tamper with a file's content inside the snapshot
    bundle.snapshot.entries[0].content += 'TAMPERED';
    writeFileSync(path, JSON.stringify(bundle), 'utf8');
    assert.throws(() => verifyBackup(path), RestoreDrillError);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('verifyBackup throws on wrong format_version', () => {
  const dir = makeTempDir();
  try {
    const { path } = createBackup(dir, SAMPLE_FILES);
    const bundle = JSON.parse(readFileSync(path, 'utf8'));
    bundle.metadata.format_version = 999;
    writeFileSync(path, JSON.stringify(bundle), 'utf8');
    assert.throws(() => verifyBackup(path), RestoreDrillError);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('createBackup throws on invalid targetDir', () => {
  assert.throws(() => createBackup('', SAMPLE_FILES), RestoreDrillError);
});

test('createBackup throws on non-object files argument', () => {
  const dir = makeTempDir();
  try {
    assert.throws(() => createBackup(dir, null), RestoreDrillError);
    assert.throws(() => createBackup(dir, 'string'), RestoreDrillError);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
