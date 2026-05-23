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
4. Whether you want public credit after the issue is fixed.

If you need an encrypted channel, email a request to **security@lumenflow.dev** with
"PGP request" in the subject. The team will provide a current PGP public key or
an alternative secure upload channel before sensitive proof-of-concept material is
shared.

## Response Timeline

We follow the target response times below after receiving a complete report.
Timelines may change if additional information is required from the reporter.

| Severity | Acknowledgement | Triage target | Fix or mitigation target | Disclosure target |
|----------|-----------------|---------------|---------------------------|-------------------|
| Critical | 48 hours | 72 hours | 7 days | After fix release, normally within 30 days |
| High | 48 hours | 5 business days | 14 days | After fix release, normally within 45 days |
| Medium | 48 hours | 10 business days | 30 days | After fix release, normally within 60 days |
| Low | 48 hours | 15 business days | Next planned release | Coordinated with the reporter |

Critical and high severity reports receive priority. If an active exploit is
suspected, the team may publish interim mitigation guidance before the final fix
is released.

## Scope

In-scope:
- Smart contract logic vulnerabilities (reentrancy, overflow, auth bypass)
- Signature verification weaknesses
- Storage manipulation or data corruption
- Denial-of-service vectors in contract execution

Out-of-scope:
- Issues in third-party dependencies (report upstream)
- Theoretical attacks without a practical exploit path

## Bug Bounty

LumenFlow may provide recognition or discretionary rewards for valid, previously
unreported vulnerabilities that materially improve project security. Reward
eligibility depends on severity, report quality, exploitability, and whether the
report follows this policy.

The project does not guarantee a bounty for every report unless a separate,
active bounty campaign explicitly states reward amounts and payment terms.

## Hall of Fame

Reporters who follow coordinated disclosure may be credited in release notes,
security advisories, or a future Hall of Fame section. Credit is optional: tell us
in your report if you prefer anonymity or a specific name/link for attribution.

## Disclosure Policy

We follow coordinated disclosure. Once a fix is released, we will publish a
security advisory crediting the reporter unless anonymity is requested.

Please do not publicly disclose details until a fix or mitigation is available
and a disclosure date has been coordinated with the maintainers.
