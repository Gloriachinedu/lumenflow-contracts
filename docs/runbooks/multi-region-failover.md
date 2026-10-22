# Multi-Region Failover Runbook

This runbook describes the manual and automated procedures for failing over
LumenFlow contract operations from a primary region to a secondary region during
an incident.

## Overview

LumenFlow contracts are deployed on the Stellar network (testnet/mainnet).
The "region" in this context refers to the infrastructure supporting the
off-chain services (Horizon nodes, RPC endpoints, and DNS routing) that
frontends and SDK clients use to interact with the contract.

| Region | Horizon URL | RPC URL | DNS Record |
|--------|-------------|---------|------------|
| Primary | `https://horizon.stellar.org` | `https://soroban-mainnet.stellar.org` | `api.lumenflow.example` → primary |
| Secondary | `https://horizon.stellar.org` | `https://soroban-mainnet-failover.stellar.org` | `api.lumenflow.example` → secondary (on failover) |

## RTO Target

**Recovery Time Objective: 15 minutes**

The failover must complete within 15 minutes from the moment the on-call
engineer declares an incident. The automated drill measures this end-to-end.

## Manual Failover Procedure

### 1. Declare Incident

1. Page the on-call engineer.
2. Confirm the primary region is unhealthy (Horizon/RPC unreachable or erroring).
3. Post an incident announcement in the `#incidents` channel.

### 2. Switch DNS

1. Update the DNS record for `api.lumenflow.example` to point to the secondary
   region's RPC endpoint.
2. Wait for DNS TTL to expire (configured at 60 seconds).
3. Verify the secondary endpoint is reachable:

   ```bash
   curl -s https://soroban-mainnet-failover.stellar.org/health
   ```

### 3. Verify with Smoke Test

Run the smoke test against the secondary region to confirm contract operations
are functional:

```bash
CONTRACT_ID=<contract-id> \
ADMIN_KEY=<admin-secret> \
MERCHANT_KEY=<merchant-secret> \
PAYER_KEY=<payer-secret> \
TOKEN_ADDRESS=<token-address> \
NETWORK=mainnet \
./scripts/smoke_test.sh
```

### 4. Announce Recovery

1. Post a recovery notice in `#incidents`.
2. Update the status page.
3. Schedule a post-mortem.

## Automated Failover Drill

An automated monthly drill runs in GitHub Actions to verify the failover
procedure works end-to-end. See
[`.github/workflows/multi-region-failover.yml`](../../.github/workflows/multi-region-failover.yml).

The drill:

1. Spins up the secondary region configuration.
2. Runs the smoke test against the secondary RPC endpoint.
3. Measures the total failover time and compares it against the 15-minute RTO.
4. Posts results as a workflow summary.
5. Triggers an alert to the on-call on failure.

### Drill Secrets

The following GitHub Actions secrets are required:

| Secret | Description |
|--------|-------------|
| `FAILOVER_CONTRACT_ID` | Contract ID for the failover drill |
| `FAILOVER_ADMIN_KEY` | Admin secret key |
| `FAILOVER_MERCHANT_KEY` | Merchant secret key |
| `FAILOVER_PAYER_KEY` | Payer secret key |
| `FAILOVER_TOKEN_ADDRESS` | Token address for test payment |
| `FAILOVER_ADMIN_ADDRESS` | Admin public address |
| `FAILOVER_MERCHANT_ADDRESS` | Merchant public address |
| `FAILOVER_PAYER_ADDRESS` | Payer public address |
| `FAILOVER_RPC_URL` | Secondary region RPC endpoint |
| `FAILOVER_NETWORK` | Target network (testnet or mainnet) |
| `ONCALL_SLACK_WEBHOOK` | Slack webhook URL for on-call alerts |
