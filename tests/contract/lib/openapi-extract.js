'use strict';

/**
 * Minimal, purpose-built extractor for `docs/openapi.yaml`.
 *
 * The repo has no YAML dependency and the spec is machine-generated with a
 * regular 2-space layout, so instead of a general YAML parser this does a
 * targeted line scan for exactly the structures the contract tests need:
 *
 *   - operations under `paths:` (operationId, x-soroban-contract-method,
 *     request/response schema $refs, requestBody.required)
 *   - schemas under `components.schemas:` (type, required[], property names +
 *     their type/format/$ref)
 *
 * It deliberately does NOT try to be a full parser. If the spec's layout
 * changes shape, `parseSpec` throws rather than silently returning garbage.
 */

const REF_RE = /\$ref:\s*['"]#\/components\/schemas\/([A-Za-z0-9_]+)['"]/;

function indentOf(line) {
  return line.length - line.trimStart().length;
}

/** @returns {{ paths: Record<string, Operation>, schemas: Record<string, Schema>, info: {version?: string, title?: string} }} */
function parseSpec(text) {
  const lines = text
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '' && !l.trimStart().startsWith('#'));

  const paths = {};
  const schemas = {};
  const info = {};

  let section = null; // 'paths' | 'schemas' | null
  let curPath = null;
  let curOp = null;
  let pastResponses = false;
  let inRequestBody = false;

  let curSchema = null;
  let schemaMode = null; // 'required' | 'properties' | null
  let curProp = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const ind = indentOf(line);
    const t = line.trim();

    // ── Top-level section switches ──────────────────────────────────────────
    if (ind === 0) {
      section = t === 'paths:' ? 'paths' : null;
      curPath = curOp = curSchema = null;
      if (t.startsWith('info:')) section = 'info';
      continue;
    }
    if (section === 'info' && ind === 2) {
      const m = t.match(/^(title|version):\s*(.+)$/);
      if (m) info[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
      continue;
    }
    if (ind === 0 || t === 'components:') continue;
    if (section === null && t === 'schemas:') {
      section = 'schemas';
      continue;
    }

    // ── paths: ─────────────────────────────────────────────────────────────
    if (section === 'paths') {
      if (ind === 2 && t.endsWith(':') && t.startsWith('/')) {
        curPath = t.slice(0, -1);
        curOp = null;
        continue;
      }
      if (ind === 4 && /^(get|post|put|delete|patch):$/.test(t)) {
        curOp = {
          path: curPath,
          method: t.slice(0, -1),
          operationId: null,
          sorobanMethod: null,
          requestBodyRequired: false,
          requestSchema: null,
          responses: {},
        };
        paths[curPath] = curOp;
        pastResponses = false;
        inRequestBody = false;
        continue;
      }
      if (!curOp) continue;

      if (/^operationId:\s*/.test(t)) curOp.operationId = t.split(/:\s*/)[1];
      else if (/^x-soroban-contract-method:\s*/.test(t)) curOp.sorobanMethod = t.split(/:\s*/)[1];
      else if (t === 'requestBody:') {
        inRequestBody = true;
      } else if (t === 'responses:') {
        pastResponses = true;
        inRequestBody = false;
      } else if (inRequestBody && /^required:\s*true$/.test(t)) {
        curOp.requestBodyRequired = true;
      } else if (pastResponses && /^'?\d{3}'?:$/.test(t)) {
        curOp._curStatus = t.replace(/[':]/g, '');
      } else {
        const ref = t.match(REF_RE);
        if (ref) {
          if (!pastResponses) curOp.requestSchema = ref[1];
          else if (curOp._curStatus) curOp.responses[curOp._curStatus] = ref[1];
        }
      }
      continue;
    }

    // ── components.schemas: ────────────────────────────────────────────────
    if (section === 'schemas') {
      if (ind === 4 && t.endsWith(':') && !t.startsWith('-')) {
        curSchema = { name: t.slice(0, -1), type: null, required: [], properties: {} };
        schemas[curSchema.name] = curSchema;
        schemaMode = null;
        curProp = null;
        continue;
      }
      if (!curSchema) continue;

      if (ind === 6 && /^type:\s*/.test(t)) {
        curSchema.type = t.split(/:\s*/)[1];
        schemaMode = null;
      } else if (ind === 6 && t === 'required:') {
        schemaMode = 'required';
      } else if (ind === 6 && /^properties:/.test(t)) {
        schemaMode = 'properties';
        // `properties: {}` — empty inline
      } else if (schemaMode === 'required' && ind === 8 && t.startsWith('- ')) {
        curSchema.required.push(t.slice(2).trim());
      } else if (schemaMode === 'properties' && ind === 8 && t.endsWith(':')) {
        curProp = { name: t.slice(0, -1), type: null, format: null, ref: null, enum: null };
        curSchema.properties[curProp.name] = curProp;
      } else if (curProp && ind >= 10) {
        if (/^type:\s*/.test(t)) curProp.type = t.split(/:\s*/)[1];
        else if (/^format:\s*/.test(t)) curProp.format = t.split(/:\s*/)[1];
        else {
          const ref = t.match(REF_RE);
          if (ref) curProp.ref = ref[1];
          const en = t.match(/^enum:\s*\[(.+)\]$/);
          if (en) curProp.enum = en[1].split(',').map((s) => s.trim());
        }
      }
      continue;
    }
  }

  if (Object.keys(paths).length === 0) throw new Error('openapi-extract: no paths parsed');
  if (Object.keys(schemas).length === 0) throw new Error('openapi-extract: no schemas parsed');

  return { paths, schemas, info };
}

/** Collect every schema name referenced by any operation or schema property. */
function referencedSchemas(spec) {
  const used = new Set();
  for (const op of Object.values(spec.paths)) {
    if (op.requestSchema) used.add(op.requestSchema);
    for (const r of Object.values(op.responses)) used.add(r);
  }
  for (const s of Object.values(spec.schemas)) {
    for (const p of Object.values(s.properties)) {
      if (p.ref) used.add(p.ref);
    }
  }
  return used;
}

module.exports = { parseSpec, referencedSchemas };
