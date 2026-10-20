# ADR-008 — Supported Asset Expansion Strategy

| Field | Value |
|-------|-------|
| **Status** | Accepted |
| **Date** | 2026-10-20 |
| **Deciders** | @Gloriachinedu/smart-contract-team, @Gloriachinedu/devops-team |
| **Tags** | security / api / governance |

---

## Context

`docs/supported-asset-expansion-backlog.md` maintains a prioritized list of
tokens candidates for future support in the LumenFlow allowlist. The backlog
documents candidate assets, a scoring rubric, and a rollout checklist, but
there is no formally agreed process governing:

- what criteria an asset must meet before `add_allowed_token` is called on-chain
- what security review steps are required before each addition
- how the community and maintainers vote on whether to add an asset
- how to reverse an addition if a problem is discovered post-deployment

Without a formal process, decisions are ad-hoc, difficult to audit, and could
introduce security or operational risk if a poorly-reviewed asset is enabled.
This ADR establishes the authoritative decision criteria and governance process
that all future asset additions and removals must follow.

---

## Decision

We will institute a formal supported-asset expansion process consisting of four
components: token inclusion criteria, a security review checklist, a governance
vote, and a rollback procedure.  **No new asset may be added to the allowlist
without satisfying all four components.**

### Token Inclusion Criteria

An asset **must** satisfy every hard gate below before it is eligible for a
governance vote:

1. **Stellar Asset Contract (SAC)**: the token must be deployed as a Stellar
   Asset Contract.  Native custom tokens or wrapped tokens not following the
   SEP-41 interface are ineligible.
2. **Audited contract**: the issuing organisation must have published a
   third-party security audit of the token contract within the last 24 months.
   The audit report must be publicly accessible.
3. **Verified issuer**: the issuer must be a regulated financial entity or a
   publicly identifiable organisation with a documented redemption path.
4. **On-chain liquidity minimum**: the asset must demonstrate sustained on-chain
   liquidity of at least **$500,000 USD equivalent** (7-day TWAP) on the Stellar
   DEX at the time of the vote.
5. **No unresolved security findings**: the asset must have no open critical or
   high severity findings in public vulnerability databases or in the audit
   report at the time of the vote.
6. **Clawback policy documented**: the issuer's freeze and clawback policy must
   be documented in the PR; the token config must set `clawback: true` if the
   issuer retains clawback rights, and the refund/dispute flows must be verified
   to handle this case correctly.
7. **Community vote threshold**: the asset must receive a ≥ 66 % approval
   majority in the governance vote (see Governance Process below).

Assets that fail any hard gate may be re-submitted after the gap is resolved.

### Security Review Checklist

Before opening a governance vote, the proposer must open a PR that includes
evidence for each item:

- [ ] SAC contract address verified on-chain (Stellar Explorer link required)
- [ ] Third-party audit report linked, dated within 24 months
- [ ] No known CVEs or open advisories against the token contract at time of submission
- [ ] Rate-limit parameters reviewed: confirm the new asset is covered by
      LumenFlow's existing per-merchant rate limiter and the large-payment
      threshold is appropriate for the asset's decimals
- [ ] Admin key rotation plan documented: confirm the issuer's multi-sig or
      time-lock policy for contract upgrades, and note any admin key risks
- [ ] Clawback path tested: a test demonstrating that LumenFlow's refund flow
      handles a clawback event without loss of funds
- [ ] `add_allowed_token` call simulated on testnet and result recorded in PR
- [ ] SDK constants and generated types updated for the new asset
- [ ] Webhook integration docs updated with the new asset code

The PR must be reviewed by at least one member of both `@smart-contract-team`
and `@devops-team` before the governance vote opens.

### Governance Process

