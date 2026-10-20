"""
monitoring/test_redact.py — Unit tests for the log redaction helpers.

Run with:
    cd monitoring && python -m pytest test_redact.py -v

Covers the acceptance criteria from issue #1261:
  - contact_info fields never appear in logs
  - Payer addresses truncated to first 8 + last 4 characters
  - Payment amounts replaced with range buckets
"""

import pytest
from redact import redact_event, redact_address, amount_bucket


# ---------------------------------------------------------------------------
# redact_address
# ---------------------------------------------------------------------------

class TestRedactAddress:
    def test_stellar_address_truncated(self):
        addr = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN"
        assert redact_address(addr) == "GAAZI4TC\u2026CCWN"

    def test_short_string_unchanged(self):
        assert redact_address("short") == "short"

    def test_non_string_unchanged(self):
        assert redact_address(12345) == 12345  # type: ignore[arg-type]

    def test_empty_string_unchanged(self):
        assert redact_address("") == ""

    def test_exactly_12_chars_truncated(self):
        s = "GABCDEFGHIJK"
        result = redact_address(s)
        assert result == "GABCDEFG\u2026HIJK"


# ---------------------------------------------------------------------------
# amount_bucket
# ---------------------------------------------------------------------------

class TestAmountBucket:
    def test_below_1k(self):
        assert amount_bucket(0)   == "<1K"
        assert amount_bucket(999) == "<1K"

    def test_1k_to_10k(self):
        assert amount_bucket(1_000)  == "1K\u201310K"
        assert amount_bucket(9_999)  == "1K\u201310K"

    def test_10k_to_100k(self):
        assert amount_bucket(10_000) == "10K\u2013100K"

    def test_100k_to_1m(self):
        assert amount_bucket(100_000) == "100K\u20131M"

    def test_1m_to_10m(self):
        assert amount_bucket(1_000_000) == "1M\u201310M"

    def test_10m_to_100m(self):
        assert amount_bucket(10_000_000) == "10M\u2013100M"

    def test_above_100m(self):
        assert amount_bucket(100_000_000) == "\u2265100M"
        assert amount_bucket(999_999_999) == "\u2265100M"

    def test_non_numeric(self):
        assert amount_bucket("not-a-number") == "<non-numeric>"
        assert amount_bucket(None)            == "<non-numeric>"

    def test_string_numeric(self):
        # Horizon sometimes returns amounts as strings
        assert amount_bucket("5000") == "1K\u201310K"


# ---------------------------------------------------------------------------
# redact_event — contact_info never appears in logs
# ---------------------------------------------------------------------------

class TestContactInfoRedacted:
    def test_top_level_contact_info_redacted(self):
        event = {"topic": ["lumenflow", "merchant_registered"],
                 "value": {"contact_info": "merchant@example.com", "name": "Acme"}}
        safe = redact_event(event)
        assert safe["value"]["contact_info"] == "[REDACTED]"
        # Non-sensitive fields are preserved
        assert safe["value"]["name"] == "Acme"

    def test_nested_contact_info_redacted(self):
        event = {"topic": ["lumenflow", "admin_set"],
                 "value": {"merchant": {"contact_info": "secret@corp.com"}}}
        safe = redact_event(event)
        assert safe["value"]["merchant"]["contact_info"] == "[REDACTED]"

    def test_contact_info_case_insensitive(self):
        event = {"value": {"ContactInfo": "555-1234"}}
        safe = redact_event(event)
        assert safe["value"]["ContactInfo"] == "[REDACTED]"


# ---------------------------------------------------------------------------
# redact_event — payer addresses truncated
# ---------------------------------------------------------------------------

FULL_ADDR = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN"
TRUNCATED = "GAAZI4TC\u2026CCWN"

