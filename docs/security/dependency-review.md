# Dependency Review Policy

LumenFlow uses the [GitHub Dependency Review Action](https://github.com/actions/dependency-review-action) to block pull requests that introduce new dependencies with known vulnerabilities or incompatible licences.

---

## How It Works

The workflow runs automatically on every pull request that targets the `main` branch. It compares the dependency manifests (e.g. `Cargo.lock`, `package-lock.json`) between the base and head commits, then:

1. Queries the [GitHub Advisory Database](https://github.com/advisories) for any newly introduced packages.
2. Fails the PR check if any new dependency has a vulnerability rated **High** or **Critical**.
3. Fails the PR check if any new dependency is released under a [denied licence](#licence-policy).
4. Posts a summary comment on the PR so reviewers see all findings at a glance.

The workflow is defined at [`.github/workflows/dependency-review.yml`](../../.github/workflows/dependency-review.yml).

---

## Severity Threshold

| Severity | Blocks PR? |
|----------|-----------|
| Critical | ✅ Yes |
| High     | ✅ Yes |
| Moderate | ❌ No (review recommended) |
| Low      | ❌ No |

To adjust the threshold, change the `fail-on-severity` input in the workflow file. Valid values are `critical`, `high`, `moderate`, and `low`.

### Dev-only Dependencies

Vulnerabilities that **only** affect development or test dependencies (e.g. Cargo `[dev-dependencies]`, npm `devDependencies`) do **not** block the PR by default. This prevents noise from test tooling that is never shipped. To enforce stricter rules for dev deps, set `allow-dependencies-licenses: ""` and consult the action documentation.

---

## Licence Policy

Only the following licences are allowed in production dependencies:

| Licence | Notes |
|---------|-------|
| MIT | Project licence — always compatible |
| Apache-2.0 | Compatible with MIT distribution |
| BSD-2-Clause | Permissive |
| BSD-3-Clause | Permissive |
| ISC | Permissive |
| 0BSD | Permissive |
| CC0-1.0 | Public domain dedication |
| Unlicense | Public domain dedication |

The following **copyleft** licences are explicitly denied because they are incompatible with LumenFlow's MIT licence:

- GPL-2.0, GPL-3.0
- LGPL-2.0, LGPL-2.1, LGPL-3.0
- AGPL-3.0

To add or remove allowed/denied licences, update the `allow-licenses` and `deny-licenses` inputs in the workflow file and update this table accordingly.

---

## Bypassing the Check

The dependency review check is a **required status check** on the `main` branch. It cannot be bypassed without repository admin rights. If you believe a finding is a false positive:

1. Open an issue describing the dependency, the advisory ID, and why it should be exempted.
2. A maintainer can add the advisory to the `vulnerability-check-exclude-cvss-scores` or `deny-packages` exemption list after review.

---

## Prerequisites

The Dependency Graph feature must be enabled in the repository:

**Settings → Code security and analysis → Dependency graph → Enable**

Without it, the action cannot compare dependency trees and will fail with an error.

---

## Further Reading

- [GitHub Dependency Review Action](https://github.com/actions/dependency-review-action)
- [GitHub Advisory Database](https://github.com/advisories)
- [SPDX Licence Identifiers](https://spdx.org/licenses/)
- [LumenFlow Security Policy](../../SECURITY.md)
