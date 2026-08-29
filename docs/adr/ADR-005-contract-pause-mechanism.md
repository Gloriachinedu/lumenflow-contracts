# ADR-005 — Contract Pause / Circuit-Breaker Mechanism

| Field | Value |
|-------|-------|
| **Status** | Accepted |
| **Date** | 2026-02-01 |
| **Deciders** | @Gloriachinedu |
| **Tags** | security / admin / circuit-breaker |

---

## Context

Production smart contracts handling real funds need an emergency stop mechanism. If a critical vulnerability is discovered — or if suspicious on-chain activity is detected — operators must be able to halt payment processing immediately without deploying a contract upgrade (which requires governance approval and takes time).

LumenFlow's `lumenflow/suspicious_activity` event is emitted when anomalous behaviour is detected (e.g. a payment above `LargePaymentThreshold`), but the event alone does not stop processing. An off-chain monitoring system can observe the event but cannot stop the contract.

Three approaches were considered:

1. **No pause mechanism** — rely solely on off-chain monitoring and fast contract upgrades.
2. **Admin-controlled global pause flag** stored in instance storage — admin can flip a boolean that all state-changing functions check.
3. **Per-function pause flags** — individual functions can be paused independently.

---

## Decision

We will implement a **global pause flag** stored as an instance storage key `Paused: bool`.

All state-changing contract functions check this flag at entry:

```rust
if is_paused(env) {
    return Err(ContractError::ContractPaused);
}
```

Only the admin can pause and unpause the contract via `pause_contract(admin)` and `unpause_contract(admin)`.

Read-only functions (`get_merchant`, `get_payment_by_id`, `get_refund`, `get_global_payment_stats`) are **not gated** by the pause flag, so integrators can still query state during a pause.

---

## Consequences

### Positive
- Admin can halt all fund movements within a single transaction if a vulnerability is detected.
- Simple implementation: one boolean check at function entry.
- Read-only queries continue working during pause, allowing operators to audit state.
- The `lumenflow/contract_paused` and `lumenflow/contract_unpaused` events provide an auditable trail.

### Negative / Trade-offs
- The pause mechanism introduces admin centralisation: a compromised admin key can pause the contract maliciously, denying service to all users.
- A paused contract still accrues storage rent — operators must unpause or migrate before rent runs out.
- There is no time-limited auto-unpause; operators must manually unpause after the incident is resolved.

### Neutral
- Future work: consider a multisig admin or a time-lock on pause duration to reduce centralisation risk.
- The `suspicious_activity` event can be used by off-chain monitoring to trigger an automatic pause call via a bot, but this is not implemented in the contract.

---

## Circuit-Breaker Integration

The `suspicious_activity` event (emitted by `check_suspicious_activity` in `helper.rs`) can be used as a trigger for an off-chain monitoring bot to call `pause_contract` automatically:

```
[Horizon SSE] lumenflow/suspicious_activity event received
      ↓
[monitoring bot] calls stellar contract invoke -- pause_contract --admin $ADMIN
      ↓
[contract] Paused = true; all state-changing calls return ContractError::ContractPaused
```

See [docs/monitoring.md](../monitoring.md) for alert setup.

---

## Alternatives Considered

| Alternative | Reason not chosen |
|-------------|------------------|
| No pause mechanism | Unacceptable for a production payment contract — no emergency stop |
| Per-function pause flags | Higher complexity; operators must pause multiple functions; risk of missing one |
| Upgrade-based halt | Upgrade governance is slow; insufficient for emergency response |
| Multisig-required pause | Adds safety but increases response time; suitable for a future v2 |

---

## References

- `contracts/lumenflow/src/lib.rs` — `pause_contract`, `unpause_contract`, `is_paused` guard
- `contracts/lumenflow/src/storage.rs` — `DataKey::Paused` (instance storage)
- `contracts/lumenflow/src/error.rs` — `ContractError::ContractPaused`
- [docs/monitoring.md](../monitoring.md) — Alert thresholds and Horizon SSE streaming
- [docs/auth-model.md](../auth-model.md) — Admin role definition