class TestPayerAddressTruncated:
    def test_payer_field_truncated(self):
        event = {"value": {"payer": FULL_ADDR, "amount": 1000}}
        safe = redact_event(event)
        assert safe["value"]["payer"] == TRUNCATED

    def test_payer_address_field_truncated(self):
        event = {"value": {"payer_address": FULL_ADDR}}
        safe = redact_event(event)
        assert safe["value"]["payer_address"] == TRUNCATED

    def test_initiator_field_truncated(self):
        event = {"value": {"initiator": FULL_ADDR}}
        safe = redact_event(event)
        assert safe["value"]["initiator"] == TRUNCATED

    def test_address_embedded_in_string_scrubbed(self):
        event = {"value": {"memo": f"payment from {FULL_ADDR} processed"}}
        safe = redact_event(event)
        assert FULL_ADDR not in safe["value"]["memo"]
        assert TRUNCATED in safe["value"]["memo"]

    def test_multiple_addresses_in_string_all_scrubbed(self):
        addr2 = "GBUYUAI75XXWDZEKLY66CFYKQPET5JR4EAPL7STQKQCRLKJ74SC65VU"
        event = {"value": {"note": f"From {FULL_ADDR} to {addr2}"}}
        safe = redact_event(event)
        assert FULL_ADDR not in safe["value"]["note"]
        assert addr2 not in safe["value"]["note"]


# ---------------------------------------------------------------------------
# redact_event — amounts replaced with range buckets
# ---------------------------------------------------------------------------

class TestAmountBucketed:
    def test_amount_field_bucketed(self):
        event = {"value": {"amount": 5_000_000}}
        safe = redact_event(event)
        assert safe["value"]["amount"] == "1M\u201310M"

    def test_refund_amount_bucketed(self):
        event = {"value": {"refund_amount": 50_000}}
        safe = redact_event(event)
        assert safe["value"]["refund_amount"] == "10K\u2013100K"

    def test_platform_fee_bucketed(self):
        event = {"value": {"platform_fee": 250}}
        safe = redact_event(event)
        assert safe["value"]["platform_fee"] == "<1K"

    def test_amount_as_string_bucketed(self):
        event = {"value": {"amount": "10000000"}}
        safe = redact_event(event)
        assert safe["value"]["amount"] == "10M\u2013100M"


# ---------------------------------------------------------------------------
# redact_event — original dict is not mutated
# ---------------------------------------------------------------------------

class TestImmutability:
    def test_original_unchanged(self):
        original = {"value": {"payer": FULL_ADDR, "amount": 9_999, "contact_info": "x@y.com"}}
        redact_event(original)
        assert original["value"]["payer"] == FULL_ADDR
        assert original["value"]["amount"] == 9_999
        assert original["value"]["contact_info"] == "x@y.com"


# ---------------------------------------------------------------------------
# redact_event — non-sensitive fields preserved
# ---------------------------------------------------------------------------

class TestNonSensitiveFieldsPreserved:
    def test_event_name_and_ledger_preserved(self):
        event = {
            "topic": ["lumenflow", "payment_processed"],
            "ledger": 123456,
            "id": "event-id-abc",
            "value": {"order_id": "ORDER_001", "amount": 1000},
        }
        safe = redact_event(event)
        assert safe["ledger"] == 123456
        assert safe["id"] == "event-id-abc"
        assert safe["value"]["order_id"] == "ORDER_001"

    def test_empty_event_handled(self):
        assert redact_event({}) == {}

    def test_non_dict_passthrough(self):
        assert redact_event("not a dict") == "not a dict"  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# Full realistic event
# ---------------------------------------------------------------------------

class TestFullEventRedaction:
    def test_payment_processed_event(self):
        event = {
            "topic": ["lumenflow", "payment_processed"],
            "ledger": 54321,
            "paging_token": "tok123",
            "value": {
                "order_id": "ORDER_001",
                "payer": FULL_ADDR,
                "merchant": "GBUYUAI75XXWDZEKLY66CFYKQPET5JR4EAPL7STQKQCRLKJ74SC65VU",
                "amount": 10_000_000,
                "contact_info": "merchant@example.com",
            },
        }
        safe = redact_event(event)

        val = safe["value"]
        # contact_info hidden
        assert val["contact_info"] == "[REDACTED]"
        # payer address truncated
        assert val["payer"] == TRUNCATED
        assert FULL_ADDR not in val["payer"]
        # merchant address truncated
        assert FULL_ADDR not in val["merchant"]
        # amount bucketed
        assert val["amount"] == "10M\u2013100M"
        # non-sensitive preserved
        assert val["order_id"] == "ORDER_001"
        assert safe["ledger"] == 54321
