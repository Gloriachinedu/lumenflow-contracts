# Dark Mode Visual Regression – Baseline Screenshots

This directory contains the baseline (golden) screenshots used by
`tests/playwright/dark-mode-visual-regression.spec.ts`.

## Directory structure

Playwright names snapshot files automatically based on the test file and OS:

```
dark-mode-visual-regression.spec.ts-snapshots/
  onboarding-step1-dark-linux.png
  onboarding-step3-dark-linux.png
  payment-history-paginated-dark-linux.png
  payment-history-paginated-page2-dark-linux.png
```

## Generating baselines

Run with `--update-snapshots` on the same platform used by CI (Linux):

```bash
npx playwright test tests/playwright/dark-mode-visual-regression.spec.ts \
  --update-snapshots
```

Then commit the generated PNG files.

## Diff threshold

The tests use `maxDiffPixelRatio: 0.02` — up to 2% of pixels may differ between
runs before the test fails. This tolerates minor anti-aliasing and font-hinting
differences across environments.

To tighten or loosen the threshold, edit the `DIFF_THRESHOLD` constant at the
top of the spec file.
