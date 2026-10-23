# Pagination Cursor Expiry and Invalid-Cursor Behavior

## Normal Path
A paginated query accepts an opaque cursor token and returns the next page plus a new cursor, or none on the last page.

## Failure / Edge Cases
- Expired cursor returns an error; caller must restart pagination.
- Malformed/invalid cursor returns a validation error.
- Last page reached omits the next cursor.
- Empty result set returns an empty page with no cursor.

## Record Archived / Deleted Between Page Fetches (Cursor Invalidation)

When a payment record is **archived or deleted** after the first page has been fetched but before the next page is requested, the cursor (based on the last-seen `order_id`) may point to a record that no longer appears in query results.

### Expected Behaviour

| Scenario | Expected Result |
|---|---|
| Archived record was on a previous page | Cursor is unaffected; subsequent pages are correct |
| Archived record is the current cursor anchor | Cursor advances to the next live record |
| Archived record would have appeared on next page | That record is silently skipped; no duplication occurs |

### Guarantees

- **No duplication:** Records that appeared before the archive event will not be returned again.
- **No silent data loss beyond the archived record:** All other live records continue to appear on their expected pages.
- **`total_matching` count decreases by 1** for each archived record that falls within the original query window.

### Guidance for Callers

1. After any mutating operation (archive, delete) refresh the pagination session by resetting the cursor to `null` and restarting from page 1 if an accurate total count is required.
2. If your UI displays a `total_matching` count, re-fetch it after the archive event to reflect the updated value.
3. Do **not** rely on the cursor surviving across long-lived sessions where records may be archived concurrently.

### Test Coverage

Cursor-invalidation edge cases are covered in `tests/playwright/pagination-stability.spec.ts` (issue #1290):

- `cursor-invalidation: archived record does not appear in subsequent pages`
- `cursor-invalidation: total_matching decreases by 1 when record archived mid-pagination`
- `cursor-invalidation: no records duplicated across pages after mid-session archive`
