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

## Security Incident Reporting Checklist

Before submitting a security report, work through the following steps to ensure your report contains all the information needed for triage.

### Step-by-step checklist

1. **Identify and document the issue** — Confirm that the behaviour you observed is a genuine security vulnerability (not a usage error or known limitation). Write a concise title and technical description.

2. **Do NOT disclose publicly** — Do not open a GitHub issue, post on social media, share in Discord, or discuss the details in any public channel before a fix has been released. Public disclosure before a patch is available puts users at risk.

3. **Gather reproduction steps** — Record the exact steps (or a proof-of-concept script) that reliably trigger the vulnerability. Include contract function names, input values, and the observed vs. expected behaviour.

4. **Assess severity** — Estimate the severity using the following scale:
   - **Critical** — Remote exploit, loss of funds, or complete auth bypass with no preconditions
   - **High** — Significant impact requiring attacker privileges or specific conditions
   - **Medium** — Limited impact or difficult to exploit in practice
   - **Low** — Minimal impact; informational or requires chaining with other issues

5. **Prepare your contact info and disclosure preferences** — Decide whether you want to be credited publicly (name / handle) or acknowledged anonymously, and include your preferred contact method in the report.

6. **Send your report to security@lumenflow.dev** — Use the **Report Format** template in the Response Timeline section below. Include all information gathered in the steps above.

7. **Use PGP encryption for sensitive details** — If your report contains exploit code, private keys, or other sensitive material, encrypt the email using our OpenPGP public key. Request the key or fingerprint by emailing **security@lumenflow.dev** first. If you cannot use PGP, contact us and we will arrange an alternative secure channel.

8. **Await acknowledgement within 48 hours** — We will confirm receipt of every valid report within 48 hours. If you do not receive a response within that window, send a follow-up email referencing your original report.

### Confidential reporting

All reports sent to **security@lumenflow.dev** are treated as strictly confidential. Details are shared only with security team members and maintainers who need them to resolve the issue. PGP-encrypted submissions are strongly encouraged for reports that include proof-of-concept exploit code or sensitive reproduction data. Alternative secure channels (e.g., Signal) are available on request.

### What NOT to do

- ❌ Do **not** open a public GitHub issue describing the vulnerability.
- ❌ Do **not** post details on social media, Discord, forums, or any other public platform before a fix is released.
- ❌ Do **not** share exploit code or reproduction steps with anyone outside the security team prior to disclosure.
- ❌ Do **not** attempt to exploit the vulnerability on production or testnet deployments beyond what is necessary to confirm it exists.

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

## Bug Bounty

We maintain a bug bounty program for eligible reports. Rewards are offered at our discretion based on severity, impact, and quality of the submission. To participate, submit a valid report to **security@lumenflow.dev** and include details sufficient to reproduce the issue.

## Hall of Fame

With the reporter's consent, we will credit acknowledged disclosures in published security advisories and maintain a Hall of Fame for recognized contributors.
