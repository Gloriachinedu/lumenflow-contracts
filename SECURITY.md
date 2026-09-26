# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.x     | ✅        |

## Reporting a Vulnerability

> **Team-facing workflow:** the operational process behind this policy — intake,
> triage, roles, incident lifecycle, advisory publication, and post-incident
> review — is documented in
> [docs/security/vulnerability-disclosure-and-incident-response.md](docs/security/vulnerability-disclosure-and-incident-response.md).
> A machine-readable pointer for researchers lives at
> [`.well-known/security.txt`](.well-known/security.txt), and the step-by-step
> operator guide is the
> [Incident Response Runbook](docs/runbooks/incident-response-runbook.md).

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

## Admin Key Rotation

The contract admin key controls all privileged operations. A documented rotation procedure is required to maintain security posture across key holder changes, suspected compromises, and regular rotation cycles.

**See [docs/admin-key-rotation.md](docs/admin-key-rotation.md) for the full key rotation runbook**, including:

- Planned rotation step-by-step using `transfer_admin`
- Hardware Security Module (HSM) setup requirements for production
- Emergency rotation procedure for a compromised key
- Two-person integrity requirements (all production rotations must be witnessed)
- Post-rotation verification checklist

## Incident Response Playbook

> Full workflow with roles, incident lifecycle phases, and failure/boundary
> handling: [docs/security/vulnerability-disclosure-and-incident-response.md](docs/security/vulnerability-disclosure-and-incident-response.md).
> Copy-paste operator steps: [docs/runbooks/incident-response-runbook.md](docs/runbooks/incident-response-runbook.md).

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

---

## Emergency Pause Mechanism

The contract has a built-in emergency pause mechanism designed to limit blast radius when a critical vulnerability is discovered. This section describes the available tools and the procedures for using them.

### Pause functions

| Function | Who can call | Effect |
|----------|-------------|--------|
| `pause_contract(admin)` | Admin | Immediately pauses all state-mutating functions. No timelock. Use for routine maintenance. |
| `pause_with_reason(admin, reason)` | Admin | Pauses with a recorded reason and activates a **7-day unpause timelock**. Use for security incidents. |
| `unpause_contract(admin)` | Admin | Unpauses. If the contract was paused via `pause_with_reason`, this call is blocked until the 7-day timelock expires. |
| `approve_early_unpause(guardian)` | Registered pause guardian | Casts one vote for early unpause. When **3 out of 5 guardians** have approved, the contract unpauses automatically and the timelock is cleared. |
| `set_pause_guardians(admin, guardians)` | Admin | Registers the 5 authorized pause guardian addresses. Must be called before an emergency. |

### When to use `pause_with_reason`

Use `pause_with_reason` (not `pause_contract`) for security incidents. It:

1. Records the reason on-chain, giving auditors and users immediate context.
2. Emits the reason in the `contract_paused` event so off-chain monitors surface it instantly.
3. Sets a 7-day timelock that prevents a compromised admin key from silently unpausing after an exploit.

### Emergency pause procedure

1. **Detect** the vulnerability — via monitoring, bug report, or automated alert.
2. **Pause immediately:**
   ```bash
   stellar contract invoke --id $CONTRACT_ID --source-account $ADMIN_KEY --network mainnet \
     -- pause_with_reason \
     --admin $ADMIN_ADDR \
     --reason "Critical vulnerability CVE-YYYY-NNNNN: reentrancy in execute_refund"
   ```
3. **Confirm** the pause event is visible on Horizon:
   ```bash
   stellar contract invoke --id $CONTRACT_ID -- get_contract_version
   # Should return error ContractPaused (70)
   ```
4. **Investigate** and develop a patch. The 7-day timelock gives the team time to audit, fix, and deploy before any pressure to unpause.
5. **Deploy patched WASM** (admin only, contract must remain paused during upgrade).
6. **Unpause** — two paths:
   - **Standard:** Wait for the 7-day timelock to expire, then call `unpause_contract`.
   - **Early (3-of-5 multisig):** Have 3 of the 5 registered guardians each call `approve_early_unpause` from their own key. The contract unpauses automatically on the third approval.

### Setting up pause guardians

Before any incident occurs, register the 5 guardian addresses. These should be held by distinct individuals (e.g. core team members) on separate key management systems.

```bash
stellar contract invoke --id $CONTRACT_ID --source-account $ADMIN_KEY --network mainnet \
  -- set_pause_guardians \
  --admin $ADMIN_ADDR \
  --guardians '["G...GUARDIAN1","G...GUARDIAN2","G...GUARDIAN3","G...GUARDIAN4","G...GUARDIAN5"]'
```

### Early unpause example (3-of-5 multisig override)

```bash
# Guardian 1
stellar contract invoke --id $CONTRACT_ID --source-account $GUARDIAN1_KEY --network mainnet \
  -- approve_early_unpause --guardian $GUARDIAN1_ADDR

# Guardian 2
stellar contract invoke --id $CONTRACT_ID --source-account $GUARDIAN2_KEY --network mainnet \
  -- approve_early_unpause --guardian $GUARDIAN2_ADDR

# Guardian 3 — triggers auto-unpause
stellar contract invoke --id $CONTRACT_ID --source-account $GUARDIAN3_KEY --network mainnet \
  -- approve_early_unpause --guardian $GUARDIAN3_ADDR
```

The `contract_unpaused` event will include `("multisig_override",)` in its data payload, distinguishing it from a standard admin unpause.

### Monitoring the pause state

Subscribe to `contract_paused` and `contract_unpaused` events via the Horizon SSE stream:

```
GET https://horizon.stellar.org/contracts/{CONTRACT_ID}/events
    ?cursor=now&topic1=lumenflow&topic2=contract_paused
```

The data payload of a `contract_paused` event from `pause_with_reason` contains `(reason: String, lock_until: u64)` where `lock_until` is the Unix timestamp after which the admin can unpause without guardian approval.

