# Pagination Cursor Expiry and Invalid-Cursor Behavior

## Normal Path
A paginated query accepts an opaque cursor token and returns the next page plus a new cursor, or none on the last page.

## Failure / Edge Cases
- Expired cursor returns an error; caller must restart pagination.
- Malformed/invalid cursor returns a validation error.
- Last page reached omits the next cursor.
- Empty result set returns an empty page with no cursor.