1. **RFC posted**: the proposer posts a Request For Comments in
   [GitHub Discussions — Feature Requests](https://github.com/Gloriachinedu/lumenflow-contracts/discussions/categories/feature-requests)
   with the title `[RFC] Add <ASSET> to supported token allowlist`, linking the
   security review PR and summarising the inclusion criteria evidence.
2. **Comment period**: a minimum **7-day comment period** must elapse before
   a vote is called.  Community members and token issuers may raise objections,
   request additional evidence, or voice support.
3. **Maintainer vote**: after the comment period, maintainers vote using GitHub
   Discussions reactions (👍 approve / 👎 reject).  Quorum requires at least
   **3 maintainer votes**.  The proposal passes with a **≥ 66 % approval**
   majority of votes cast.
4. **Decision recorded**: the outcome (approved or rejected) is recorded as a
   comment in the Discussion thread and the PR is updated to reference the
   Discussion thread.  If rejected, the reason is documented and the asset may
   be re-submitted after addressing the objections.
5. **On-chain execution**: on approval, a maintainer with admin key access calls
   `add_allowed_token` on the target network(s) and posts the transaction hash
   in the PR.  The PR is then merged.

### Rollback Procedure

If a supported asset is found to introduce a security, operational, or
regulatory risk after addition, the following rollback procedure applies:

1. **Incident declared**: a maintainer opens a `[SECURITY]` GitHub Discussion
   thread and notifies the team via Discord, describing the nature of the risk.
2. **Admin calls `remove_allowed_token`**: a maintainer with admin key access
   calls `remove_allowed_token` on all affected networks as quickly as possible.
   This immediately prevents new payments in the affected asset while leaving
   existing payment records intact.
3. **Existing in-flight payments**: any payments initiated before the removal
   that are still in escrow or pending refund are handled according to the
   existing dispute resolution process; the removal does not retroactively
   affect settled payments.
4. **Monitoring period**: after removal, the team monitors the contract for at
   least **72 hours** to confirm no further anomalous activity.
5. **Post-mortem**: within 14 days of the incident, a post-mortem is published
   in `docs/security/` following the vulnerability disclosure policy in
   `docs/security/vulnerability-disclosure-and-incident-response.md`.
6. **Re-addition blocked**: the removed asset cannot be re-added without a new
   full security review and governance vote.

---

## Consequences

### Positive

- All future asset additions are traceable to a documented decision, audit
  trail, and community vote.
- The security review checklist reduces the risk of introducing a token with
  clawback exposure or unreviewed admin key risks.
- The 7-day RFC comment period gives the community visibility before changes
  take effect on-chain.
- The rollback procedure provides a clear, low-latency path to mitigate a bad
  addition.

### Negative / Trade-offs

- The process adds overhead to adding new assets; quick additions are no longer
  possible without following the governance steps.
- Quorum requirements (3 maintainer votes) may slow down decisions if the team
  is small or partially unavailable.
- Liquidity minimums may exclude legitimate but low-volume emerging-market
  stablecoins that are a stated product goal.

### Neutral

- `docs/supported-asset-expansion-backlog.md` continues as the living backlog
  and must be kept up-to-date with the status of each candidate after each
  governance vote.
- This ADR must be linked from the backlog document and referenced in
  `GOVERNANCE.md` under the asset management section.
- Future ADRs may refine the liquidity threshold or voting quorum as the
  project and community grow.

---

## Alternatives Considered

| Alternative | Reason not chosen |
|-------------|------------------|
| Admin-only decision with no community vote | Removes community accountability and makes decisions opaque; inconsistent with the project's open governance model |
| On-chain DAO vote via token holders | LumenFlow does not yet have a governance token; adds significant complexity before the project is mature enough |
| Allowlist any SEP-41 token without review | No security gate; exposes merchants and payers to tokens with clawback, low liquidity, or unreviewed contracts |
| Per-asset RFC with no quorum minimum | Without quorum, a single maintainer could unilaterally approve; undermines the governance intent |

---

## References

- [`docs/supported-asset-expansion-backlog.md`](../supported-asset-expansion-backlog.md) — prioritized candidate backlog
- [`docs/add-supported-token.md`](../add-supported-token.md) — operator-facing CLI steps for adding a token
- [`GOVERNANCE.md`](../../GOVERNANCE.md) — project governance model and RFC process
- [`SECURITY.md`](../../SECURITY.md) — responsible disclosure policy
- [`docs/security/vulnerability-disclosure-and-incident-response.md`](../security/vulnerability-disclosure-and-incident-response.md) — incident response workflow
- [GitHub Discussions — Feature Requests](https://github.com/Gloriachinedu/lumenflow-contracts/discussions/categories/feature-requests)
