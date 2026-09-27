# Testnet / Mainnet Credential Separation

This document defines the policy and implementation for separating testnet and
mainnet credentials at the infrastructure boundary in LumenFlow.

---

## Principle

Testnet and mainnet credentials must be strictly isolated. A compromise of testnet
credentials must never be able to affect mainnet. This is enforced at three layers:

1. **GitHub Actions secrets** — separate secret names per environment
2. **Workflow files** — each workflow references only the secrets for its target network
3. **CI validation** — the `validate-credentials.yml` workflow enforces the separation on every PR

---

## Secret Naming Convention

All GitHub Actions secrets follow the `<NETWORK>_<PURPOSE>` pattern:

| Secret name | Environment | Purpose |
|---|---|---|
| `TESTNET_DEPLOYER_KEY` | testnet | Stellar secret key for the deploy account |
| `TESTNET_ADMIN_KEY` | testnet | Stellar secret key for the contract admin |
| `TESTNET_MERCHANT_KEY` | testnet | Stellar secret key for smoke test merchant |
| `TESTNET_PAYER_KEY` | testnet | Stellar secret key for smoke test payer |
| `TESTNET_TOKEN_ADDRESS` | testnet | SAC token address for smoke tests |
| `TESTNET_ADMIN_ADDRESS` | testnet | Public address of the testnet admin |
| `TESTNET_MERCHANT_ADDRESS` | testnet | Public address of the testnet merchant |
| `TESTNET_PAYER_ADDRESS` | testnet | Public address of the testnet payer |
| `TESTNET_SOURCE_ACCOUNT` | testnet | Source account for rollback operations |
| `MAINNET_DEPLOYER_KEY` | mainnet | Stellar secret key for the deploy account |
| `MAINNET_ADMIN_KEY` | mainnet | Stellar secret key for the contract admin |
| `MAINNET_SOURCE_ACCOUNT` | mainnet | Source account for mainnet operations |
| `MAINNET_ADMIN_ADDRESS` | mainnet | Public address of the mainnet admin |

> **Rule:** A workflow that targets testnet must reference only `TESTNET_*` secrets.
> A workflow that targets mainnet must reference only `MAINNET_*` secrets.

---

## Environment Files

The `scripts/env/` directory contains non-secret network configuration (RPC URLs,
passphrases) for each environment:

| File | `NETWORK` value | Secret? |
|---|---|---|
| `scripts/env/local.env` | `local` | No |
| `scripts/env/testnet.env` | `testnet` | No |
| `scripts/env/mainnet.env` | `mainnet` | No — RPC URL placeholder only |

These files are tracked in git. They **must not** contain secret keys. Secret keys
are passed through environment variables injected by the CI secret store or locally
via gitignored `.env.<network>` files (see `docs/secrets-and-local-env.md`).

The `NETWORK` value in each env file must match its filename (e.g., `mainnet.env`
must contain `NETWORK=mainnet`). This is validated by the `validate-credentials.yml`
workflow.

---

## Workflow Separation Matrix

| Workflow | Target network | Secrets used |
|---|---|---|
| `ci.yml` | none (unit tests) | none |
| `deploy-testnet.yml` | testnet | `TESTNET_*` |
| `testnet-smoke.yml` | testnet | `TESTNET_*` |
| `smoke_test.yml` | testnet | `TESTNET_*` |
| `terraform-plan.yml` | dev/testnet | `AWS_*` |
| `deploy-mainnet.yml` | mainnet | `MAINNET_*` |

> **No workflow should reference credentials from both testnet and mainnet.**

---

## CI Validation

The `.github/workflows/validate-credentials.yml` workflow runs on every PR and
push to `main`/`develop`. It performs four checks:

1. **Mainnet secrets in testnet workflows** — fails if any `MAINNET_*` secret is
   referenced in a testnet workflow file.
2. **Testnet secrets in mainnet workflows** — fails if any `TESTNET_*` secret is
   referenced in a mainnet workflow file.
3. **Env file NETWORK values** — verifies that each `scripts/env/*.env` file
   declares the correct `NETWORK` value.
4. **Accidental secret key commits** — scans tracked files for patterns matching
   Stellar secret keys (56-char base32 strings starting with `S`).

A PR that violates any of these checks cannot be merged until the violation is resolved.

---

## Local Development

For local development, use separate gitignored env files per network:

```bash
cp .env.example .env.testnet
cp .env.example .env.mainnet
```

Never populate the same `.env` file with both testnet and mainnet keys. The deploy
scripts load `.env.<network>` based on the `NETWORK` variable, so only the correct
credentials are loaded at runtime.

---

## Failure Modes

| Failure | Effect | Remediation |
|---|---|---|
| Mainnet key used in testnet workflow | CI check fails; PR blocked | Remove the mainnet secret reference; use the corresponding `TESTNET_*` secret |
| Wrong `NETWORK` in env file | CI check fails; deploy may target wrong network | Correct the `NETWORK` value in `scripts/env/<network>.env` |
| Secret key committed to git | CI gitleaks scan fails; PR blocked | Rotate the key immediately; remove from git history with `git filter-repo` |
| Testnet key set as mainnet secret in GitHub repo | Not detectable by CI | Enforce naming convention when adding/rotating secrets in GitHub settings |

---

## Rotating Credentials

When rotating a secret key:

1. Generate a new key for the affected network only.
2. Fund the new key on the target network.
3. Update the GitHub Actions secret (`Settings → Secrets → Actions`).
4. Verify the relevant workflow runs successfully with the new key.
5. Revoke the old key by draining its XLM balance and abandoning it.

Never copy a key from testnet to mainnet or vice versa.

---

## References

- `docs/secrets-and-local-env.md` — Local secrets management
- `.github/workflows/validate-credentials.yml` — Automated separation checks
- `.github/workflows/secrets-scan.yml` — Gitleaks scan
- `.gitleaks.toml` — Secret detection rules
- `scripts/env/` — Non-secret environment configuration files
