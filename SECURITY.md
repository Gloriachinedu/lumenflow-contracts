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

## Frontend Content Security Policy

The current frontend pages do not yet enforce a Content-Security-Policy. Before
adding a policy that restricts scripts to the local origin, the inline scripts
and event-handler attributes in `frontend/receipt.html` and
`frontend/multisig.html` must be moved into same-origin files. The receipt and
multisig pages also load the Stellar SDK from jsDelivr; that dependency must be
self-hosted or bundled before a self-hosted-only `script-src` can be enabled
without breaking the pages.

Once those prerequisites are complete, add and verify a strict policy on every
frontend HTML page, including pages added later. Browser testing must confirm
that wallet-extension interaction still works and that intentional RPC
requests are permitted without allowing inline script execution.

## Disclosure Policy

We follow coordinated disclosure. Once a fix is released, we will publish a security advisory crediting the reporter (unless anonymity is requested).
