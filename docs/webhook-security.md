# Webhook Signature Verification

This document explains how the LumenFlow webhook server verifies the authenticity of incoming Horizon event notifications using the `X-Stellar-Signature` header.

---

## Why signature verification matters

Without signature verification, any client that knows your webhook receiver URL can send forged event payloads and trigger unintended business logic (e.g. fake payment confirmations). Verifying the signature ensures that every request originated from a trusted Horizon relay and has not been tampered with in transit.

---

## Algorithm overview

LumenFlow uses **ed25519** digital signatures — the same curve used by Stellar accounts. The Horizon relay signs the raw request body with its private key before forwarding the event to your receiver. Your server verifies the signature with the corresponding public key.

### Steps

1. **Obtain the Horizon ed25519 public key** — provided by your Horizon relay operator and stored in the `WEBHOOK_SECRET` environment variable (32 bytes, hex-encoded).
2. **Read the raw request body** — the body must be read as raw bytes, before any JSON parsing, to avoid whitespace or encoding differences invalidating the signature.
3. **Extract the `X-Stellar-Signature` header** — the header value is the signature, 64 bytes, hex-encoded.
4. **Verify** — use `nacl.sign.detached.verify(body, signature, publicKey)`.
5. **Reject on failure** — if the signature is missing, malformed, or invalid, respond with HTTP 401 and do not process the event.

---

## Verification pseudocode

```
publicKey  = hex_decode(WEBHOOK_SECRET)           // 32 bytes
signature  = hex_decode(request.headers["x-stellar-signature"])  // 64 bytes
rawBody    = request.raw_body_bytes               // read before JSON.parse

if len(signature) != 64:
    return HTTP 401

if not ed25519_verify(message=rawBody, signature=signature, public_key=publicKey):
    return HTTP 401

// Proceed with processing
event = json_parse(rawBody)
```

---

## Node.js implementation

The example server in [webhook-integration.md](./webhook-integration.md) uses the [`tweetnacl`](https://www.npmjs.com/package/tweetnacl) library:

```js
const nacl = require("tweetnacl");

function verifySignature(rawBody, sigHeader) {
  if (!sigHeader) return false;

  let sigBytes;
  try {
    sigBytes = Buffer.from(sigHeader, "hex");
  } catch {
    return false;
  }

  if (sigBytes.length !== 64) return false;

  return nacl.sign.detached.verify(
    new Uint8Array(rawBody),      // message
    new Uint8Array(sigBytes),     // 64-byte signature
    new Uint8Array(PUBLIC_KEY)    // 32-byte ed25519 public key
  );
}
```

- `rawBody` is a `Buffer` read directly from the HTTP request stream — **before** calling `JSON.parse`.
- `PUBLIC_KEY` is decoded once at server start from `process.env.WEBHOOK_SECRET`.

---

## Environment variable

| Variable | Description | Required |
|---|---|---|
| `WEBHOOK_SECRET` | Horizon ed25519 public key, hex-encoded (32 bytes) | Yes |

The server **will not start** if `WEBHOOK_SECRET` is missing or not a valid 32-byte hex string.

---

## Rejection response

When signature verification fails, the server returns:

```
HTTP/1.1 401 Unauthorized
Content-Type: application/json

{"error": "Invalid signature"}
```

The event payload is not forwarded to `WEBHOOK_URL` and a warning is logged.

---

## Security best practices

- Store `WEBHOOK_SECRET` in a secrets manager (e.g. AWS Secrets Manager, HashiCorp Vault) or as a CI/CD secret. Never commit it to source control.
- Rotate the signing key periodically and update `WEBHOOK_SECRET` in your deployment accordingly.
- Use HTTPS for `WEBHOOK_URL` to protect the forwarded payload in transit.
- For high-value integrations, additionally verify the transaction hash on-chain via Horizon's `/transactions/{hash}` endpoint (see [webhook-integration.md §2](./webhook-integration.md#2-verifying-event-authenticity)).
- See [docs/secrets-and-local-env.md](./secrets-and-local-env.md) for guidance on managing secrets in local environments.

---

## References

- [TweetNaCl.js documentation](https://tweetnacl.js.org/)
- [ed25519 on Wikipedia](https://en.wikipedia.org/wiki/EdDSA)
- [Stellar Horizon API — Contract Events](https://developers.stellar.org/docs/data/horizon/api-reference/resources/contract-events)
