# Removing sensitive values from logs

**Issue:** [#892](https://github.com/Gloriachinedu/lumenflow-contracts/issues/892)
**Scope:** application logs (SDK, webhook relay, dashboard API) and deployment
/ CI logs.

Logs are shipped to third-party aggregators and retained far longer than the
data they describe. A secret in a log line is a secret disclosed. This
document states the rule and the tooling that enforces it.

## Rule

Never log a raw credential. That includes:

- Stellar secret seeds (`S…`), PEM private keys, BIP-39 mnemonics
- `Authorization` header values, cookies, session IDs
- API keys, access / refresh tokens, webhook signing secrets
- full request bodies or upstream responses that may embed the above

## Application logs — `@lumenflow/sdk`

Use the helpers in `sdk/src/security/logRedaction.ts` at every point that
emits text you do not fully control:

```ts
import { redactSecrets, redactingLogger } from "@lumenflow/sdk";

const log = redactingLogger(console.error);
log("payment failed", { orderId, headers });   // secrets scrubbed

try {
  await submit(tx);
} catch (err) {
  log("submit failed", redactSecrets(err));     // secret-in-message scrubbed
}
```

`redactSecrets` replaces values under known secret keys wholesale and scrubs
credential-shaped substrings from any string; `redactString` covers plain
strings. Both leave the field name / scheme in place so lines stay useful.

Automated coverage: `sdk/src/tests/security/logRedaction.test.ts` exercises the
normal path plus edge cases (circular references, `Error` objects, non-secret
text left untouched).

## Deployment and CI logs

- CI never `echo`s a secret. GitHub Actions masks values that come from
  `secrets.*`; do not copy them into other variables or command output.
- `gitleaks` runs in `secrets-scan.yml` with `--redact`, and the pre-commit
  hook (`.githooks/pre-commit`) runs `gitleaks protect --staged --redact`, so
  detected values are shown as rule IDs, never plaintext.
- Deployment scripts under `scripts/` read secrets from the environment and
  must not print them; pass `set +x` around any block that references one.

## Reviewing a change

When reviewing code that adds logging, check that no credential, header, cookie,
or full request/response object is logged without passing through
`redactSecrets`.
