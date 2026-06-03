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
4. Your contact information and disclosure preferences.

### Secure Reporting

- For encrypted reports, use OpenPGP. Request our public key or fingerprint by emailing **security@lumenflow.dev** before submitting sensitive information.
- If you cannot use PGP, contact us and we will provide an alternative secure channel.

## Response Timeline

We will acknowledge receipt of valid reports within **48 hours**.

Severity response SLAs:

| Severity | Acknowledgement | Fix / Mitigation Plan | Public Disclosure |
|----------|------------------|------------------------|------------------|
| Critical | 48 hours | 7 days | Within 30 days after fix |
| High | 48 hours | 14 days | Within 45 days after fix |
| Medium | 48 hours | 30 days | Within 60 days after fix |
| Low | 48 hours | 60 days | Within 90 days after fix |

We will provide status updates at least every **7 days** until the issue is resolved.

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

## Bug Bounty

We maintain a bug bounty program for eligible reports. Rewards are offered at our discretion based on severity, impact, and quality of the submission. To participate, submit a valid report to **security@lumenflow.dev** and include details sufficient to reproduce the issue.

## Hall of Fame

With the reporter's consent, we will credit acknowledged disclosures in published security advisories and maintain a Hall of Fame for recognized contributors.
