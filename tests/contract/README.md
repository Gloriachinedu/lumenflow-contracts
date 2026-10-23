# API contract tests (generated from OpenAPI)

`docs/openapi.yaml` is the published contract for the LumenFlow Soroban API.
This suite treats that spec as the source of truth and **generates** its
assertions from it — one per operation, one per request schema — so any drift
between the spec, the Rust contract, and the request payloads is caught
automatically.

## Running

```bash
cd tests/contract
npm test          # => node --test
```

No dependencies — it uses the Node built-in test runner (`node --test`,
Node ≥ 18). `docs/openapi.yaml` is read with a small purpose-built extractor
(`lib/openapi-extract.js`) rather than a YAML library.

## What is checked

| # | Check | Source |
|---|-------|--------|
| 1 | Every operation has an `operationId`, an `x-soroban-contract-method`, is `POST`, and has a `200` response schema | spec |
| 2 | Every `$ref` resolves to a defined `components/schemas` entry; orphaned schemas don't accumulate | spec |
| 3 | `x-soroban-contract-method` equals the path tail **and** the lowerCamelCase form of `operationId`; operationIds are unique | spec |
| 4 | Every `x-soroban-contract-method` is a real `pub fn` in `contracts/lumenflow/src/lib.rs` | spec ⇄ contract |
| 5 | A validator built from each request schema **accepts** a spec-conforming body | generated |
| 6 | …and **rejects** a body missing a required field, a wrong-typed field, and an out-of-set `enum` value (failure / edge cases) | generated |
| 7 | The spec extractor rejects a malformed spec (no paths / no schemas) | negative |

## Extending

Add a new contract entrypoint to `docs/openapi.yaml` and checks 1–6 cover it on
the next run with no code change here. If check 4 fails, the spec and the
contract have diverged — fix whichever is wrong.
