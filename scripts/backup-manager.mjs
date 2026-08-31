#!/usr/bin/env node
/**
 * scripts/backup-manager.mjs — Managed backup and restore for production state
 *
 * Resolves: #854
 *
 * Extends the restore-drill module with production-grade backup management:
 *
 *   - `createBackup(targetDir, files)` — creates a versioned, checksummed
 *     backup bundle in targetDir.
 *   - `verifyBackup(backupPath)` — runs the full restore drill against a
 *     saved backup file and returns a verification report.
 *   - `listBackups(targetDir)` — lists available backups ordered newest first.
 *
 * Run directly to drill the critical production config files:
 *   node scripts/backup-manager.mjs
 *   node scripts/backup-manager.mjs --verify backup-bundle/backup-<ts>.json
 *   node scripts/backup-manager.mjs --list   backup-bundle/
 */

import { createHash, randomUUID } from 'node:crypto';
import {
  readFileSync,
  writeFileSync,
  readdirSync,
  mkdirSync,
  statSync,
  existsSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, basename } from 'node:path';
import { createSnapshot, restoreSnapshot, runRestoreDrill, RestoreDrillError } from './restore-drill.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

export const BACKUP_FORMAT_VERSION = 2;

/**
 * Metadata embedded in every backup bundle.
 * @typedef {Object} BackupMetadata
 * @property {number} format_version
 * @property {string} backup_id
 * @property {string} created_at   ISO-8601 UTC
 * @property {string} git_commit   HEAD SHA or 'unknown'
 * @property {string} git_ref      branch/tag or 'unknown'
 * @property {number} file_count
 * @property {number} total_bytes
 * @property {string} snapshot_checksum
 */

/**
 * Create a versioned backup of `files` in `targetDir`.
 *
 * @param {string} targetDir   Directory where the backup file will be written.
 * @param {Object} files       Map of filename → string content.
 * @param {Object} [extra]     Extra metadata fields (e.g. git_commit, git_ref).
 * @returns {{ path: string, metadata: BackupMetadata }}
 */
export function createBackup(targetDir, files, extra = {}) {
  if (typeof targetDir !== 'string' || targetDir.length === 0) {
    throw new RestoreDrillError('createBackup: targetDir must be a non-empty string');
  }
  if (files === null || typeof files !== 'object') {
    throw new RestoreDrillError('createBackup: files must be an object');
  }

  mkdirSync(targetDir, { recursive: true });

  const snapshot = createSnapshot(files);
  const parsed = JSON.parse(snapshot);

  const totalBytes = Object.values(files).reduce(
    (n, content) => n + Buffer.byteLength(content, 'utf8'),
    0,
  );

  const metadata = {
    format_version: BACKUP_FORMAT_VERSION,
    backup_id: randomUUID(),
    created_at: new Date().toISOString(),
    git_commit: extra.git_commit || process.env.GITHUB_SHA || 'unknown',
    git_ref: extra.git_ref || process.env.GITHUB_REF_NAME || 'unknown',
    file_count: Object.keys(files).length,
    total_bytes: totalBytes,
    snapshot_checksum: parsed.digest,
  };

  const bundle = JSON.stringify({ metadata, snapshot: parsed }, null, 2);

  const ts = metadata.created_at.replace(/[:.]/g, '-').replace('T', '_').replace('Z', 'Z');
  const filename = `backup-${ts}.json`;
  const fullPath = resolve(targetDir, filename);

  writeFileSync(fullPath, bundle, 'utf8');
  return { path: fullPath, metadata };
}

/**
 * Verify a backup file produced by {@link createBackup}.
 *
 * @param {string} backupPath   Absolute or relative path to the backup JSON.
 * @returns {{ ok: boolean, metadata: BackupMetadata, report: Object }}
 * @throws {RestoreDrillError} if the backup is corrupt, truncated, or if any
 *   checksum does not match.
 */
