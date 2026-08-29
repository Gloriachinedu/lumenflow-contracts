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

## Encrypt sensitive merchant data at rest with managed keys (#893)

Authenticated envelope encryption (AES-256-GCM) for individual sensitive
fields before persistence, in `dataEncryption.ts`:

- `encryptField(plaintext, keyring)` — encrypts under `keyring.primary`,
  returns a self-describing envelope
  `v1.<keyId>.<iv>.<tag>.<ciphertext>`; `keyId` is bound into the AAD.
- `decryptField(envelope, keyring)` — selects the key by the embedded `keyId`
  (searching `primary` then `previous[]`), throws on tampering or a wrong key.
- `rotateEnvelope(envelope, keyring)` — re-encrypts under the current primary
  key. Mark rotated-out keys `active: false` to keep them decrypt-only.
- `isEncryptedEnvelope(value)` — guard for already-encrypted values.

Keys come from the caller's KMS as a `{ primary, previous? }` keyring; each key
must be 32 bytes.

## Field-level minimization for merchant & payer records (#894)

`minimizeMerchantRecord(record, audience, options?)` and
`minimizePayerRecord(...)` in `fieldMinimization.ts` project a record onto an
explicit per-audience allow-list:

- `public` — fields safe for a payment-link page / receipt
- `partner` — fields an integrating partner API may read (identifiers masked)
- `internal` — full record, no minimization

Unknown fields are always dropped. Identifier fields (`email`, `phone`,
`walletAddress`) are masked unless `maskIdentifiers: false`. Call at every
trust boundary that emits a record instead of trimming ad hoc.

## Authenticated & authorized data deletion requests (#895)

`authorizeDeletionRequest(req)` in `dataDeletion.ts` gates "delete my data"
requests before they reach the backend/contract and returns
`{ outcome: "allow" | "noop" | "deny", reason }`:

- unauthenticated requests (`requester` empty) are denied
- `self` role may only delete its own record (`requester === subject`)
- `admin` / `compliance` roles require a non-empty `legalBasis`
- records under `legalHold` or with `hasUnsettledObligations` cannot be erased
- `alreadyDeleted` records are a `noop`, not an error

## CSRF protection for cookie-authenticated browser endpoints (#896)

Signed double-submit-cookie tokens in `csrfProtection.ts` (no server store):

- `createCsrfToken(sessionId, secret, options?)` — mints an HMAC-signed,
  expiring token bound to the session; set it as a non-`HttpOnly` cookie and
  render it into the page.
- `verifyCsrfToken(submitted, cookie, sessionId, secret, options?)` — requires
  both values, a constant-time match, a valid signature for the session, and a
  non-expired token; safe methods (`GET`/`HEAD`/`OPTIONS`) short-circuit when
  `options.method` is passed.
- `isSafeMethod(method)` — method exemption helper.

Enforce on every state-changing request from a cookie-authenticated browser.
