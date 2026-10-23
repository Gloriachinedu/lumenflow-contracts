"""
monitoring/redact.py — Log redaction helpers for the LumenFlow exporter.

Applies the redaction rules defined in docs/security/log-redaction.md:

  1. contact_info fields are removed entirely from logged dicts.
  2. Payer / address fields are truncated to first-8 + last-4 characters
     (e.g. ``GAAZI4TC…CCWN``).
  3. Payment amounts are replaced with range-bucket labels rather than
     exact values (e.g. ``<1K``, ``1K–10K``, …).

Usage
-----
    from redact import redact_event

    safe = redact_event(raw_event_dict)
    log.info("Ingested event: %s", safe)

All helpers operate on plain Python dicts / scalars and never raise; malformed
or unexpected values are left unchanged so that the exporter never crashes due
to a redaction error.
"""

from __future__ import annotations

import copy
import re
from typing import Any, Dict

# ---------------------------------------------------------------------------
# Internal constants
# ---------------------------------------------------------------------------

# Keys whose *values* must be removed from any logged dict (case-insensitive).
_CONTACT_INFO_KEYS: frozenset[str] = frozenset(
    {
        "contact_info",
        "contactinfo",
        "contact",
        "email",
        "phone",
        "mobile",
    }
)

# Keys whose values are Stellar addresses and must be truncated.
_ADDRESS_KEYS: frozenset[str] = frozenset(
    {
        "payer",
        "payer_address",
        "payeraddress",
        "initiator",
        "merchant",
        "merchant_address",
        "merchantaddress",
        "address",
        "from",
        "to",
    }
)

# Keys whose values are numeric payment amounts and must be bucketed.
_AMOUNT_KEYS: frozenset[str] = frozenset(
    {
        "amount",
        "refund_amount",
        "refundamount",
        "total",
        "fee",
        "platform_fee",
        "platformfee",
    }
)

# Stellar address regex: G-prefixed, 55 characters total (G + 54 base32 chars).
_STELLAR_ADDR_RE = re.compile(r"\bG[A-Z2-7]{54}\b")

# ---------------------------------------------------------------------------
# Public helpers
# ---------------------------------------------------------------------------


def redact_address(address: str) -> str:
    """Truncate a Stellar address to ``first8…last4`` form.

    Non-address strings are returned unchanged.

    Examples
    --------
    >>> redact_address("GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN")
    'GAAZI4TC…CCWN'
    >>> redact_address("not-an-address")
    'not-an-address'
    """
    if isinstance(address, str) and len(address) >= 12:
        return f"{address[:8]}…{address[-4:]}"
    return address


def amount_bucket(amount: Any) -> str:
    """Map a numeric payment amount (stroops) to a human-readable range label.

    Bucket boundaries (in stroops, where 1 XLM = 10 000 000 stroops):
      - <1K
      - 1K–10K
      - 10K–100K
      - 100K–1M
      - 1M–10M
      - 10M–100M
      - ≥100M

    Non-numeric values are returned as the string ``"<non-numeric>"``.

    Examples
    --------
    >>> amount_bucket(500)
    '<1K'
    >>> amount_bucket(5_000)
    '1K–10K'
    >>> amount_bucket(500_000_000)
    '≥100M'
    """
    try:
        val = int(amount)
    except (TypeError, ValueError):
        return "<non-numeric>"

    if val < 1_000:
        return "<1K"
    if val < 10_000:
        return "1K–10K"
    if val < 100_000:
        return "10K–100K"
    if val < 1_000_000:
        return "100K–1M"
    if val < 10_000_000:
        return "1M–10M"
    if val < 100_000_000:
        return "10M–100M"
    return "≥100M"


def _redact_addresses_in_string(text: str) -> str:
    """Replace any embedded Stellar address in *text* with its truncated form."""
    return _STELLAR_ADDR_RE.sub(lambda m: redact_address(m.group()), text)


def redact_event(event: Dict[str, Any]) -> Dict[str, Any]:
    """Return a *deep copy* of *event* with sensitive fields redacted.

    Rules applied (see ``docs/security/log-redaction.md``):
      - Keys matching ``_CONTACT_INFO_KEYS`` → value replaced with ``"[REDACTED]"``
      - Keys matching ``_ADDRESS_KEYS``      → value truncated via ``redact_address``
      - Keys matching ``_AMOUNT_KEYS``       → value replaced with ``amount_bucket``
      - Any Stellar address found inside a string value → truncated in-place
      - Nested dicts inside ``"value"`` and ``"topic"`` are recursed into

    The original dict is never mutated.
    """
    if not isinstance(event, dict):
        return event  # type: ignore[return-value]

    result: Dict[str, Any] = copy.deepcopy(event)
    _redact_dict(result)
    return result


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _redact_dict(d: Dict[str, Any]) -> None:
    """Mutate *d* in-place, applying redaction to all values."""
    for key in list(d.keys()):
        key_lower = key.lower()
        value = d[key]

        if key_lower in _CONTACT_INFO_KEYS:
            d[key] = "[REDACTED]"

        elif key_lower in _ADDRESS_KEYS:
            if isinstance(value, str):
                d[key] = redact_address(value)
            elif isinstance(value, dict):
                # The value is itself a nested object — recurse so its fields
                # (including contact_info) are still redacted.
                _redact_dict(value)
            # leave other non-string address field types unchanged

        elif key_lower in _AMOUNT_KEYS:
            d[key] = amount_bucket(value)

        elif isinstance(value, dict):
            _redact_dict(value)

        elif isinstance(value, list):
            _redact_list(value, key_lower)

        elif isinstance(value, str):
            # Scrub any raw Stellar address embedded in an arbitrary string value
            d[key] = _redact_addresses_in_string(value)


def _redact_list(lst: list, parent_key: str) -> None:
    """Mutate *lst* in-place, redacting dicts and strings within it."""
    for i, item in enumerate(lst):
        if isinstance(item, dict):
            _redact_dict(item)
        elif isinstance(item, str):
            lst[i] = _redact_addresses_in_string(item)
