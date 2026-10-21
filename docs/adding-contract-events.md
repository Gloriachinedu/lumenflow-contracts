# Contributor Guide: Adding Contract Events

This guide walks you through every step required to add a new event to the LumenFlow Soroban smart contract — from defining the event in Rust through to updating documentation, the SDK, and the monitoring stack.

For the full list of existing events, see [docs/events-reference.md](events-reference.md).  
For the contribution workflow (branch naming, commit messages, PR process), see [CONTRIBUTING.md](../CONTRIBUTING.md).

---

## Overview

A LumenFlow event has three components:

1. **The contract emit call** — `env.events().publish(topics, data)` inside `contracts/lumenflow/src/lib.rs`.
2. **The documentation entry** — a row in the event table in `README.md` and a full schema entry in `docs/events-reference.md`.
3. **The observability hook** — optionally, a new Prometheus metric in `monitoring/lumenflow_exporter.py` and a Grafana panel in `monitoring/grafana-dashboard.json`.

All three components are required for events that carry operational significance (i.e., anything beyond an internal audit trail). Read the checklist at the end of this guide before opening a PR.

---

## Step 1 — Define the Event in Rust

Events are emitted using `env.events().publish(topics, data)`. Topics and data are Soroban `ScVal`s; the Rust SDK serialises them automatically from native types.

### Topic convention

All LumenFlow events follow this topic layout:

```
topic[0]  →  "lumenflow"                (Symbol — contract namespace)
topic[1]  →  "<event_name>"             (Symbol — event identifier)
topic[2]  →  <filterable_address>       (Address — optional; only for merchant/payer-scoped events)
```

Use a **tuple** for the topics argument when there are two topics, or a nested tuple when there is a third filterable address:

```rust
// Two topics (no filterable address):
env.events().publish(("lumenflow", "my_event"), data_value);

// Three topics (with filterable merchant address):
env.events().publish(("lumenflow", "my_event", merchant_address.clone()), data_value);
```

