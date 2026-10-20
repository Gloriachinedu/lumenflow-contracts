# Roadmap Item Tracking

This document describes how LumenFlow tracks **unresolved roadmap items** so that
every planned feature has a clear owner and a target milestone, and so that
stalled items are surfaced rather than forgotten.

The tracking data itself lives in the **Unresolved item tracking** section of
[../ROADMAP.md](../ROADMAP.md). This document is the process around it.

---

## What is tracked

Every unchecked (`- [ ]`) bullet in the `Near-term`, `Medium-term`, and
`Long-term` sections of `ROADMAP.md` is an *unresolved roadmap item*. Each one
must appear exactly once in the tracking table with:

| Column | Rule |
|---|---|
| **Item** | The bold item name, matching the roadmap bullet verbatim. |
| **Owner** | A GitHub handle, or the literal `maintainers` holding value. Never empty. |
| **Target milestone** | One of the milestones defined in the legend. Never empty. |
| **Tracking issue** | A linked issue number, or `—` if none exists yet. |
| **Status** | One of `Not started`, `In progress`, `Blocked`, `Done`. |

When a roadmap bullet is completed it is checked off (`- [x]`) and its tracking
row is either removed or marked `Done`; the automated check ignores checked
items.

---

## Milestones

| Milestone | Meaning |
|---|---|
| `v0.4` | The next tagged release. |
| `v0.5` | The release after `v0.4`. |
| `v0.6` | The release after `v0.5`. |
| `Backlog` | Accepted direction, not yet scheduled to a specific release. |

To introduce a new milestone, add a row to the legend table in `ROADMAP.md`
**and** to this table in the same PR — the automated check rejects any milestone
that is not present in the `ROADMAP.md` legend.

---

## Ownership

- The default owner of every item is `maintainers`. This is a *holding* owner: it
  means "no individual has picked this up yet".
- When work is scheduled, the maintainer merging the scheduling PR replaces
  `maintainers` with a specific GitHub handle (`@handle`). That person is
  responsible for either delivering the item in its target milestone or raising a
  status change.
- Ownership changes are made by a normal PR that edits `ROADMAP.md`. Per
  [GOVERNANCE.md](../GOVERNANCE.md), roadmap edits are day-to-day changes and
  need a single maintainer approval.

---

## Keeping it current

The table is reviewed at each release cut:

1. Move the milestone labels forward (the just-released version drops off, a new
   trailing milestone is added to both the `ROADMAP.md` legend and this file).
2. Any item whose target milestone has now passed without being delivered is
   either re-targeted to a later milestone or moved to `Backlog`, and its
   `Status` is set to `Blocked` with a one-line reason in the PR description.
3. Completed items are checked off in the roadmap body and their rows marked
   `Done` (or removed).

Between releases, an item that becomes `Blocked` should get a tracking issue
opened for it so the blocker is visible outside this file.

---

## Automated check

`scripts/check-roadmap-tracking.mjs` parses `ROADMAP.md` and fails
(non-zero exit) if:

- an unresolved roadmap item is missing from the tracking table;
- a tracking row references an item that is not an unresolved roadmap bullet;
- a row has an empty **Owner** or empty **Target milestone** cell;
- a row's **Target milestone** is not listed in the milestone legend;
- a row's **Status** is not one of the allowed values.

Run it locally with:

```bash
npm run check:roadmap
```

It is covered by `scripts/check-roadmap-tracking.test.mjs`
(`npm run test:roadmap`).
