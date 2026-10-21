# Dependency lockfiles and transitive vulnerability review

**Issue:** [#890](https://github.com/Gloriachinedu/lumenflow-contracts/issues/890)
**Scope:** every dependency tree in the repo — Rust (`Cargo`), npm (root,
`sdk/`, `frontend/`), and GitHub Actions.

## Lockfiles are committed and authoritative

| Ecosystem | Lockfile | Directories |
| --- | --- | --- |
| Rust / Cargo | `Cargo.lock` | workspace root (covers `contracts/`, `cli/`, `wasm/`) |
| npm | `package-lock.json` | `/`, `/sdk`, `/frontend` |

Rules:

- Every build, test, and audit job uses the frozen lockfile:
  `cargo build/test/clippy --locked`, `npm ci` (never `npm install` in CI).
- A PR that changes a dependency **must** include the updated lockfile;
  `cargo update --locked` in `ci.yml` fails the job if `Cargo.lock` is stale.
- Lockfile-only changes are reviewed for unexpected version jumps and new
  transitive packages.

## Transitive vulnerability review (CI-enforced)

| Check | Tool | Config | Fails on |
| --- | --- | --- | --- |
| Rust advisories | `cargo audit` | `audit.toml` | HIGH / CRITICAL RUSTSEC advisories |
| Rust licenses, yanked, duplicates, sources | `cargo deny` | `deny.toml` | disallowed licence, yanked crate, unknown source |
| npm advisories | `npm audit --audit-level=high --omit=dev` | — | HIGH / CRITICAL advisories in root, `sdk/`, `frontend/` |

These run on every PR (`ci.yml`) and weekly on a schedule
(`security-audit.yml`), which opens a tracking issue automatically on failure.

## Updates

`.github/dependabot.yml` opens weekly PRs for all six trees (cargo ×2, npm ×3,
github-actions). Each Dependabot PR is gated by the same audit/deny/`--locked`
checks before it can merge.

## Handling a finding

1. Prefer upgrading to a patched version (bump the direct dependency that pulls
   in the vulnerable crate; commit the regenerated lockfile).
2. If no fix is available, add a **time-limited, justified** ignore:
   - Rust: `ignore = [{ id = "RUSTSEC-…", reason = "…", expiry = "YYYY-MM-DD" }]`
     in `audit.toml` / `deny.toml`.
   - npm: document the accepted risk here and in the security runbook.
3. Record anything user-impacting per the incident-response process.