> Only add `topic[2]` when the event is intrinsically scoped to a single address (e.g., a merchant's payment or refund). Global admin events do not need a third topic.

### Data convention

Event data should be the **minimum information a subscriber needs** to act on the event without querying the contract again. Common patterns:

| Data shape | Rust syntax | Use when |
|------------|-------------|---------|
| Single value | `data_value` | One piece of information (e.g., an address) |
| Named tuple | `(field_a, field_b)` | Two or more fields — order is meaningful |
| Unit (empty) | `()` | Pure signal event with no payload needed |

**Do not include data that is already encoded in the topics** (e.g., do not repeat the merchant address in the data if it is already in `topic[2]`).

### Example: a minimal two-topic event

```rust
// In contracts/lumenflow/src/lib.rs, inside the relevant entrypoint:

pub fn my_new_action(env: Env, caller: Address, order_id: String) -> Result<(), PaymentError> {
    // ... validation and state changes ...

    // Emit the event last, after all state mutations succeed.
    env.events().publish(("lumenflow", "my_new_action"), order_id);

    Ok(())
}
```

### Example: a three-topic event (merchant-scoped)

```rust
env.events().publish(
    ("lumenflow", "payment_flagged", merchant_address.clone()),
    (order_id, reason),
);
```

### Ordering rule

Always emit the event **after** all state mutations and validation have succeeded. An event that fires before a function returns `Ok(())` but before storage is committed (which cannot happen in Soroban — storage commits atomically) is fine, but placing the `publish` call at the end of the function body is the convention in this codebase and makes auditing easier.

---

## Step 2 — Write a Contract Test

Every new event must have at least two test cases:

1. **Happy path** — the event is emitted with the correct topics and data.
2. **Failure / edge case** — the event is *not* emitted when the function returns an error.

Tests live in `contracts/lumenflow/src/test.rs`. Use the Soroban testutils `events()` helper to assert emitted events.

### Happy path template

```rust
#[test]
fn test_my_new_action_emits_event() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, PaymentProcessingContract);
    let client = PaymentProcessingContractClient::new(&env, &contract_id);

    // Arrange: set up necessary state
    let admin = Address::generate(&env);
    client.set_admin(&admin);
    // ... other setup ...

    // Act
    let order_id = String::from_str(&env, "ORDER_001");
    client.my_new_action(&caller, &order_id);

    // Assert: verify the event was emitted
    let events = env.events().all();
    // Find the last event emitted by this contract
    let (_, topics, data) = events
        .iter()
        .find(|(cid, t, _)| {
            *cid == contract_id
                && t.get(1) == Some(Val::from(Symbol::new(&env, "my_new_action")))
        })
        .expect("my_new_action event not found");

    // Verify topics
    assert_eq!(topics.get(0).unwrap(), Val::from(Symbol::new(&env, "lumenflow")));
    assert_eq!(topics.get(1).unwrap(), Val::from(Symbol::new(&env, "my_new_action")));

    // Verify data
    let emitted_order_id: String = data.into_val(&env);
    assert_eq!(emitted_order_id, order_id);
}
```

### Failure case template

```rust
#[test]
fn test_my_new_action_error_does_not_emit_event() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, PaymentProcessingContract);
    let client = PaymentProcessingContractClient::new(&env, &contract_id);

    // Attempt the action with invalid inputs that should cause an error
    let result = client.try_my_new_action(&invalid_caller, &String::from_str(&env, ""));
    assert!(result.is_err());

    // Verify no my_new_action event was emitted
    let events = env.events().all();
    let found = events.iter().any(|(cid, t, _)| {
        *cid == contract_id
            && t.get(1) == Some(Val::from(Symbol::new(&env, "my_new_action")))
    });
    assert!(!found, "event must not be emitted on error");
}
```

Run the tests:

```bash
cargo test test_my_new_action --all-features
```

---

## Step 3 — Update docs/events-reference.md

Add a new section for your event, following the existing format. Place it in logical order (admin events first, then merchant, then payment/refund).

```markdown
### `my_new_action`
Brief one-sentence description of what triggered this event.

| Field | Description |
|---|---|
| **Trigger** | Which contract function emits this event. |
| **Topics** | `["lumenflow", "my_new_action"]` |
| **Data** | `order_id: String` |

**Data Details:**
- `order_id`: The unique identifier of the affected order.
```

If `topic[2]` carries a filterable address, document it explicitly:

```markdown
**Topic Details:**
- `topic[0]`: `"lumenflow"` — contract namespace.
- `topic[1]`: `"my_new_action"` — event name.
- `topic[2]`: `merchant_address` — the merchant address. **Filterable.**
```

---

## Step 4 — Update README.md Events Table

Add a row to the events table in the `## Events` section of `README.md`:

```markdown
| `lumenflow/my_new_action` | Description of trigger |
```

The table is sorted by broad category (admin, merchant, payment, refund, multisig, security). Insert the row in the appropriate location.

---

## Step 5 — Update the Monitoring Stack (if applicable)

Not every event needs a Prometheus metric, but events that represent volume, errors, or state changes that on-call engineers need to monitor should be wired up.

### Add a metric to the exporter

Open `monitoring/lumenflow_exporter.py` and:

1. Declare the metric at the top of the file alongside the other `Counter`/`Gauge`/`Histogram` declarations:

   ```python
   my_new_action_total = Counter(
       "lumenflow_my_new_actions_total",
       "Total lumenflow/my_new_action events",
   )
   ```

2. Add a case to the `handle_event` function's event-type dispatch:

   ```python
   elif event_name == "my_new_action":
       my_new_action_total.inc()
   ```

3. Update the metrics reference table in [docs/observability.md](observability.md).

### Add a Grafana panel

1. Open Grafana and edit the **LumenFlow Contract Health** dashboard.
2. Add a panel for `lumenflow_my_new_actions_total` (Counter → rate or total display as appropriate).
3. Save the dashboard and re-export the JSON to `monitoring/grafana-dashboard.json`.
4. Commit the updated JSON.

### Add an alert rule (if the event indicates failure or risk)

If the new event warrants alerting, follow the steps in [docs/observability.md — Adding a new alert rule](observability.md#adding-a-new-alert-rule).

---

## Step 6 — Update the SDK (if the event is relevant to SDK consumers)

If integrators using `@lumenflow/sdk` should be able to subscribe to or decode the new event:

1. Add an event type constant or interface in `sdk/src/events.ts` (or `sdk/src/types.ts` if it is a data type shared with other SDK methods).
2. Update `sdk/src/eventPoller.ts` if the event should be handled by the built-in polling loop.
3. Add a test in `sdk/src/events.test.ts` (or `sdk/src/eventPoller.test.ts`) covering at least the happy path decode.
4. Update the SDK README (`sdk/README.md`) with the new event name and its payload shape.

---

## Checklist

Use this checklist before marking your PR ready for review. Each box corresponds to a step in this guide.

```
[ ] Contract: env.events().publish() call added after all state mutations
[ ] Contract: topics follow the (namespace, event_name[, address]) convention
[ ] Contract: data is minimal — only what subscribers need
[ ] Tests: happy-path test verifies topics and data are correct
[ ] Tests: failure test verifies event is NOT emitted on error
[ ] Tests: cargo test --all-features passes locally
[ ] docs/events-reference.md: new section added with trigger, topics, and data table
[ ] README.md: row added to the Events table
[ ] monitoring/lumenflow_exporter.py: metric added (if operational significance)
[ ] monitoring/grafana-dashboard.json: panel added and JSON re-exported (if applicable)
[ ] docs/observability.md: metrics reference table updated (if metric added)
[ ] sdk/src/events.ts or types.ts: event type added (if SDK-relevant)
[ ] sdk/src/events.test.ts: test added (if SDK-relevant)
[ ] sdk/README.md: event documented (if SDK-relevant)
[ ] CHANGELOG.md: entry added under the appropriate type (feat / fix / security)
[ ] Commit message follows Conventional Commits: feat(events): add my_new_action event
```

---

## Common Mistakes

**Emitting before state is committed:**  
Soroban commits storage atomically with the transaction. Placing `publish` before a `return Err(...)` means the event fires regardless of whether the function errors. Always put `publish` after the last fallible operation.

**Reusing an existing event name:**  
Each event name must be unique within the `lumenflow` namespace. Check `docs/events-reference.md` before choosing a name. Event names use `snake_case`.

**Putting PII in event data:**  
Event logs are permanently on-chain (blockchain-immutable). Never include names, email addresses, or other personal data in event fields. Use addresses (pseudonymous) and IDs only. See [docs/data-classification.md](data-classification.md) for the data classification policy.

**Missing the third topic for merchant-scoped events:**  
If an event is naturally filtered by merchant (payments, refunds), include the merchant address as `topic[2]`. This lets integrators subscribe to only their own events via Horizon SSE or Soroban RPC filter parameters, without the performance cost of downloading all platform events. See [docs/events-reference.md — Filtering by Merchant Address](events-reference.md#filtering-by-merchant-address).

**Not updating the monitoring stack:**  
An event that represents a meaningful operational signal (volume, errors, state changes) without a corresponding Prometheus metric means the on-call team has no visibility. If in doubt, add a simple Counter.

---

## Further Reading

- [docs/events-reference.md](events-reference.md) — all existing events with full schemas
- [docs/observability.md](observability.md) — dashboards, alerts, and on-call runbooks
- [docs/data-classification.md](data-classification.md) — data classification and PII guidance
- [CONTRIBUTING.md](../CONTRIBUTING.md) — branch naming, commit messages, PR process
- [Soroban Events documentation](https://developers.stellar.org/docs/learn/encyclopedia/contract-development/events)
