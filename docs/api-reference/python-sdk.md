# Python SDK (Upcoming)

> **Status: Draft / Stub** — The Python SDK is not yet implemented. This page is a proposal to gather community feedback on the desired API shape. Nothing here is final and everything is subject to change.

The LumenFlow Python SDK will provide a simple, Pythonic interface to the LumenFlow payments API. This document proposes the initial API surface so the community can review and comment before implementation begins.

## Feedback

We want to hear from you! Please share your thoughts on the proposed API surface in the linked GitHub Discussion:

- **[GitHub Discussion: Python SDK API Design](#)** — propose changes, request features, or report concerns about the API shape below.

## Installation (planned)

```bash
pip install lumenflow
```

## Quick Start (proposed)

```python
from lumenflow import LumenFlowClient

client = LumenFlowClient(api_key="your-api-key")

payment = client.process_payment(
    amount=1000,
    currency="USD",
    payment_method="card",
    metadata={"order_id": "12345"},
)

print(payment.id)
```

## API Surface (proposed)

### `LumenFlowClient`

The main entry point for interacting with the LumenFlow API.

```python
client = LumenFlowClient(
    api_key="your-api-key",
    base_url="https://api.lumenflow.example",  # optional
    timeout=30,                                 # optional, seconds
)
```

| Parameter  | Type  | Required | Description                                              |
|------------|-------|----------|----------------------------------------------------------|
| `api_key`  | `str` | Yes      | Your LumenFlow API key.                                  |
| `base_url` | `str` | No       | Override the API base URL (useful for testing).          |
| `timeout`  | `int` | No       | Request timeout in seconds. Defaults to `30`.            |

---

### `process_payment`

Create and process a new payment.

```python
payment = client.process_payment(
    amount=1000,
    currency="USD",
    payment_method="card",
    metadata={"order_id": "12345"},
)
```

| Parameter        | Type             | Required | Description                                              |
|------------------|------------------|----------|----------------------------------------------------------|
| `amount`         | `int`            | Yes      | Amount in the smallest currency unit (e.g. cents).       |
| `currency`       | `str`            | Yes      | ISO 4217 currency code (e.g. `"USD"`).                   |
| `payment_method` | `str`            | Yes      | Payment method identifier (e.g. `"card"`).               |
| `metadata`       | `dict[str, str]` | No       | Arbitrary key-value data attached to the payment.        |

Returns a `Payment` object.

---

### `get_payment`

Retrieve a single payment by its identifier.

```python
payment = client.get_payment("pay_123456")
```

| Parameter    | Type  | Required | Description                       |
|--------------|-------|----------|-----------------------------------|
| `payment_id` | `str` | Yes      | The unique payment identifier.    |

Returns a `Payment` object.

---

### `list_payments`

List payments, with optional filtering and pagination.

```python
payments = client.list_payments(
    status="succeeded",
    limit=20,
    starting_after="pay_123456",
)

for payment in payments:
    print(payment.id, payment.amount)
```

| Parameter        | Type  | Required | Description                                              |
|------------------|-------|----------|----------------------------------------------------------|
| `status`         | `str` | No       | Filter by payment status (e.g. `"succeeded"`).           |
| `limit`          | `int` | No       | Maximum number of results to return. Defaults to `20`.   |
| `starting_after` | `str` | No       | Cursor for pagination; returns results after this ID.    |

Returns an iterable of `Payment` objects.

## Open Questions

The following design decisions are still under discussion — please weigh in on the GitHub Discussion:

- Should methods be synchronous by default, with an async variant (`AsyncLumenFlowClient`)?
- Should responses be plain dataclasses, `dict`s, or typed models (e.g. Pydantic)?
- How should errors be surfaced (exceptions vs. result objects)?
- Should pagination be automatic (lazy iterators) or explicit cursors?

## See Also

- [API Reference Overview](./README.md)
- [GitHub Discussion: Python SDK API Design](#)

---

*This page is a draft and will be updated as the SDK design progresses.*