#!/usr/bin/env node
/**
 * Restore drill — verify that a backup is actually usable, not just present.
 *
 * A backup that has never been restored is a hope, not a safeguard. This module
 * models the smallest useful backup artifact (a checksummed snapshot of a set of
 * files) and performs a full round trip: snapshot -> serialize -> restore ->
 * byte-for-byte compare. Corruption, truncation, and silent tampering all fail
 * the drill loudly.
 *
 * Run directly to drill the repository's own critical config files:
 *   node scripts/restore-drill.mjs
 *   node scripts/restore-drill.mjs codecov.yml Makefile Cargo.toml
 */

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const SNAPSHOT_VERSION = 1;

/** Maximum acceptable Recovery Time Objective, in seconds (4 hours). */
export const RTO_LIMIT_SECONDS = 4 * 60 * 60;

export class RestoreDrillError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RestoreDrillError';
  }
}

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * Build a serializable snapshot of `files` (a map of name -> string content).
 * The snapshot embeds a per-file digest and a top-level digest over all files.
 */
export function createSnapshot(files) {
  if (files === null || typeof files !== 'object') {
    throw new RestoreDrillError('createSnapshot expects an object of name -> content');
  }
  const names = Object.keys(files).sort();
  const entries = names.map((name) => {
    const content = files[name];
    if (typeof content !== 'string') {
      throw new RestoreDrillError(`file "${name}" content must be a string`);
    }
    return { name, bytes: Buffer.byteLength(content, 'utf8'), sha256: sha256(content), content };
  });
  const digest = sha256(entries.map((e) => `${e.name}:${e.sha256}`).join('\n'));
  return JSON.stringify({ version: SNAPSHOT_VERSION, digest, entries });
}

/**
 * Restore a snapshot produced by {@link createSnapshot}. Throws a
 * {@link RestoreDrillError} if the payload is malformed, truncated, or if any
 * checksum no longer matches its content.
 */
export function restoreSnapshot(snapshot) {
  if (typeof snapshot !== 'string' || snapshot.length === 0) {
    throw new RestoreDrillError('snapshot must be a non-empty string');
  }
  let parsed;
  try {
    parsed = JSON.parse(snapshot);
  } catch (err) {
    throw new RestoreDrillError(`snapshot is not valid JSON (truncated or corrupt): ${err.message}`);
  }
  if (!parsed || parsed.version !== SNAPSHOT_VERSION || !Array.isArray(parsed.entries)) {
    throw new RestoreDrillError('snapshot has an unexpected shape or version');
  }

  const restored = {};
  for (const entry of parsed.entries) {
    if (!entry || typeof entry.name !== 'string' || typeof entry.content !== 'string') {
      throw new RestoreDrillError('snapshot entry is missing name or content');
    }
    const actual = sha256(entry.content);
    if (actual !== entry.sha256) {
      throw new RestoreDrillError(`checksum mismatch for "${entry.name}" — backup is corrupt`);
    }
    restored[entry.name] = entry.content;
  }

  const digest = sha256(
    Object.keys(restored)
      .sort()
      .map((name) => `${name}:${sha256(restored[name])}`)
      .join('\n'),
  );
  if (digest !== parsed.digest) {
    throw new RestoreDrillError('top-level digest mismatch — files added or removed from backup');
  }
  return restored;
}

/**
 * Run the full drill for `files` and return a report. Throws if the restored
 * copy is not byte-for-byte identical to the source.
 */
export function runRestoreDrill(files) {
  const snapshot = createSnapshot(files);
  const restored = restoreSnapshot(snapshot);

  const sourceNames = Object.keys(files).sort();
  const restoredNames = Object.keys(restored).sort();
  if (sourceNames.join('\0') !== restoredNames.join('\0')) {
    throw new RestoreDrillError('restored file set does not match the source file set');
  }
  for (const name of sourceNames) {
    if (files[name] !== restored[name]) {
      throw new RestoreDrillError(`restored content differs from source for "${name}"`);
    }
  }

  return {
    ok: true,
    fileCount: sourceNames.length,
    bytes: sourceNames.reduce((n, name) => n + Buffer.byteLength(files[name], 'utf8'), 0),
    checksum: JSON.parse(snapshot).digest,
  };
}

