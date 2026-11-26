# Deployment Environments

LumenFlow supports three target environments: **local**, **testnet**, and **mainnet**. Each has an isolated config file under `scripts/env/`.

## Environment Config Files

| File | Network | RPC |
|---|---|---|
| `scripts/env/local.env` | `local` | `http://localhost:8000/soroban/rpc` |
| `scripts/env/testnet.env` | `testnet` | `https://soroban-testnet.stellar.org` |
| `scripts/env/mainnet.env` | `mainnet` | Your mainnet RPC endpoint |

Each file exports:
- `NETWORK` — network name passed to the Stellar CLI
- `RPC_URL` — RPC endpoint (passed as `--rpc-url`)
- `NETWORK_PASSPHRASE` — network passphrase (passed as `--network-passphrase`)

## Deploying

### Using `NETWORK` environment variable (original style)
```bash
NETWORK=testnet SOURCE_ACCOUNT=S_EXAMPLE_DO_NOT_USE ./scripts/deploy.sh
```

### Using `--network` flag
```bash
SOURCE_ACCOUNT=S_EXAMPLE_DO_NOT_USE ./scripts/deploy.sh --network testnet
```

`deploy.sh` auto-loads the matching `scripts/env/<network>.env` file before invoking the Stellar CLI.

> **Key hygiene:** `S_EXAMPLE_DO_NOT_USE` is a fake placeholder, not a valid key. Generate a fresh keypair for each environment with `scripts/generate_smoke_keypair.sh` and never commit real secret keys. Any testnet keys previously shown in this documentation are **deprecated and unfunded** — do not reuse them.

## Per-environment Values

### Local
```bash
# Start the local network container first
stellar network container start local

SOURCE_ACCOUNT=S_EXAMPLE_DO_NOT_USE ./scripts/deploy.sh --network local
```

### Testnet
```bash
# Generate a fresh keypair first: ./scripts/generate_smoke_keypair.sh
# Fund with Friendbot: https://friendbot.stellar.org
SOURCE_ACCOUNT=S_EXAMPLE_DO_NOT_USE ./scripts/deploy.sh --network testnet
```

### Mainnet
```bash
# Edit scripts/env/mainnet.env and set your RPC_URL with a real API key before deploying
SOURCE_ACCOUNT=S_EXAMPLE_DO_NOT_USE ./scripts/deploy.sh --network mainnet
```

> **Mainnet warning:** The `mainnet.env` file contains a placeholder RPC URL. Replace `<YOUR_API_KEY>` before deploying to production. Never commit real secret keys or API keys to version control.

## Internal mTLS for Service-to-Service Communication

All internal service calls (webhook relay, event poller, monitoring exporter) must use mutual TLS. Plain HTTP between services is not permitted in `testnet` or `mainnet`.

### Internal CA

An internal Certificate Authority issues short-lived service certificates. The CA private key is stored in the infrastructure secrets store (never in this repo) and is only accessible to the rotation job.

```bash
# One-time CA bootstrap (run in a secure environment, store outputs in the secrets manager)
openssl genrsa -out internal-ca.key 4096
openssl req -x509 -new -nodes -key internal-ca.key -sha256 -days 3650 \
  -subj "/CN=LumenFlow Internal CA" -out internal-ca.crt
```

Distribute only `internal-ca.crt` to services. The CA key stays in the secrets store.

### Service Certificates

Each service gets its own certificate with a validity of **30 days** (well under the 90-day maximum). Certificates use SANs matching the service's internal DNS name.

```bash
# Issue a certificate for a service (e.g. webhook-relay)
SERVICE=webhook-relay
openssl genrsa -out ${SERVICE}.key 2048
openssl req -new -key ${SERVICE}.key -subj "/CN=${SERVICE}.internal" -out ${SERVICE}.csr
openssl x509 -req -in ${SERVICE}.csr -CA internal-ca.crt -CAkey internal-ca.key \
  -CAcreateserial -days 30 -sha256 \
  -extfile <(printf "subjectAltName=DNS:${SERVICE}.internal,DNS:localhost") \
  -out ${SERVICE}.crt
```

### Service Configuration

Every internal service reads the following environment variables:

| Variable | Description |
|---|---|
| `MTLS_CA_CERT` | Path to `internal-ca.crt` (used to verify peers) |
| `MTLS_SERVER_CERT` | Path to this service's certificate |
| `MTLS_SERVER_KEY` | Path to this service's private key |
| `MTLS_CLIENT_CERT` | Path to the certificate presented on outbound calls |
| `MTLS_CLIENT_KEY` | Path to the private key for outbound calls |
| `MTLS_ENABLED` | Set to `true` to enforce mTLS (default `false` for local only) |

Example for the webhook relay:

```bash
MTLS_ENABLED=true
MTLS_CA_CERT=/etc/lumenflow/tls/internal-ca.crt
MTLS_SERVER_CERT=/etc/lumenflow/tls/webhook-relay.crt
MTLS_SERVER_KEY=/etc/lumenflow/tls/webhook-relay.key
MTLS_CLIENT_CERT=/etc/lumenflow/tls/webhook-relay.crt
MTLS_CLIENT_KEY=/etc/lumenflow/tls/webhook-relay.key
```

The event poller and monitoring exporter use the same variables with their own certificate files (`event-poller.crt`/`.key`, `monitoring-exporter.crt`/`.key`).

### Enabling mTLS per Service

- **Webhook relay:** set `MTLS_ENABLED=true` and the variables above; outbound webhook delivery to internal consumers uses the client cert, and its listener requires a client cert from callers.
- **Event poller:** set `MTLS_ENABLED=true`; it presents its client cert when calling the relay and requires client certs on its own endpoints.
- **Monitoring exporter:** set `MTLS_ENABLED=true`; the scraper must present a client cert, and the exporter presents its client cert when pushing to internal collectors.

In `local.env`, leave `MTLS_ENABLED=false`. In `testnet.env` and `mainnet.env`, set `MTLS_ENABLED=true`.

### Automated Rotation

Certificates are rotated automatically by a scheduled job (CI pipeline or cluster CronJob) before expiry:

1. The job authenticates to the secrets store and loads the CA key.
2. It issues new 30-day certificates for each service.
3. It writes the new cert/key into the secrets store under a new version.
4. Services reload certificates on SIGHUP (or on file change) without downtime.
5. The job runs every 14 days, so certificates are always replaced well before the 30-day expiry.

```bash
# Example rotation invocation (run by the scheduler)
for SERVICE in webhook-relay event-poller monitoring-exporter; do
  ./scripts/rotate-service-cert.sh "$SERVICE"
done
```

### Verifying mTLS

Confirm a service rejects connections without a client certificate:

```bash
# Should fail (no client cert)
openssl s_client -connect webhook-relay.internal:443 -CAfile internal-ca.crt </dev/null

# Should succeed (with client cert)
openssl s_client -connect webhook-relay.internal:443 \
  -CAfile internal-ca.crt \
  -cert webhook-relay.crt -key webhook-relay.key </dev/null
```

Check certificate validity and SANs:

```bash
openssl x509 -in webhook-relay.crt -noout -dates -ext subjectAltName
```

The `-dates` output must show a validity window of 90 days or less.
