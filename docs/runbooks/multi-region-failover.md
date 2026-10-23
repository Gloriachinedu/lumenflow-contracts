# Runbook: Multi-Region Failover

**Audience:** Platform operators and SREs  
**Service:** LumenFlow (Soroban smart contract on Stellar + off-chain infrastructure)  
**Severity:** P1 — Production impacting

---

## Recovery Targets

| Metric | Target |
|--------|--------|
| **RTO** (Recovery Time Objective) | ≤ 30 minutes from confirmed region failure |
| **RPO** (Recovery Point Objective) | 0 — the Stellar ledger is the source of truth; all committed transactions are globally replicated by the network |

> **Why RPO = 0:** LumenFlow's payment state lives entirely on the Stellar ledger, which is replicated across all Stellar Core validators globally. A regional infrastructure failure does not cause data loss — it only interrupts the ability to submit new transactions from that region.

---

## Overview

LumenFlow's on-chain state (contract storage, payment records, merchant data) is maintained by the Stellar network and is inherently multi-region. However, the **off-chain components** — Horizon API nodes, webhook relay services, the frontend/SDK servers, and monitoring agents — are typically deployed regionally. A regional failure in any of these components requires operator intervention.

This runbook covers:

1. Detecting a region failure
2. Deciding whether to failover
3. Executing the failover
4. Verifying recovery
5. Rolling back (returning to the primary region)

---

## Architecture Assumptions

```
Primary Region (e.g., us-east-1)           Secondary Region (e.g., eu-west-1)
─────────────────────────────────           ───────────────────────────────────
Horizon API node (primary)                  Horizon API node (standby)
Webhook relay service (active)              Webhook relay service (hot standby)
Frontend / SDK API server (active)          Frontend / SDK API server (warm standby)
Monitoring agent                            Monitoring agent

                    ↕  Global Stellar Network  ↕
```

Adjust region labels and component names to match your deployment.

---

## Step 1 — Detection

### Automated alerts

The following alerts should be configured in your monitoring system (see [docs/monitoring.md](../monitoring.md)):

| Alert | Condition | Severity |
|-------|-----------|----------|
| `horizon_primary_unavailable` | Horizon primary returns HTTP 5xx or times out for > 2 consecutive minutes | P1 |
| `webhook_relay_down` | Webhook relay health endpoint returns non-200 for > 1 minute | P1 |
| `frontend_latency_spike` | P99 response time > 10 s for > 3 minutes | P2 |
| `stellar_transaction_failure_rate` | >10% of submitted transactions rejected by the network | P1 |

### Manual verification

If an alert fires or you suspect a regional issue, verify with:

```bash
# 1. Check Horizon primary health
curl -s https://horizon-primary.your-domain.com/health | jq .

# 2. Check Stellar network status (public testnet/mainnet)
curl -s https://horizon-testnet.stellar.org/ | jq .horizon_version
# or for mainnet:
curl -s https://horizon.stellar.org/ | jq .horizon_version

# 3. Check Stellar network incident page
open https://status.stellar.org
```

---

## Step 2 — Decision Criteria

Initiate failover if **any** of the following are true:

- [ ] The primary Horizon node is unreachable or returning errors for > 5 minutes.
- [ ] The primary region's cloud provider reports an active incident affecting your AZ/region.
- [ ] Payment submission success rate drops below 90% for > 3 minutes.
- [ ] The webhook relay has not delivered events for > 5 minutes and its health endpoint is unhealthy.

