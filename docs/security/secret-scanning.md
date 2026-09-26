# Secret scanning on commits and artifacts

**Issue:** [#891](https://github.com/Gloriachinedu/lumenflow-contracts/issues/891)
**Scope:** git history, pull requests, and build/release artifacts.

Secret scanning is enforced at three points. A secret must fail the build at
the earliest point it can be detected.

## 1. Pre-commit (developer machine)

`.githooks/pre-commit` runs `gitleaks protect --staged --config .gitleaks.toml
--redact` before every commit. Enable the repo hooks once:

```bash
git config core.hooksPath .githooks
```

If `gitleaks` is not installed the hook warns and continues — CI is the
backstop. Install: <https://github.com/gitleaks/gitleaks#installing>.

## 2. Pull request and push to `main` / `develop` (CI)

`.github/workflows/secrets-scan.yml` runs `gitleaks/gitleaks-action` with
`fetch-depth: 0`, scanning **every commit in the range**, not just the diff.
The job fails on any finding; values are redacted to rule IDs in the log.

## 3. Build and release artifacts

Release packaging must scan the assembled artifact before it is published:

```bash
# run against the staged/packed output directory, not the repo
gitleaks detect --no-git --source dist/ --config .gitleaks.toml --redact
```

Add this step to any workflow that uploads a tarball, container image
filesystem, or SDK package (`sdk-release.yml`, `release.yml`). Source maps and
bundled `.env` files are the common leak path.

## Configuration and false positives

Rules and allowlists live in `.gitleaks.toml` (custom Stellar/Soroban rules
plus gitleaks built-ins). A false positive is resolved by adding an allowlist
entry **with a justification comment and, where possible, a scoped path or
regex** — never by disabling a rule globally.

## If a real secret is committed

1. Revoke / rotate the exposed credential immediately — assume it is public.
2. Purge it from history (`git filter-repo`) and force-push, or rotate and
   accept the history entry if purging is infeasible.
3. Record the incident per
   [vulnerability-disclosure-and-incident-response.md](./vulnerability-disclosure-and-incident-response.md).

## Related

- [Removing sensitive values from logs](./log-redaction.md)
- [Secrets and local environment setup](../secrets-and-local-env.md)
