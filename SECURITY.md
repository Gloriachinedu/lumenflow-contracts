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
