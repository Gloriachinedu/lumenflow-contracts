# ADR-009: Subscription Payment On-Chain Scheduling

## Status

Proposed

> This ADR must be reviewed and approved before the v0.5 subscription payment implementation begins.

## Context

Subscription payments are on the v0.5 roadmap. Subscribers should be charged on a recurring basis (e.g., monthly) without requiring the subscriber to manually sign a transaction for every renewal.

A core design question is **how recurring charges are triggered on-chain**. The smart contract cannot schedule its own execution, so an external actor must call a charge function at (or after) each billing period. The two primary candidates are:

1. **Permissionless caller trigger** — any account may call `charge(subscriber)` once the subscriber's billing period has elapsed.
2. **Admin cron** — a privileged admin (or off-chain cron job holding an admin key) calls a batch charge function on a schedule.

The chosen mechanism affects trust assumptions, liveness guarantees, gas costs, and operational complexity. This ADR records the alternatives considered and the decision.

## Decision Drivers

- **Liveness**: charges must happen reliably; a missed charge should not silently break the subscription.
- **Trust minimization**: subscribers should not have to trust a single privileged operator to collect payments.
- **Cost**: gas costs for recurring charges, including who pays them.
- **Operational complexity**: key management, monitoring, and failure recovery for any off-chain component.
- **Failure handling**: behavior when a charge fails (insufficient balance, allowance, etc.).
- **Composability**: ability for third parties (keepers, bots, integrators) to participate.

## Alternatives Considered

### Alternative A: Permissionless Caller Trigger

Any account may call a `charge(subscriber)` function. The contract enforces that the subscriber's billing period has elapsed and that the charge is valid; otherwise it reverts. The caller (whoever it is) may be compensated with a small keeper fee, or may simply be the subscriber or an interested party.

**Pros**
- No privileged operator; trust minimized.
- Liveness is provided by open participation (keepers, bots, integrators, or the subscriber themselves).
- No admin key to manage or compromise.
- Naturally composable with existing keeper networks.

**Cons**
- Requires an incentive (keeper fee) or altruism to guarantee timely execution.
- One transaction per subscriber unless batching is added, which can be gas-heavy at scale.
- Potential for front-running/griefing around the exact billing boundary (mitigated by idempotent, period-checked charges).

### Alternative B: Admin Cron

A privileged admin account (or an off-chain cron job holding an admin key) calls a batch `chargeDue()` function on a fixed schedule.

**Pros**
- Simple to reason about; a single operator drives all charges.
- Batching amortizes gas across many subscribers.
- Deterministic schedule controlled by the operator.

**Cons**
- Introduces a privileged role and a single point of failure/liveness dependency.
- Admin key becomes a high-value target; compromise or loss halts all billing.
- Subscribers must trust the operator to charge them (and to not over-charge).
- Operational overhead: monitoring, alerting, key rotation, failover.

### Alternative C (considered, not selected): Hybrid

Permissionless trigger with an optional admin-assisted batch path for catch-up. This combines both but adds complexity; it can be layered on top of Alternative A later if needed.

## Decision

Adopt **Alternative A: Permissionless Caller Trigger** as the primary scheduling mechanism for v0.5 subscription payments.

The contract exposes a permissionless `charge(subscriber)` entry point that:
- verifies the subscriber's billing period has elapsed,
- verifies the charge amount and payment authorization (allowance/approval),
- is idempotent within a billing period (cannot double-charge),
- optionally pays a small keeper fee to the caller to incentivize timely execution.

An admin-assisted batch path (Alternative C) is explicitly deferred and may be added in a future version if permissionless liveness proves insufficient in practice.

## Rationale

- **Trust minimization** aligns with the project's non-custodial principles: subscribers are not dependent on a single operator to collect or to avoid being over-charged.
- **Liveness without a privileged key** removes the operational and security burden of managing a high-value admin key for billing.
- **Composability** lets existing keeper infrastructure and integrators participate, reducing the need to build bespoke cron infrastructure.
- **Simplicity of trust model** outweighs the marginal gas savings of batching for the expected v0.5 scale; batching can be revisited if volume warrants it.

## Consequences

**Positive**
- No privileged billing role; smaller attack surface.
- Charges can be driven by keepers, bots, integrators, or subscribers themselves.
- Clear, auditable on-chain rules for when a charge is valid.

**Negative / Risks**
- Timely execution depends on incentives; a keeper fee (or equivalent) must be designed and budgeted.
- Per-subscriber transactions may be more expensive at scale than batched admin charges.
- Requires careful, idempotent period accounting to prevent double charges and griefing at period boundaries.

**Follow-ups**
- Define the keeper fee model and funding source.
- Specify failure handling (insufficient balance/allowance) and retry semantics.
- Add tests for idempotency, period boundaries, and unauthorized/early charge attempts.
- Re-evaluate a hybrid batch path if permissionless liveness is insufficient.

## References

- `docs/adr/ADR-000-template.md` — ADR template used for this document.
- `docs/backlog.md` — subscription backlog entry (linked to this ADR).