#!/usr/bin/env node
// scripts/check-events-reference.mjs
//
// Verifies that every Soroban event emitted by the contracts (via
// `env.events().publish(("lumenflow", "<name>"), ...)`) is documented in
// `docs/events-reference.md`, and that the reference does not list events
// that are no longer emitted.
//
// Usage:
//   node scripts/check-events-reference.mjs
//
// Exits non-zero (and lists missing / extra events) when the reference
// drifts from the contract implementation.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

const CONTRACTS_DIR = join(REPO_ROOT, "contracts");
const DOCS_FILE = join(REPO_ROOT, "docs", "events-reference.md");

// Namespace used as the first tuple element in every published event.
const EVENT_NAMESPACE = "lumenflow";

/**
 * Recursively collect all `.rs` files under a directory.
 *
 * @param {string} dir
 * @returns {string[]}
 */
function collectRustFiles(dir) {
  if (!existsSync(dir)) {
    return [];
  }

  /** @type {string[]} */
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      // Skip build artifacts / vendored deps.
      if (entry === "target" || entry === "node_modules" || entry === ".git") {
        continue;
      }
      files.push(...collectRustFiles(full));
    } else if (stats.isFile() && entry.endsWith(".rs")) {
      files.push(full);
    }
  }
  return files;
}

/**
 * Strip Rust line and block comments so commented-out publishes are ignored.
 *
 * @param {string} source
 * @returns {string}
 */
function stripComments(source) {
  // Remove block comments (non-greedy, across newlines).
  let out = source.replace(/\/\*[\s\S]*?\*\//g, "");
  // Remove line comments, but not `//` inside string literals.
  out = out
    .split("\n")
    .map((line) => {
      let inString = false;
      let escaped = false;
      for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];
        if (inString) {
          if (escaped) {
            escaped = false;
          } else if (ch === "\\") {
            escaped = true;
          } else if (ch === '"') {
            inString = false;
          }
        } else if (ch === '"') {
          inString = true;
        } else if (ch === "/" && line[i + 1] === "/") {
          return line.slice(0, i);
        }
      }
      return line;
    })
    .join("\n");
  return out;
}

/**
 * Extract emitted event names from a Rust source file.
 *
 * Matches patterns such as:
 *   env.events().publish(("lumenflow", "stream_created"), data);
 *   env.events().publish((EVENT_NAMESPACE, "stream_created"), data);
 *   env.events().publish(("lumenflow", symbol_short!("created")), data);
 *
 * @param {string} source
 * @returns {string[]}
 */
function extractEventNames(source) {
  const cleaned = stripComments(source);
  /** @type {string[]} */
  const names = [];

  // Match `publish(` followed by a tuple whose first element is the namespace
  // and whose second element is a string literal event name.
  const publishRe = /\.publish\s*\(\s*\(\s*([^,()]+?)\s*,\s*"([^"]+)"\s*\)/g;
  let match;
  while ((match = publishRe.exec(cleaned)) !== null) {
    const namespace = match[1].trim();
    const name = match[2].trim();
    // Accept either the literal namespace or a constant that resolves to it.
    const namespaceOk =
      namespace === `"${EVENT_NAMESPACE}"` ||
      namespace === EVENT_NAMESPACE ||
      /NAMESPACE/i.test(namespace);
    if (namespaceOk && name.length > 0) {
      names.push(name);
    }
  }

  return names;
}

/**
 * Parse the documented event names from `docs/events-reference.md`.
 *
 * Recognises:
 *   - Markdown headings: `### stream_created` / `## Event: stream_created`
 *   - Table rows whose first cell is a backticked event name.
 *
 * @param {string} markdown
 * @returns {string[]}
 */
function extractDocumentedEvents(markdown) {
  /** @type {string[]} */
  const names = new Set();

  const lines = markdown.split("\n");
  for (const rawLine of lines) {
    const line = rawLine.trim();

    // Headings: `### stream_created` or `### Event: stream_created`
    const headingMatch = line.match(/^#{1,6}\s+(?:Event:\s*)?`?([a-z][a-z0-9_]*)`?\s*$/i);
    if (headingMatch) {
      names.add(headingMatch[1]);
      continue;
    }

    // Table rows: `| \`stream_created\` | ... |`
    if (line.startsWith("|")) {
      const cells = line.split("|").map((c) => c.trim());
      // cells[0] is empty (before leading pipe); first real cell is cells[1].
      const firstCell = cells[1] || "";
      const cellMatch = firstCell.match(/^`([a-z][a-z0-9_]*)`$/i);
      if (cellMatch) {
        names.add(cellMatch[1]);
      }
    }
  }

  return [...names];
}

/**
 * Run the events reference check.
 *
 * @param {object} [options]
 * @param {string} [options.contractsDir]
 * @param {string} [options.docsFile]
 * @returns {{ ok: boolean, missing: string[], extra: string[], emitted: string[], documented: string[] }}
 */
export function checkEventsReference(options = {}) {
  const contractsDir = options.contractsDir ?? CONTRACTS_DIR;
  const docsFile = options.docsFile ?? DOCS_FILE;

  if (!existsSync(docsFile)) {
    throw new Error(`Events reference not found: ${docsFile}`);
  }

  const rustFiles = collectRustFiles(contractsDir);
  if (rustFiles.length === 0) {
    throw new Error(`No Rust source files found under: ${contractsDir}`);
  }

  /** @type {Set<string>} */
  const emittedSet = new Set();
  for (const file of rustFiles) {
    const source = readFileSync(file, "utf8");
    for (const name of extractEventNames(source)) {
      emittedSet.add(name);
    }
  }

  const markdown = readFileSync(docsFile, "utf8");
  const documentedSet = new Set(extractDocumentedEvents(markdown));

  const emitted = [...emittedSet].sort();
  const documented = [...documentedSet].sort();

  const missing = emitted.filter((name) => !documentedSet.has(name));
  const extra = documented.filter((name) => !emittedSet.has(name));

  return {
    ok: missing.length === 0 && extra.length === 0,
    missing,
    extra,
    emitted,
    documented,
  };
}

function main() {
  let result;
  try {
    result = checkEventsReference();
  } catch (err) {
    console.error(`[check-events-reference] ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }

  const { ok, missing, extra, emitted, documented } = result;

  if (ok) {
    console.log(
      `[check-events-reference] OK — ${emitted.length} emitted event(s) all documented.`,
    );
    return;
  }

  console.error("[check-events-reference] Events reference is out of date.");
  console.error(
    `  Emitted: ${emitted.length}, Documented: ${documented.length}`,
  );

  if (missing.length > 0) {
    console.error("\n  Missing from docs/events-reference.md:");
    for (const name of missing) {
      console.error(`    - ${name}`);
    }
  }

  if (extra.length > 0) {
    console.error("\n  Documented but not emitted by any contract:");
    for (const name of extra) {
      console.error(`    - ${name}`);
    }
  }

  console.error(
    "\n  Update docs/events-reference.md (and the SDK eventCatalog.ts) to match the contracts.",
  );
  process.exit(1);
}

// Only run when invoked directly (not when imported by tests).
const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === __filename;

if (invokedDirectly) {
  main();
}