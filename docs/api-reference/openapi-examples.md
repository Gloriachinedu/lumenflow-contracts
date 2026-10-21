# API Reference Examples

Source: `docs/openapi.yaml`

## Normal Path
Each endpoint defined in the OpenAPI contract accepts a valid request per its schema and returns the documented success response with contract state or transaction result.

## Failure / Edge Cases
- Malformed request body returns 400 Bad Request with a schema validation error.
- Unauthorized caller returns 401/Unauthorized per require_admin (see docs/auth-model.md).
- Unknown/invalid resource ID returns 404 Not Found.