export function verifyBackup(backupPath) {
  if (!existsSync(backupPath)) {
    throw new RestoreDrillError(`verifyBackup: file not found: ${backupPath}`);
  }

  let bundle;
  try {
    bundle = JSON.parse(readFileSync(backupPath, 'utf8'));
  } catch (err) {
    throw new RestoreDrillError(`verifyBackup: backup file is not valid JSON: ${err.message}`);
  }

  const { metadata, snapshot } = bundle;
  if (!metadata || !snapshot) {
    throw new RestoreDrillError('verifyBackup: backup bundle is missing metadata or snapshot fields');
  }
  if (metadata.format_version !== BACKUP_FORMAT_VERSION) {
    throw new RestoreDrillError(
      `verifyBackup: unsupported format version ${metadata.format_version} (expected ${BACKUP_FORMAT_VERSION})`,
    );
  }

  // Re-run the full restore drill on the embedded snapshot
  const snapshotStr = JSON.stringify(snapshot);
  const report = runRestoreDrill(restoreSnapshot(snapshotStr));

  // Re-verify top-level checksum
  if (report.checksum !== metadata.snapshot_checksum) {
    throw new RestoreDrillError(
      `verifyBackup: top-level checksum mismatch — backup may have been tampered with`,
    );
  }

  return { ok: true, metadata, report };
}

/**
 * List all backup files in `targetDir`, ordered newest first.
 *
 * @param {string} targetDir
 * @returns {Array<{ path: string, metadata: BackupMetadata }>}
 */
export function listBackups(targetDir) {
  if (!existsSync(targetDir)) return [];

  const files = readdirSync(targetDir)
    .filter((f) => f.startsWith('backup-') && f.endsWith('.json'))
    .map((f) => {
      const fullPath = resolve(targetDir, f);
      try {
        const bundle = JSON.parse(readFileSync(fullPath, 'utf8'));
        return { path: fullPath, metadata: bundle.metadata };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.metadata.created_at.localeCompare(a.metadata.created_at));

  return files;
}

// ── CLI entry point ────────────────────────────────────────────────────────────

function main(argv) {
  const args = argv.slice(2);

  if (args[0] === '--verify' && args[1]) {
    const path = resolve(args[1]);
    process.stdout.write(`Verifying backup: ${path}\n`);
    const result = verifyBackup(path);
    process.stdout.write(
      `✅ Backup verified — ${result.report.fileCount} file(s), ` +
        `${result.report.bytes} bytes, created ${result.metadata.created_at}\n`,
    );
    return;
  }

  if (args[0] === '--list') {
    const dir = resolve(args[1] || 'backup-bundle');
    const backups = listBackups(dir);
    if (backups.length === 0) {
      process.stdout.write('No backups found.\n');
      return;
    }
    process.stdout.write(`Found ${backups.length} backup(s) in ${dir}:\n`);
    for (const { metadata, path } of backups) {
      process.stdout.write(
        `  ${metadata.created_at}  ${metadata.file_count} files  ${basename(path)}\n`,
      );
    }
    return;
  }

  // Default: backup the critical production config files and drill the result
  const targets = ['Cargo.toml', 'Cargo.lock', 'rust-toolchain.toml', 'codecov.yml', 'Makefile'];
  const files = {};
  for (const rel of targets) {
    const abs = resolve(REPO_ROOT, rel);
    if (existsSync(abs)) {
      files[rel] = readFileSync(abs, 'utf8');
    }
  }

  if (Object.keys(files).length === 0) {
    process.stderr.write('ERROR: no backup target files found\n');
    process.exit(1);
  }

  const targetDir = resolve(REPO_ROOT, 'backup-bundle');
  const { path, metadata } = createBackup(targetDir, files);

  // Immediately verify the backup we just created
  const result = verifyBackup(path);
  process.stdout.write(
    `✅ Backup created and verified — ` +
      `${result.report.fileCount} file(s), ${result.report.bytes} bytes\n` +
      `   Path:     ${path}\n` +
      `   Checksum: ${metadata.snapshot_checksum.slice(0, 16)}…\n`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main(process.argv);
  } catch (err) {
    process.stderr.write(`backup-manager FAILED: ${err.message}\n`);
    process.exit(1);
  }
}
