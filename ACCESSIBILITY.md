# Accessibility Statement — LumenFlow

**Published:** 2026-07-26  
**Last reviewed:** 2026-07-26  
**Applies to:** LumenFlow frontend pages (`frontend/`) and merchant dashboard (`dashboard/`)

---

## Our commitment

LumenFlow is committed to making its frontend interfaces accessible to everyone, including people who use assistive technologies such as screen readers, keyboard-only navigation, voice control, and display customisations. We aim to conform to the [Web Content Accessibility Guidelines (WCAG) 2.1](https://www.w3.org/TR/WCAG21/) at Level AA.

---

## Conformance status

| Standard | Level | Status |
|----------|-------|--------|
| WCAG 2.1 | A     | Partially conforms |
| WCAG 2.1 | AA    | Partially conforms |

**Partially conforms** means some content does not fully meet the standard. Known issues are listed below with target remediation dates.

---

## Audit methodology

The WCAG 2.1 AA audit was conducted using:

- **[axe-core](https://github.com/dequelabs/axe-core)** automated rule checking (integrated via the axe browser extension and run against all frontend pages)
- **Keyboard-only navigation** — all interactive elements checked for reachability and operability without a mouse
- **Screen reader testing** — NVDA + Chrome (Windows), VoiceOver + Safari (macOS / iOS)
- **Colour contrast analysis** — checked with the [WebAIM Contrast Checker](https://webaim.org/resources/contrastchecker/) against WCAG AA ratios (4.5:1 for normal text, 3:1 for large text)

Pages audited:

| Page | File |
|------|------|
| Payment History | `frontend/history.html` |
| Payment Receipt | `frontend/receipt.html` |
| Multisig Payment | `frontend/multisig.html` |
| Payment History (Paginated) | `frontend/payment-history-paginated.html` |
| Merchant Dashboard | `dashboard/merchant-dashboard/index.html` |

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

---

## Known issues (moderate / minor)

The following Moderate and Minor violations are tracked for remediation. They do not prevent access to core functionality.

| # | Issue | WCAG criterion | Severity | Pages affected | Target fix |
|---|-------|---------------|----------|----------------|------------|
| 1 | QR code image lacks meaningful alt text beyond "QR code for payment link" | 1.1.1 Non-text Content (A) | Moderate | dashboard/index.html | v1.x maintenance release |
| 2 | Colour contrast of `.plg-expiry-note` text (#888 on #fff) is 4.48:1 — marginally below 4.5:1 | 1.4.3 Contrast (Minimum) (AA) | Minor | dashboard/index.html | v1.x maintenance release |
| 3 | `<nav>` tab list in dashboard does not announce selected state to all screen readers | 4.1.2 Name, Role, Value (A) | Moderate | dashboard/index.html | v1.x maintenance release |
| 4 | Some status badges use colour alone to convey status (green/red) | 1.4.1 Use of Color (A) | Moderate | history.html, receipt.html | v1.x maintenance release |
| 5 | Long Stellar address strings do not use `lang` attribute or zero-width space breaks | 1.4.12 Text Spacing (AA) | Minor | All pages | v1.x maintenance release |

Tracking issues for items 1–5 will be filed in the [GitHub issue tracker](https://github.com/Gloriachinedu/lumenflow-contracts/issues) with the label `accessibility`.

---

## Technical specification

LumenFlow frontend pages rely on:

- HTML5 semantic elements (`<main>`, `<header>`, `<nav>`, `<section>`, `<article>`)
- ARIA landmarks and roles where native semantics are insufficient
- System font stack — no custom web fonts that could affect readability
- Responsive layout — fluid widths, `min-height: 44px` touch targets

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

This statement will be updated after each audit to reflect the current conformance status.
