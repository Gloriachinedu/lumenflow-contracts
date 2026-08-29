#!/usr/bin/env node
/**
 * check-roadmap-tracking.mjs
 *
 * Validates that every unresolved (`- [ ]`) roadmap item in ROADMAP.md is
 * tracked in the "Unresolved item tracking" table with a non-empty owner and a
 * target milestone drawn from the milestone legend.
 *
 * See docs/roadmap-tracking.md for the process this enforces.
 *
 * Usage:
 *   node scripts/check-roadmap-tracking.mjs [path/to/ROADMAP.md]
 *
 * Exit code 0 = valid, 1 = one or more problems (printed to stderr).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ALLOWED_STATUSES = ['Not started', 'In progress', 'Blocked', 'Done'];
const TRACKING_HEADING = '## Unresolved item tracking';
const LEGEND_HEADING = '### Milestone legend';
const TABLE_HEADING = '### Owners and target milestones';

/** Split a markdown table row `| a | b |` into trimmed cell strings. */
function splitRow(line) {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((c) => c.trim());
}

function isTableDivider(line) {
  return /^\|?[\s:|-]+\|?$/.test(line.trim()) && line.includes('-');
}

/**
 * Parse ROADMAP.md content.
 * @returns {{ unresolvedItems: string[], legendMilestones: string[], rows: object[] }}
 */
export function parseRoadmap(markdown) {
  const lines = markdown.split(/\r?\n/);
  const trackingIdx = lines.findIndex((l) => l.trim() === TRACKING_HEADING);

  // Unresolved roadmap bullets appear before the tracking section.
  const bodyLines = trackingIdx === -1 ? lines : lines.slice(0, trackingIdx);
  const unresolvedItems = [];
  for (const line of bodyLines) {
    const m = line.match(/^- \[ \]\s+\*\*(.+?)\*\*/);
    if (m) unresolvedItems.push(m[1].trim());
  }

  const legendMilestones = [];
  const rows = [];

  if (trackingIdx !== -1) {
    const section = lines.slice(trackingIdx);
    const legendStart = section.findIndex((l) => l.trim() === LEGEND_HEADING);
    const tableStart = section.findIndex((l) => l.trim() === TABLE_HEADING);

    if (legendStart !== -1) {
      for (let i = legendStart + 1; i < section.length; i++) {
        const line = section[i];
        if (line.startsWith('### ') || line.startsWith('## ')) break;
        if (!line.trim().startsWith('|') || isTableDivider(line)) continue;
        const cells = splitRow(line);
        if (cells[0].toLowerCase() === 'milestone') continue;
        const milestone = cells[0].replace(/`/g, '').trim();
        if (milestone) legendMilestones.push(milestone);
      }
    }

    if (tableStart !== -1) {
      for (let i = tableStart + 1; i < section.length; i++) {
        const line = section[i];
        if (line.startsWith('### ') || line.startsWith('## ') || line.startsWith('---')) break;
        if (!line.trim().startsWith('|') || isTableDivider(line)) continue;
        const cells = splitRow(line);
        if (cells[0].toLowerCase() === 'item') continue;
        rows.push({
          item: cells[0] ?? '',
          owner: cells[1] ?? '',
          milestone: (cells[2] ?? '').replace(/`/g, '').trim(),
          trackingIssue: cells[3] ?? '',
          status: cells[4] ?? '',
        });
      }
    }
  }

  return { unresolvedItems, legendMilestones, rows };
}

/**
 * @returns {string[]} list of human-readable problems; empty means valid.
 */
export function checkRoadmap(markdown) {
  const errors = [];
  const { unresolvedItems, legendMilestones, rows } = parseRoadmap(markdown);

  if (unresolvedItems.length === 0) {
    errors.push('No unresolved roadmap items found — is ROADMAP.md well-formed?');
  }
  if (legendMilestones.length === 0) {
    errors.push('Milestone legend is empty or missing.');
  }

  const trackedItems = new Set(rows.map((r) => r.item));

  for (const item of unresolvedItems) {
    if (!trackedItems.has(item)) {
      errors.push(`Roadmap item "${item}" is not present in the tracking table.`);
    }
  }

  for (const row of rows) {
    const label = row.item || '(unnamed row)';
    if (!unresolvedItems.includes(row.item)) {
      errors.push(`Tracking row "${label}" does not match any unresolved roadmap item.`);
    }
    if (!row.owner) {
      errors.push(`Tracking row "${label}" has an empty Owner cell.`);
    }
    if (!row.milestone) {
      errors.push(`Tracking row "${label}" has an empty Target milestone cell.`);
    } else if (!legendMilestones.includes(row.milestone)) {
      errors.push(
        `Tracking row "${label}" targets milestone "${row.milestone}", which is not in the legend (${legendMilestones.join(', ')}).`,
      );
    }
    if (!ALLOWED_STATUSES.includes(row.status)) {
      errors.push(
        `Tracking row "${label}" has status "${row.status}", expected one of: ${ALLOWED_STATUSES.join(', ')}.`,
      );
    }
  }

  // Detect duplicate rows for the same item.
  const seen = new Set();
  for (const row of rows) {
    if (seen.has(row.item)) {
      errors.push(`Roadmap item "${row.item}" appears more than once in the tracking table.`);
    }
    seen.add(row.item);
  }

  return errors;
}

function main() {
  const arg = process.argv[2];
  const here = dirname(fileURLToPath(import.meta.url));
  const path = arg ? resolve(process.cwd(), arg) : resolve(here, '..', 'ROADMAP.md');

  let markdown;
  try {
    markdown = readFileSync(path, 'utf8');
  } catch (err) {
    console.error(`check-roadmap-tracking: cannot read ${path}: ${err.message}`);
    process.exit(1);
  }

  const errors = checkRoadmap(markdown);
  if (errors.length > 0) {
    console.error('Roadmap tracking check failed:');
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log('Roadmap tracking check passed.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
