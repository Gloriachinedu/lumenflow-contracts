# Batch-79 Feature Implementations

## #1103: Merchant Payout Schedule Configuration

### Changes Required:
1. **Contract (src/lib.rs)**:
   - Add `PayoutSchedule` enum: `Immediate | DailyBatch | WeeklyBatch`
   - Add `payout_schedule: PayoutSchedule` field to `MerchantProfile` struct
   - Update `update_merchant()` to accept `payout_schedule` parameter
   - Update `get_merchant()` to return full `MerchantProfile` including payout_schedule

2. **Dashboard (dashboard/merchant-dashboard/app.js)**:
   - Add payout schedule select dropdown in settings/profile section
   - Options: "Immediate", "Daily Batch", "Weekly Batch"
   - Load current schedule on page load
   - Save changes via `update_merchant()` call

3. **Documentation (docs/merchant-onboarding.md)**:
   - Add "Configuring Payout Schedule" section
   - Explain each schedule option and use cases

---

## #1102: Threat Model Review for Batch Payment Flow

### Documentation (docs/audit/threat-model-payment-refund-flows.md):

#### New Section: Batch Payment Attack Surface

**Threat 1: Mixed Valid/Invalid Items**
- Attack: Submit batch with mix of valid and invalid payees
- Impact: Partial processing, accounting inconsistency
- Mitigation: All-or-nothing batch validation; failed batch halts entire operation
- Detection: Batch status field records rejection reason

**Threat 2: Authorization Bypass**
- Attack: Forge batch authorization signature
- Impact: Unauthorized payouts from merchant account
- Mitigation: Signature verification using merchant's public key; nonce-based replay protection
- Detection: Authorization validation logs

**Threat 3: Gas Exhaustion**
- Attack: Submit batch with extremely large item count (10000+)
- Impact: Transaction fails mid-processing, wasted gas, incomplete payouts
- Mitigation: MAX_BATCH_SIZE limit (100 items); cost estimation before execution
- Detection: Batch size validation on submission

**Threat 4: Double-Spending via Batch Resubmission**
- Attack: Resubmit same batch multiple times to trigger duplicate payouts
- Impact: Multiple payouts for single merchant intent
- Mitigation: Batch ID tracking; idempotency via hash-based deduplication
- Detection: Duplicate batch ID rejection

### Linked From:
- docs/audit/audit-report-v1.0.md: "Batch Payment Security Analysis" reference

### Reviewed By:
- [External Security Reviewer Name/Date]

---

## #1101: Receipt Page PII Data Minimization

### Changes Required:

1. **Receipt Page (dashboard/receipt/receipt.html)**:
   - Truncate wallet addresses: `GCABC...WXYZ` (first 6 + last 4 chars)
   - Add "Show Full Address" button that:
     - Reveals full address
     - Provides "Copy to Clipboard" functionality
   - Only show memo field if non-empty (hide if falsy/null)
   - Add privacy notice banner linking to `docs/receipt-privacy-audit.md`

2. **JavaScript (dashboard/receipt/receipt.js)**:
   - Implement `truncateAddress(addr)` function
   - Implement `toggleFullAddress()` and `copyToClipboard()` handlers
   - Update render logic: only include memo if `payment.memo`

3. **Documentation (docs/receipt-privacy-audit.md)**:
   - Update "Implemented Mitigations" section
   - Document address truncation default behavior
   - Document expand/copy functionality

---

## #1105: Merchant Revenue Analytics Dashboard

### Changes Required:

1. **Dashboard Enhancement (dashboard/merchant-dashboard/app.js)**:
   - Add new "Analytics" tab/section
   - Display metrics:
     * Total Revenue (last 30 days)
     * Average Order Value
     * Payment Count Trend Chart (line chart, x=date, y=count)
   
   - Data source: `get_merchant_stats()` contract call

2. **Time Range Selector**:
   - Radio buttons or dropdown: "7 days", "30 days", "90 days"
   - Reload analytics on selection change
   - Update chart date range accordingly

3. **Accessibility**:
   - Charts use `<figure>` with `<figcaption>`
   - Provide data table alternative for screen readers
   - ARIA labels on interactive elements
   - Keyboard navigation support

4. **Responsive Design**:
   - Charts stack vertically on mobile (< 768px width)
   - Maintain readability on small screens
   - Touch-friendly interactive elements

5. **Chart Implementation**:
   - Use Chart.js or similar lightweight library
   - Payment count trend: show day-by-day or week-by-week aggregates
   - Display confidence intervals or actual data points

---

## Implementation Order (Priority):

1. **#1103** - Payout schedule config (feature enablement)
2. **#1101** - Receipt PII minimization (security/privacy)
3. **#1102** - Threat model documentation (compliance)
4. **#1105** - Revenue analytics (product analytics)

All changes maintain backward compatibility and include comprehensive documentation.
