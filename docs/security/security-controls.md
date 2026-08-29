# Security controls

Client/edge-side security primitives shipped in `@lumenflow/sdk` under
`src/security/` (import from `@lumenflow/sdk`). They enforce the same
invariants the contract and backend enforce, but fail fast and locally.

## Secure cookie, transport and browser headers (#897)

`buildSecurityHeaders(options?)` returns the recommended response headers for
every LumenFlow HTTP surface (payment-link pages, webhook receivers, dashboard
API):

| Header | Default |
| --- | --- |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains` (toggle with `hsts`, add `preload`) |
| `Content-Security-Policy` | strict `self`-only, `frame-ancestors 'none'` |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | camera/microphone/geolocation disabled |
| `Cross-Origin-Opener-Policy` / `Cross-Origin-Resource-Policy` | `same-origin` |

`serializeSecureCookie(name, value, options?)` produces a `Set-Cookie` value
that is `Secure; HttpOnly; SameSite=Strict` by default, forces `Secure` when
`SameSite=None`, and rejects names/values that could enable cookie/header
injection.

## Rate-limiting signature & auth failures (#898)

`FailureRateLimiter` is a fixed-window failure counter keyed by an identity
string (IP, API-key id, merchant address):

- `check(key)` — non-mutating status (`allowed`, `remaining`, `retryAt`)
- `recordFailure(key)` — count a failed signature/auth check; locks the key for
  `lockoutMs` (default 15 min) once `maxFailures` (default 5) is hit within
  `windowMs` (default 1 min)
- `recordSuccess(key)` — clear history after a valid attempt
- `prune()` — drop stale entries (call periodically)

Wire `recordFailure` into every signature-verification / authentication failure
path and short-circuit new attempts when `check().allowed` is `false`.

## Abuse detection for payment links & webhooks (#899)

`AbuseDetector.record({ source, target, failed })` returns a verdict
(`ok` | `suspicious` | `abusive`) plus a reason. It flags, within a rolling
burst window (default 10 s):

- request volume spikes (`suspiciousCount` / `abusiveCount`)
- high failure ratio — card testing / endpoint probing (`failureRatio` once
  `minSampleForRatio` requests seen)
- enumeration across many distinct payment links (`distinctTargets`)

The verdict is advisory — callers choose to challenge, throttle or block.

## Multisig quorum & signer-replacement controls (#900)

- `validateQuorumConfig({ signers, requiredSignatures })` — rejects quorums
  below 2, quorums above the signer count, duplicate/empty signers.
- `validateSignerReplacement({ currentSigners, requiredSignatures, outgoing,
  incoming, signedBy?, executed? })` — rejects replacing an unknown signer,
  introducing a duplicate, mutating an executed payment, and any replacement
  that would drop the count of still-valid collected signatures below the
  quorum (the outgoing signer's prior approval no longer counts).

Run these before calling `initiateMultisigPayment` / signer-management
contract methods.