Do **not** initiate failover if:
- The issue is a transient spike lasting < 2 minutes.
- The Stellar network itself is degraded (check https://status.stellar.org) — failover won't help.
- The incident is limited to a non-critical component (e.g., the monitoring dashboard).

---

## Step 3 — Failover Execution

> All steps assume you have shell access to your infrastructure. Adjust commands for your specific deployment tooling (Kubernetes, ECS, Ansible, etc.).

### 3a. Notify the team

Post to your incident channel immediately:

```
🚨 INCIDENT: Primary region [REGION] appears to be degraded.
Initiating multi-region failover to [SECONDARY REGION].
Runbook: docs/runbooks/multi-region-failover.md
Incident Commander: [YOUR NAME]
```

### 3b. Update DNS / load balancer to route traffic to secondary Horizon

```bash
# Example: update Route 53 health-check failover record
aws route53 change-resource-record-sets \
  --hosted-zone-id $HOSTED_ZONE_ID \
  --change-batch '{
    "Changes": [{
      "Action": "UPSERT",
      "ResourceRecordSet": {
        "Name": "horizon-api.your-domain.com",
        "Type": "CNAME",
        "TTL": 60,
        "ResourceRecords": [{"Value": "horizon-secondary.your-domain.com"}]
      }
    }]
  }'
```

For Kubernetes ingress, patch the backend service:

```bash
kubectl patch svc horizon-api -n lumenflow \
  -p '{"spec": {"selector": {"region": "secondary"}}}'
```

### 3c. Activate the secondary Horizon node

If the secondary Horizon node is in warm-standby (not yet catching up), promote it:

```bash
# SSH into secondary Horizon host
ssh ops@horizon-secondary.your-domain.com

# Confirm it is synced with the Stellar network
stellar-horizon db status

# Start the Horizon server if not running
sudo systemctl start stellar-horizon
```

Verify the secondary is returning the current ledger:

```bash
curl -s https://horizon-secondary.your-domain.com/ | jq .history_latest_ledger
# Compare with the public network:
curl -s https://horizon.stellar.org/ | jq .history_latest_ledger
```

The difference should be ≤ 10 ledgers (Stellar closes a ledger roughly every 5 seconds).

### 3d. Activate the secondary webhook relay

```bash
# If using a managed service, update the environment variable or config map
# to point to the secondary Horizon endpoint:
kubectl set env deployment/webhook-relay \
  HORIZON_URL=https://horizon-secondary.your-domain.com \
  -n lumenflow

# Restart the relay to pick up the change
kubectl rollout restart deployment/webhook-relay -n lumenflow

# Wait for rollout
kubectl rollout status deployment/webhook-relay -n lumenflow
```

### 3e. Activate the secondary frontend / SDK API server

```bash
# Scale up the secondary region's frontend deployment
kubectl scale deployment/frontend --replicas=3 \
  --context secondary-cluster -n lumenflow

# Confirm pods are running
kubectl get pods -l app=frontend --context secondary-cluster -n lumenflow
```

---

## Step 4 — Verification

After completing the failover steps, confirm the following:

### 4a. Contract reachability

```bash
# Submit a read-only call to the contract via the secondary Horizon
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source-account "$ADMIN_KEY" \
  --rpc-url https://horizon-secondary.your-domain.com/soroban/rpc \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  -- get_global_payment_stats \
  --admin "$ADMIN_ADDR" \
  --date_start null \
  --date_end null
```

Expected: returns global stats without error.

### 4b. Payment submission

Submit a minimal test payment (1 stroop, test account) via the secondary region and confirm it appears in the ledger:

```bash
CONTRACT_ID=$CONTRACT_ID \
ADMIN_KEY=$ADMIN_KEY \
MERCHANT_KEY=$MERCHANT_KEY \
PAYER_KEY=$PAYER_KEY \
TOKEN_ADDRESS=$TOKEN_ADDRESS \
ADMIN_ADDRESS=$ADMIN_ADDRESS \
MERCHANT_ADDRESS=$MERCHANT_ADDRESS \
PAYER_ADDRESS=$PAYER_ADDRESS \
NETWORK=$NETWORK \
./scripts/smoke_test.sh
```

Expected: exit code 0.

### 4c. Webhook delivery

Confirm the webhook relay is delivering events from the secondary Horizon:

```bash
kubectl logs -l app=webhook-relay --context secondary-cluster -n lumenflow --tail=50
# Look for: "event delivered" or similar success lines
```

### 4d. Monitoring dashboards

Confirm:
- Error rate returns to < 1%.
- Horizon secondary latency is within normal bounds (< 500 ms P95).
- No undelivered webhook events queued for > 2 minutes.

---

## Step 5 — Rollback (Return to Primary Region)

Once the primary region has recovered and been verified stable, follow these steps to restore normal routing.

### 5a. Verify primary Horizon is fully synced

```bash
curl -s https://horizon-primary.your-domain.com/ | jq .history_latest_ledger
# Must match horizon.stellar.org within 10 ledgers
```

### 5b. Restore DNS / load balancer to primary Horizon

```bash
aws route53 change-resource-record-sets \
  --hosted-zone-id $HOSTED_ZONE_ID \
  --change-batch '{
    "Changes": [{
      "Action": "UPSERT",
      "ResourceRecordSet": {
        "Name": "horizon-api.your-domain.com",
        "Type": "CNAME",
        "TTL": 60,
        "ResourceRecords": [{"Value": "horizon-primary.your-domain.com"}]
      }
    }]
  }'
```

### 5c. Scale down secondary region (optional)

Return secondary components to warm-standby to reduce costs:

```bash
kubectl scale deployment/frontend --replicas=1 \
  --context secondary-cluster -n lumenflow

kubectl set env deployment/webhook-relay \
  HORIZON_URL=https://horizon-primary.your-domain.com \
  -n lumenflow
kubectl rollout restart deployment/webhook-relay -n lumenflow
```

### 5d. Confirm primary is handling traffic

Re-run the smoke test pointing at the primary Horizon and confirm it exits 0.

### 5e. Post-incident review

Within 48 hours, file a post-incident review covering:
- Timeline of detection, decision, and recovery
- RTO achieved vs. target (≤ 30 minutes)
- Root cause
- Action items to prevent recurrence

---

## Quick-Reference Checklist

```
[ ] Alert confirmed — region failure verified via Horizon health and cloud status page
[ ] Incident announced in team channel
[ ] DNS / LB updated to secondary Horizon
[ ] Secondary Horizon node active and synced (≤ 10 ledger lag)
[ ] Secondary webhook relay restarted and delivering events
[ ] Secondary frontend scaled up
[ ] Smoke test passes via secondary region
[ ] Error rate < 1%, latency normal
--- RECOVERY CONFIRMED ---
[ ] Primary Horizon verified synced after recovery
[ ] DNS / LB restored to primary
[ ] Secondary components returned to standby
[ ] Post-incident review scheduled
```

---

## Related Documentation

- [Deployment Guide](../deployment-guide.md)
- [Monitoring Guide](../monitoring.md)
- [Events Reference](../events-reference.md)
- [Resource Limits & Autoscaling](../resource-limits-autoscaling.md)
