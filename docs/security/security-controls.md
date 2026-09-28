# Security controls

Client/edge-side security primitives shipped in `@lumenflow/sdk` under
`src/security/` (import from `@lumenflow/sdk`). They enforce the same
invariants the contract and backend enforce, but fail fast and locally.

## Content Security Policy (CSP) for frontend pages (#1011)

All five frontend HTML pages (`history.html`, `receipt.html`, `multisig.html`,
`onboarding.html`, `dashboard.html`) include a `<meta http-equiv="Content-Security-Policy">` tag with the following policy:

```
default-src 'self';
script-src 'self' https://cdn.jsdelivr.net;
style-src 'self' 'unsafe-inline';
connect-src 'self' https://soroban-testnet.stellar.org https://horizon-testnet.stellar.org https://horizon.stellar.org;
img-src 'self' data:;
font-src 'self';
object-src 'none';
frame-ancestors 'none';
```

### Policy rationale

| Directive | Value | Reason |
|-----------|-------|--------|
| `default-src` | `'self'` | Restricts all resource types to same origin by default |
| `script-src` | `'self' https://cdn.jsdelivr.net` | Allows only self-hosted scripts and the CDN used for Stellar SDK bundles; **no `'unsafe-inline'`** |
| `style-src` | `'self' 'unsafe-inline'` | Inline styles are required by dynamically rendered UI components; will be tightened with nonces in a future iteration |
| `connect-src` | self + Stellar RPC/Horizon endpoints | Required for Soroban RPC and Horizon API calls; Freighter wallet communicates via browser extension messaging, not fetch |
| `object-src` | `'none'` | Prevents Flash and other plugin-based attacks |
| `frame-ancestors` | `'none'` | Blocks clickjacking — equivalent to `X-Frame-Options: DENY` |

### Freighter wallet compatibility

Freighter (and compatible Stellar browser wallets) communicates with the page
through the browser extension messaging API (`window.postMessage` /
`chrome.runtime`), not via `fetch` or script injection. The policy above does
not interfere with this mechanism.

### CSP violation logging

Every page registers a `securitypolicyviolation` event listener that writes
full violation details to `console.error` in development:

```js
document.addEventListener('securitypolicyviolation', function(e) {
  console.error('[CSP Violation]', {
    blockedURI: e.blockedURI,
    violatedDirective: e.violatedDirective,
    effectiveDirective: e.effectiveDirective,
    originalPolicy: e.originalPolicy,
    sourceFile: e.sourceFile,
    lineNumber: e.lineNumber,
  });
});
```

In production, violations should be forwarded to a monitoring endpoint. Wire
a `report-uri` or `report-to` directive once a report collector is available.

### Future hardening

- Replace `style-src 'unsafe-inline'` with nonce-based or hash-based inline
  style allowance once the build pipeline supports nonce injection.
- Add a `report-to` directive pointing to a CSP violation reporting endpoint.
- Consider adding `require-trusted-types-for 'script'` for high-risk pages.

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