/**
 * Resolve the most recent backup bundle under `dir`. A bundle is either a
 * single `.json` snapshot file or a directory containing one. Selection is by
 * modification time, newest first.
 */
export function findLatestBackup(dir) {
  const candidates = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isFile() && name.endsWith('.json')) {
      candidates.push({ path: full, mtimeMs: stat.mtimeMs });
    } else if (stat.isDirectory()) {
      for (const inner of readdirSync(full)) {
        if (inner.endsWith('.json')) {
          const innerFull = join(full, inner);
          const innerStat = statSync(innerFull);
          if (innerStat.isFile()) {
            candidates.push({ path: innerFull, mtimeMs: innerStat.mtimeMs });
          }
        }
      }
    }
  }
  if (candidates.length === 0) {
    throw new RestoreDrillError(`no backup bundles found under "${dir}"`);
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates[0].path;
}

/**
 * Restore the latest backup bundle found under `backupDir`, run an optional
 * smoke test against the restored files, and measure the elapsed RTO.
 *
 * `smokeTest` receives the restored name -> content map and may throw to fail
 * the drill. Returns a machine-readable report including `rtoSeconds`.
 */
export function runLatestBackupDrill(backupDir, smokeTest) {
  const startedAt = process.hrtime.bigint();
  const snapshotPath = findLatestBackup(backupDir);
  const snapshot = readFileSync(snapshotPath, 'utf8');
  const restored = restoreSnapshot(snapshot);

  if (typeof smokeTest === 'function') {
    smokeTest(restored);
  }

  const names = Object.keys(restored).sort();
  const bytes = names.reduce((n, name) => n + Buffer.byteLength(restored[name], 'utf8'), 0);
  const checksum = JSON.parse(snapshot).digest;
  const rtoSeconds = Number(process.hrtime.bigint() - startedAt) / 1e9;

  return {
    ok: true,
    rtoSeconds,
    rtoWithinLimit: rtoSeconds < RTO_LIMIT_SECONDS,
    fileCount: names.length,
    bytes,
    checksum,
    snapshotPath,
  };
}

function parseArgs(argv) {
  const args = { latestBackup: null, targets: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--latest-backup') {
      const value = argv[i + 1];
      if (!value) {
        throw new RestoreDrillError('--latest-backup requires a directory path');
      }
      args.latestBackup = value;
      i += 1;
    } else if (arg.startsWith('--latest-backup=')) {
      args.latestBackup = arg.slice('--latest-backup='.length);
    } else {
      args.targets.push(arg);
    }
  }
  return args;
}

function main(argv) {
  const here = dirname(fileURLToPath(import.meta.url));
  const args = parseArgs(argv);

  if (args.latestBackup) {
    const report = runLatestBackupDrill(resolve(here, '..', args.latestBackup));
    process.stdout.write(`${JSON.stringify(report)}\n`);
    if (!report.rtoWithinLimit) {
      throw new RestoreDrillError(
        `RTO ${report.rtoSeconds.toFixed(1)}s exceeds limit of ${RTO_LIMIT_SECONDS}s`,
      );
    }
    return;
  }

  const targets = args.targets.length > 0 ? args.targets : ['codecov.yml', 'Makefile', 'Cargo.toml'];
  const files = {};
  for (const rel of targets) {
    files[rel] = readFileSync(resolve(here, '..', rel), 'utf8');
  }
  const report = runRestoreDrill(files);
  process.stdout.write(
    `restore drill OK — ${report.fileCount} file(s), ${report.bytes} bytes, checksum ${report.checksum.slice(0, 12)}…\n`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`restore drill FAILED: ${err.message}\n`);
    process.exit(1);
  }
}
