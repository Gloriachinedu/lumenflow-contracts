# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.x     | ✅        |

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Please report security issues by emailing **security@lumenflow.dev** with:

1. A description of the vulnerability and its potential impact.
2. Steps to reproduce or a proof-of-concept.
3. Any suggested mitigations.

We will acknowledge receipt within **48 hours** and aim to provide a fix or mitigation plan within **7 days** for critical issues.

## Scope

In-scope:
- Smart contract logic vulnerabilities (reentrancy, overflow, auth bypass)
- Signature verification weaknesses
- Storage manipulation or data corruption
- Denial-of-service vectors in contract execution

Out-of-scope:
- Issues in third-party dependencies (report upstream)
- Theoretical attacks without a practical exploit path

## Disclosure Policy

We follow coordinated disclosure. Once a fix is released, we will publish a security advisory crediting the reporter (unless anonymity is requested).

## Dependency Audit Policy

LumenFlow uses automated tooling to continuously monitor third-party Rust dependencies for known vulnerabilities, yanked crates, and licence issues.

### Tools

| Tool | Purpose | Config file |
|------|---------|-------------|
| [`cargo-audit`](https://github.com/rustsec/rustsec/tree/main/cargo-audit) | Scans `Cargo.lock` against the [RustSec Advisory Database](https://rustsec.org) for known CVEs and unmaintained crates | `audit.toml` |
| [`cargo-deny`](https://github.com/EmbarkStudios/cargo-deny) | Blocks duplicate, yanked, or unlicensed crates; enforces allowed source registries | `deny.toml` |

### When audits run

- **Every pull request** — both `cargo-audit` and `cargo-deny` run as required CI checks. A PR cannot be merged if either check fails.
- **Weekly scheduled job** — a cron job runs every Monday at 06:00 UTC. If it finds a new advisory, it automatically opens a GitHub issue labelled `security` and `dependencies`.

### Suppressing an advisory

If an advisory cannot be immediately resolved (e.g. no upstream fix exists), a time-limited ignore entry may be added to `audit.toml`:

```toml
[[advisories.ignore]]
id     = "RUSTSEC-YYYY-XXXX"
reason = "No upstream fix; risk mitigated by <mitigation>."
expiry = "YYYY-MM-DD"   # Must be re-evaluated before this date
```

All suppressed advisories must include a `reason` and an `expiry` date. Entries without both fields will be rejected in code review.
