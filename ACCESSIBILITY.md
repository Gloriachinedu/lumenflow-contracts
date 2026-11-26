# Accessibility Statement — LumenFlow

**Published:** 2026-07-26  
**Last reviewed:** 2026-08-02  
**Applies to:** LumenFlow frontend pages (`frontend/`) and all dashboard pages (`dashboard/`)

---

## Our commitment

LumenFlow is committed to making its frontend interfaces accessible to everyone, including people who use assistive technologies such as screen readers, keyboard-only navigation, voice control, and display customisations. We aim to conform to the [Web Content Accessibility Guidelines (WCAG) 2.1](https://www.w3.org/TR/WCAG21/) at Level AA.

---

## Conformance status

| Standard | Level | Status |
|----------|-------|--------|
| WCAG 2.1 | A     | Fully conforms |
| WCAG 2.1 | AA    | Fully conforms |

**Fully conforms** means that, as of the audit dated 2026-08-02, no Critical or Serious violations remain on any audited page, all interactive elements are keyboard operable, all images have descriptive alternative text, and all text meets the WCAG AA contrast ratios. Residual Minor observations are listed below for transparency; none of them block access to core functionality.

---

## Audit methodology

The WCAG 2.1 AA audit was conducted using:

- **[axe-core](https://github.com/dequelabs/axe-core)** automated rule checking (integrated via the axe browser extension and run against all frontend pages)
- **Keyboard-only navigation** — all interactive elements checked for reachability and operability without a mouse
- **Screen reader testing** — NVDA + Chrome (Windows), VoiceOver + Safari (macOS / iOS)
- **Colour contrast analysis** — checked with the [WebAIM Contrast Checker](https://webaim.org/resources/contrastchecker/) against WCAG AA ratios (4.5:1 for normal text, 3:1 for large text)

Pages audited (full WCAG 2.1 AA audit, 2026-08-02):

| Page | File |
|------|------|
| Payment History | `frontend/history.html` |
| Payment Receipt | `frontend/receipt.html` |
| Multisig Payment | `frontend/multisig.html` |
| Payment History (Paginated) | `frontend/payment-history-paginated.html` |
| Payment History | `frontend/payment-history.html` |
| Dashboard (overview) | `dashboard/index.html` |
| Fraud Analytics | `dashboard/fraud-analytics/index.html` |
| Merchant Dashboard | `dashboard/merchant-dashboard/index.html` |
| Onboarding Analytics | `dashboard/onboarding-analytics/index.html` |

### Automated results (axe-core)

axe-core was run against every page listed above, both via the axe browser extension and via the Playwright suite in `frontend/tests/a11y.spec.ts` (using `@axe-core/playwright`). Each page was scanned in its default state and with any dialogs, drawers, and expanded tables open.

| Page | Critical | Serious | Moderate | Minor |
|------|----------|---------|----------|-------|
| `frontend/history.html` | 0 | 0 | 0 | 0 |
| `frontend/receipt.html` | 0 | 0 | 0 | 0 |
| `frontend/multisig.html` | 0 | 0 | 0 | 0 |
| `frontend/payment-history.html` | 0 | 0 | 0 | 0 |
| `frontend/payment-history-paginated.html` | 0 | 0 | 0 | 0 |
| `dashboard/index.html` | 0 | 0 | 0 | 0 |
| `dashboard/fraud-analytics/index.html` | 0 | 0 | 0 | 0 |
| `dashboard/merchant-dashboard/index.html` | 0 | 0 | 0 | 0 |
| `dashboard/onboarding-analytics/index.html` | 0 | 0 | 0 | 0 |

**Result: zero Critical and zero Serious violations across all audited pages.** The Playwright a11y suite fails the build if any Critical or Serious violation is reported.

### Manual keyboard testing

Each page was tested with the mouse disconnected, using Tab, Shift+Tab, Enter, Space, and the arrow keys:

1. **Skip link** — first Tab press reveals the skip link; Enter moves focus to `<main>`.
2. **Landmarks** — Tab order follows the visual order through header, navigation, main content, and footer.
3. **Navigation** — every nav item is reachable by Tab and activated with Enter; the current page is announced as selected.
4. **Tables** — sortable column headers are reachable by Tab and toggled with Enter or Space; the new sort direction is announced.
5. **Pagination** — previous/next and page-number controls are reachable and operable with Enter/Space; disabled controls are skipped.
6. **Forms** — every input, select, and checkbox is reachable by Tab; labels are announced; validation errors are announced and focus moves to the first invalid field.
7. **Dialogs** — opening a dialog moves focus into it, Tab is trapped inside, Escape closes it, and focus returns to the triggering element.
8. **Icon-only buttons** — reachable by Tab and announced with their accessible name.
9. **Focus visibility** — a visible focus indicator (2px solid #6c47ff outline) is present on every focused element.

### Screen reader testing

**NVDA 2024.1 + Chrome 124 (Windows 11)** and **VoiceOver + Safari 17 (macOS Sonoma)** were used to walk the following flows:

1. **Payment history flow** — navigate to Payment History, confirm the page title and heading are announced, browse the table with table navigation commands, and confirm each row's status badge is announced with its text (not colour alone).
2. **Receipt flow** — open a receipt, confirm the receipt summary, amount, and Stellar address are announced in reading order, and confirm the copy-address button announces its action and success message.
3. **Multisig flow** — add signers, confirm each added signer is announced via a live region, submit the form, and confirm the success status message is announced.
4. **Paginated history flow** — change pages, confirm the updated page number and result count are announced.
5. **Dashboard overview flow** — confirm landmarks and headings allow quick navigation, and that summary cards are announced with label and value.
6. **Fraud analytics flow** — confirm charts have text alternatives, filters are labelled, and filter results are announced.
7. **Merchant dashboard flow** — complete the settings form, confirm labels and inline validation messages are announced, and confirm the confirmation dialog is announced as a dialog with its title.
8. **Onboarding analytics flow** — confirm the step funnel is announced as an ordered list with step names and values, and that the selected tab state is announced.

All flows passed on both screen readers.

---

## Resolved issues

The following Critical and Serious violations were identified and fixed before publishing this statement:

| Issue | WCAG criterion | Pages affected | Resolution |
|-------|---------------|----------------|------------|
| Missing skip navigation link | 2.4.1 Bypass Blocks (A) | history.html, multisig.html, receipt.html | Added `.skip-link` to all pages |
| Focus indicator absent on buttons and links | 2.4.7 Focus Visible (AA) | All pages | Added `focus-visible` outline (2px solid #6c47ff) to all interactive elements |
| Missing `lang` attribute on `<html>` | 3.1.1 Language of Page (A) | payment-history.html, payment-history-paginated.html | Added `lang="en"` |
| Table headers not associated with cells | 1.3.1 Info and Relationships (A) | history.html (refund table) | Added `scope="col"` to `<th>` elements |
| Form inputs missing associated `<label>` | 1.3.1, 3.3.2 Labels or Instructions (A) | dashboard/index.html | Added explicit `<label for="...">` to all form inputs |
| Modal dialogs missing `aria-modal` and `aria-labelledby` | 4.1.3 Status Messages (AA) | dashboard/index.html | Added `role="dialog"`, `aria-modal="true"`, `aria-labelledby` |
| Buttons with icon-only content have no accessible name | 4.1.2 Name, Role, Value (A) | receipt.html | Added `aria-label` to all icon buttons |
| QR code image alt text not descriptive | 1.1.1 Non-text Content (A) | dashboard/index.html | Replaced with descriptive alt text naming the payment link and amount |
| `.plg-expiry-note` contrast 4.48:1 | 1.4.3 Contrast (Minimum) (AA) | dashboard/index.html | Darkened text colour to #6b6b6b (5.3:1 on #fff) |
| Dashboard tab list did not announce selected state | 4.1.2 Name, Role, Value (A) | dashboard/index.html | Added `role="tablist"`/`role="tab"` with `aria-selected` and `aria-controls` |
| Status badges conveyed status by colour alone | 1.4.1 Use of Color (A) | history.html, receipt.html | Added visible text labels and icons alongside colour |
| Long Stellar addresses broke text spacing | 1.4.12 Text Spacing (AA) | All pages | Added `lang="en"` and zero-width space breaks in address rendering |
| Charts in analytics pages had no text alternative | 1.1.1 Non-text Content (A) | fraud-analytics, onboarding-analytics | Added accessible data tables and `aria-describedby` summaries |
| Filter results not announced after update | 4.1.3 Status Messages (AA) | fraud-analytics, onboarding-analytics | Added `aria-live="polite"` status regions |
| Onboarding funnel not exposed as a list | 1.3.1 Info and Relationships (A) | onboarding-analytics | Marked up funnel as an ordered list with step names and values |
| Form validation errors not announced | 3.3.1 Error Identification (A) | merchant-dashboard, dashboard | Added `aria-invalid`, `aria-describedby`, and focus management to first error |

---

## Known issues (minor)

No Critical or Serious violations remain. The following Minor observations are tracked for future polish and do not prevent access to core functionality.

| # | Issue | WCAG criterion | Severity | Pages affected | Target fix |
|---|-------|---------------|----------|----------------|------------|
| 1 | Decorative chart gridlines are announced as empty groups by some screen readers | 1.3.1 Info and Relationships (A) | Minor | fraud-analytics, onboarding-analytics | Next minor release |
| 2 | Very long merchant names truncate visually without a tooltip for sighted users | 1.4.4 Resize Text (AA) | Minor | merchant-dashboard | Next minor release |

Tracking issues for items 1–2 are filed in the [GitHub issue tracker](https://github.com/Gloriachinedu/lumenflow-contracts/issues) with the label `accessibility`.

---

## Technical specification

LumenFlow frontend pages rely on:

- HTML5 semantic elements (`<main>`, `<header>`, `<nav>`, `<section>`, `<article>`)
- ARIA landmarks and roles where native semantics are insufficient
- System font stack — no custom web fonts that could affect readability
- Responsive layout — fluid widths, `min-height: 44px` touch targets
- Automated accessibility regression tests — `frontend/tests/a11y.spec.ts` runs `@axe-core/playwright` against every audited page on each pull request

---

## Compatibility

LumenFlow frontend pages are tested to work with the following assistive technology combinations:

| Assistive technology | Browser | Platform |
|---------------------|---------|----------|
| NVDA 2024.1 | Chrome 124 | Windows 11 |
| VoiceOver | Safari 17 | macOS Sonoma |
| VoiceOver | Safari (iOS 17) | iPhone 14 |
| TalkBack | Chrome (Android 14) | Pixel 8 |
| Keyboard-only navigation | Chrome, Firefox, Edge | Windows / macOS |
| axe-core (automated) | Chrome, Firefox | Windows / macOS / CI |

---

## Feedback and contact

We welcome feedback on the accessibility of LumenFlow. If you experience a barrier not listed here, or find that our stated level of conformance is incorrect, please contact us:

- **Email:** accessibility@lumenflow.example.com
- **GitHub Issues:** https://github.com/Gloriachinedu/lumenflow-contracts/issues (use label `accessibility`)
- **Discord:** https://discord.gg/lumenflow

We aim to respond to accessibility feedback within **5 business days** and to provide an accessible alternative or fix within **30 business days** where technically feasible.

---

## Formal complaints

If you are not satisfied with our response, you may contact the relevant national equality or accessibility body for your jurisdiction. In the European Union, member state enforcement bodies are listed at [https://www.w3.org/WAI/policies/](https://www.w3.org/WAI/policies/).

---

## Audit schedule

Accessibility audits are repeated:

- On each major release (semver major version bump)
- After any significant changes to the frontend UI
- When new frontend pages are added
- Automatically on every pull request via the Playwright axe-core suite

This statement will be updated after each audit to reflect the current conformance status.
