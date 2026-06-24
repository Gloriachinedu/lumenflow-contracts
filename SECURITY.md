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

### Report Format

To facilitate triage and investigation, please structure your security report as:

```
Title: [Concise vulnerability title]

Severity: Critical | High | Medium | Low

Affected Component: [Contract function, SDK method, or deployment process]

Description: [Technical description and impact]

Proof of Concept: [Steps to reproduce]

Recommended Fix: [Suggested mitigation or patch]
```

## Scope

In-scope:
- Smart contract logic vulnerabilities (reentrancy, overflow, auth bypass)
- Signature verification weaknesses
- Storage manipulation or data corruption
- Denial-of-service vectors in contract execution
- SDK cryptographic or data handling issues

Out-of-scope:
- Issues in third-party dependencies (report upstream)
- Theoretical attacks without a practical exploit path

## Incident Response Playbook

### Critical Vulnerability (Severity: Critical)

1. **Immediate Action (0-2 hours)**
   - Acknowledge receipt to reporter
   - Convene security team
   - Begin development of fix or mitigation

2. **Assessment (2-12 hours)**
   - Confirm exploit path
   - Identify blast radius (which contracts/deployments affected)
   - Assess production impact

3. **Response (12-72 hours)**
   - Release patched contract code
   - Coordinate with deployment team
   - Publish security advisory (after fix deployed)

### High/Medium Vulnerability (Severity: High or Medium)

1. **Assessment (24 hours)**
   - Confirm issue and determine scope
   - Develop fix or mitigation

2. **Resolution (3-7 days)**
   - Release fix
   - Publish advisory

### Low Vulnerability

- Follow standard issue/PR process
- Include fix in next planned release

## Security Monitoring and Escalation Path

### Monitoring

- **Contract Events:** Monitor `suspicious_activity` events emitted when payment thresholds are exceeded.
- **Deployment Status:** Track contract version and admin changes via `admin_set` events.
- **Automated Alerts:** Set up webhook integrations on security@lumenflow.dev for critical contract events.

### Escalation

1. **Tier 1:** Security team receives report
2. **Tier 2:** Project maintainers convened for critical issues
3. **Tier 3:** Executive/legal review for disclosure decisions

Contact the security team at **security@lumenflow.dev** or via [SUPPORT.md](SUPPORT.md) for additional questions.

## Disclosure Policy

We follow coordinated disclosure. Once a fix is released, we will publish a security advisory crediting the reporter (unless anonymity is requested).
