'use strict';

/**
 * API contract tests generated from the OpenAPI spec (issue #880).
 *
 * `docs/openapi.yaml` is the published contract for the LumenFlow Soroban API.
 * This suite treats the spec as the source of truth and generates one set of
 * assertions per operation / per schema, so drift between the spec, the Rust
 * contract, and the request payloads is caught automatically:
 *
 *   1. structural — every operation is well-formed (operationId, soroban method,
 *      a 200 response with a schema, resolvable $refs)
 *   2. naming     — `x-soroban-contract-method` matches the path and the
 *      operationId
 *   3. integration — every `x-soroban-contract-method` is a real `pub fn` in
 *      `contracts/lumenflow/src/lib.rs`
 *   4. request validation — a validator built from each request schema accepts a
 *      spec-conformant body and rejects a body missing a required field / with a
 *      wrong-typed field (the failure/edge case)
 *   5. negative — the spec extractor itself rejects a malformed spec
 *
 * Runner: `node --test` (Node 20 built-in — no dependencies).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { parseSpec, referencedSchemas } = require('./lib/openapi-extract');
const { buildValidator, conformingBody } = require('./lib/schema-validator');

const REPO_ROOT = path.resolve(__dirname, '../..');
const SPEC_PATH = path.join(REPO_ROOT, 'docs/openapi.yaml');
const CONTRACT_LIB = path.join(REPO_ROOT, 'contracts/lumenflow/src/lib.rs');

const spec = parseSpec(fs.readFileSync(SPEC_PATH, 'utf8'));
const operations = Object.values(spec.paths);
const contractFns = new Set(
  [...fs.readFileSync(CONTRACT_LIB, 'utf8').matchAll(/pub fn ([a-z_]+)\s*\(/g)].map((m) => m[1]),
);

// ─── 0. sanity ────────────────────────────────────────────────────────────────

test('spec parses to a plausible shape', () => {
  assert.ok(operations.length >= 50, `expected >=50 operations, got ${operations.length}`);
  assert.ok(Object.keys(spec.schemas).length >= 40);
  assert.equal(spec.info.version, '1.0.0');
});

// ─── 1. structural — per operation ────────────────────────────────────────────

test('every operation is structurally complete', async (t) => {
  for (const op of operations) {
    await t.test(op.path, () => {
      assert.ok(op.operationId, 'missing operationId');
      assert.ok(op.sorobanMethod, 'missing x-soroban-contract-method');
      assert.equal(op.method, 'post', 'contract invocations are POST');
      assert.ok(op.responses['200'], 'missing a 200 response schema');
    });
  }
});

test('every $ref resolves to a defined component schema', () => {
  const defined = new Set(Object.keys(spec.schemas));
  const unresolved = [...referencedSchemas(spec)].filter((name) => !defined.has(name));
  assert.deepEqual(unresolved, [], `unresolved $refs: ${unresolved.join(', ')}`);
});

test('operations that declare a requestBody mark it required and reference a schema', () => {
  for (const op of operations) {
    if (op.requestSchema) {
      assert.ok(op.requestBodyRequired, `${op.path}: requestBody should be required: true`);
    }
  }
});

test('no more than a couple of orphaned (defined but unreferenced) schemas', () => {
  const used = referencedSchemas(spec);
  const orphans = Object.keys(spec.schemas).filter((n) => !used.has(n));
  assert.ok(orphans.length <= 2, `orphaned schemas drifting upward: ${orphans.join(', ')}`);
});

// ─── 2. naming ───────────────────────────────────────────────────────────────

test('x-soroban-contract-method matches the path and operationId', async (t) => {
  for (const op of operations) {
    await t.test(op.path, () => {
      const tail = op.path.replace('/contract/', '');
      assert.equal(op.sorobanMethod, tail, 'soroban method must equal the path tail');
      // operationId is the lowerCamelCase form of the soroban method
      const camel = op.sorobanMethod.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
      assert.equal(op.operationId, camel, `operationId ${op.operationId} != ${camel}`);
    });
  }
});

test('operationIds are unique', () => {
  const ids = operations.map((o) => o.operationId);
  assert.equal(new Set(ids).size, ids.length);
});

// ─── 3. integration — spec vs. Rust contract ─────────────────────────────────

test('every x-soroban-contract-method is a real pub fn in the contract', async (t) => {
  for (const op of operations) {
    await t.test(op.sorobanMethod, () => {
      assert.ok(
        contractFns.has(op.sorobanMethod),
        `${op.sorobanMethod} has no matching \`pub fn\` in contracts/lumenflow/src/lib.rs`,
      );
    });
  }
});

// ─── 4. request validation — generated from each request schema ───────────────

test('a validator built from each request schema accepts a conforming body', async (t) => {
  for (const op of operations) {
    if (!op.requestSchema) continue;
    const schema = spec.schemas[op.requestSchema];
    await t.test(`${op.operationId} <- ${op.requestSchema}`, () => {
      const validate = buildValidator(schema, spec.schemas);
      const body = conformingBody(schema, spec.schemas);
      const result = validate(body);
      assert.equal(result.ok, true, `conforming body rejected: ${result.errors.join('; ')}`);
    });
  }
});

test('the validator rejects a body missing a required field (failure case)', async (t) => {
  for (const op of operations) {
    if (!op.requestSchema) continue;
    const schema = spec.schemas[op.requestSchema];
    if (schema.required.length === 0) continue; // nothing required — skip
    await t.test(`${op.operationId}`, () => {
      const validate = buildValidator(schema, spec.schemas);
      const body = conformingBody(schema, spec.schemas);
      const dropped = schema.required[0];
      delete body[dropped];
      const result = validate(body);
      assert.equal(result.ok, false, `expected rejection for missing '${dropped}'`);
      assert.ok(result.errors.some((e) => e.includes(dropped)));
    });
  }
});

test('the validator rejects a wrong-typed field (edge case)', async (t) => {
  for (const op of operations) {
    if (!op.requestSchema) continue;
    const schema = spec.schemas[op.requestSchema];
    const stringField = Object.values(schema.properties).find((p) => p.type === 'string' && !p.enum);
    const intField = Object.values(schema.properties).find((p) => p.type === 'integer');
    if (!stringField && !intField) return;
    await t.test(`${op.operationId}`, () => {
      const validate = buildValidator(schema, spec.schemas);
      const body = conformingBody(schema, spec.schemas);
      if (stringField) body[stringField.name] = 12345; // number where a string is required
      else body[intField.name] = 'not-a-number';
      const result = validate(body);
      assert.equal(result.ok, false);
    });
  }
});

test('enum-constrained fields reject out-of-set values', () => {
  const withEnum = [];
  for (const schema of Object.values(spec.schemas)) {
    for (const prop of Object.values(schema.properties)) {
      if (prop.enum) withEnum.push({ schema, prop });
    }
  }
  assert.ok(withEnum.length > 0, 'expected at least one enum field (e.g. merchant category)');
  for (const { schema, prop } of withEnum) {
    const validate = buildValidator(schema, spec.schemas);
    const body = conformingBody(schema, spec.schemas);
    body[prop.name] = '__not_a_valid_enum_member__';
    assert.equal(validate(body).ok, false, `${schema.name}.${prop.name} accepted a bad enum value`);
  }
});

// ─── 5. negative — the extractor guards itself ───────────────────────────────

test('parseSpec throws on a spec with no paths', () => {
  assert.throws(() => parseSpec('openapi: 3.0.3\ncomponents:\n  schemas:\n    Foo:\n      type: object\n'));
});

test('parseSpec throws on a spec with no schemas', () => {
  assert.throws(() => parseSpec('openapi: 3.0.3\npaths:\n  /contract/x:\n    post:\n      operationId: x\n'));
});
