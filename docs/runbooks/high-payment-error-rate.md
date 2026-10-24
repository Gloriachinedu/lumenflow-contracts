# High Payment Error Rate Runbook

This runbook covers the most common on-call operational event for LumenFlow: a sudden spike in payment failures. The goal is to separate transport issues from contract logic and then quickly apply the safest mitigation.

## Scope and trigger

Trigger this runbook when any of the following is true:

- Payment error rate exceeds 5% over a 10-minute window.
- More than 10 failed payments in 10 minutes for the same merchant or network.
- Grafana or PagerDuty alerts identify a spike in `payment_failed`, `signature_verification_failed`, or `contract_execution_error` events.
- Operators see a sustained increase in RPC timeouts or HTTP 429/5xx responses from Horizon or Soroban RPC.

## Immediate triage

### 1. Confirm the signal

Use Grafana to isolate whether the problem is broader than a single merchant:

```sql
sum(rate(payment_attempt_total{status="failed"}[5m])) by (merchant)
```

```sql
sum(rate(rpc_request_total{status_code=~"429|500|503"}[5m])) by (endpoint)
```

```sql
sum(rate(contract_error_total{kind=~"signature|allowance|invalid_input|timeout"}[5m])) by (kind)
```

Then compare with the baseline:

```sql
sum(rate(payment_attempt_total[15m])) by (status)
```

If the failure rate is clustered on a single endpoint, merchant, or contract call, the issue is likely localized. If it affects all merchants and all endpoints, assume a network or infrastructure issue first.

### 2. Check service health

```bash
curl -sS https://horizon-testnet.stellar.org/ | jq '.history.latest_ledger' || true
curl -sS https://horizon-testnet.stellar.org/health || true
curl -sS https://horizon-testnet.stellar.org/metrics | grep -E 'rpc|soroban|error' | tail -20 || true
```

```bash
stellar contract id info --network testnet --id "$CONTRACT_ID" 2>/dev/null || true
```

If Horizon or RPC is returning repeated 429s or timeouts, treat this as a transport incident and continue with the RPC section below.

---

## A. RPC issue diagnosis

Symptoms:

- Transactions fail before contract execution.
- Errors mention timeout, connection reset, or no response from RPC.
- The failure pattern is broad and not tied to a specific merchant or signature.

### Investigation steps

1. Check request latency and timeout volume in Grafana.

```sql
histogram_quantile(0.95, sum(rate(rpc_request_duration_seconds_bucket[5m])) by (le))
```

```sql
sum(rate(rpc_request_total{status_code=~"429|500|503|504"}[5m]))
```

2. Confirm the RPC endpoint used by the application is healthy.

```bash
curl -sS "$SOROBAN_RPC_URL/health" || echo "RPC health check failed"
curl -sS "$SOROBAN_RPC_URL" | jq '.result' || true
```

3. Validate whether the failure is network-wide or isolated to one environment.

```bash
stellar network ls
stellar contract id info --network testnet --id "$CONTRACT_ID"
```

4. If timeouts dominate, temporarily reduce the number of concurrent payment workers or rate-limit retries.

### Mitigation

- Fail over to a healthy RPC endpoint if available.
- Reconfigure the app to retry with exponential backoff using jitter.
- Pause non-essential payment processing if the backlog is rising faster than the ledger can process it.
- If the issue is caused by provider saturation, reduce batch sizes or queue jobs instead of retrying instantly.

Escalate to the Soroban RPC or Horizon provider if response failures continue for more than 15 minutes or if 5xx/429 rates are elevated across all merchants.

---

## B. Contract error analysis

Symptoms:

- Contract invocation is rejected after the transaction reaches the ledger.
- Errors mention invalid input, insufficient funds, or contract state conditions.
- Failures cluster to a specific contract function or merchant.

### Investigation steps

1. Check error rate by contract function and code.

```sql
sum(rate(contract_error_total[5m])) by (func, error_code)
```

2. Inspect recent logs for the failing contract invocation.

```bash
grep -E "contract.*error|invalid_input|merchant_not_found|merchant_inactive|refund_window" /var/log/lumenflow/*.log | tail -100
```

3. Re-run the failing call using the same parameters in a safe environment.

```bash
auth=$(stellar keys secret --network testnet 2>/dev/null || echo "$SOURCE_SECRET")
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source-account "$auth" \
  --rpc-url "$SOROBAN_RPC_URL" \
  --network-passphrase "Test SDF Network ; September 2015" \
  -- "get_merchant" --merchant "$MERCHANT_ADDRESS"
```

If the call is failing in production but not in a local replay, compare the exact payload, merchant state, and account balances.

### Mitigation

- Pause the affected merchant flow if it violates contract rules.
- Confirm the merchant is active and registered before accepting payment.
- If backend logic is producing malformed payloads, stop the producer and fix bad parameter generation before resuming.
- Temporarily disable the specific payment path causing the error if it is not customer-critical.

Escalate to the contract owner if the error is reproducible and indicates a logic bug rather than malformed input.

---

## C. Signature verification failures

Symptoms:

- Transactions fail with invalid signature or signature mismatch errors.
- The same payment payload succeeds for some users and fails for others.
- Failures spike after a client or wallet update.

### Investigation steps

1. Check signature validation failures in Grafana.

```sql
sum(rate(signature_verification_total{result="failed"}[5m])) by (reason)
```

```sql
sum(rate(payment_attempt_total{status="failed"}[5m])) by (merchant, error_type)
```

2. Validate the request payload and signing format.

```bash
jq '.payload' payment-request.json
cat payment-request.json | jq -r '.signature' | head -c 128
```

Also confirm the signed payload matches the exact order, merchant, and amount expected by the contract.

3. Compare the signer address and signature algorithm used by the client.

```bash
stellar keys ls
```

If the error includes an invalid ed25519 signature, verify the payload is canonical and not modified before submission.

### Mitigation

- Invalidate and regenerate the payment payload when a signer or client library has changed.
- Reject resubmissions of stale signatures and expired payment requests.
- Temporarily disable the affected wallet integration while the signature pipeline is corrected.
- Force clients to re-authenticate if the failure pattern points to account mismatch or stale key material.

Escalate to the wallet or payment integration owner when the same payload format is rejected across multiple merchants or clients.

---

## D. Token allowance exhaustion

Symptoms:

- Payment attempts fail with allowance-related errors.
- Many merchant or wallet flows fail after a burst of activity.
- Failures are concentrated around token spend approval thresholds.

### Investigation steps

1. Check allowance exhaustion and token spend errors in Grafana.

```sql
sum(rate(token_allowance_total{result="exhausted"}[5m])) by (asset, spender)
```

```sql
sum(rate(contract_error_total{kind="allowance"}[5m])) by (asset)
```

2. Inspect the current approval state for the relevant wallet or contract.

```bash
stellar contract invoke \
  --id "$TOKEN_CONTRACT_ID" \
  --source-account "$SOURCE_SECRET" \
  --rpc-url "$SOROBAN_RPC_URL" \
  --network-passphrase "Test SDF Network ; September 2015" \
  -- "allowance" --from "$WALLET_ADDRESS" --spender "$MERCHANT_ADDRESS"
```

3. Check if the allowed spend amount is lower than the current payment volume.

```bash
jq '.allowance' token-allowance.json
```

### Mitigation

- Increase or refresh the allowance before resuming payment processing.
- Temporarily limit the merchant or queue to smaller amounts until the approval is restored.
- Send a targeted remediation notice to impacted merchants if the approval threshold is insufficient.
- If the allowance is being exhausted by a bot or retry loop, disable the retry path until the root cause is corrected.

Escalate to the token or wallet owner if allowance exhaustion continues even after the approval is refreshed, indicating a persistent state or bug issue.

---

## Escalation path

1. Start with service owner or on-call engineer for the affected payment path.
2. If RPC or Horizon health is degraded across all merchants, escalate to the platform/network owner.
3. If the contract rejects valid requests or the state is inconsistent, escalate to the contract owner or Soroban dev team.
4. If the issue is wallet- or signature-related, involve the client integration owner.
5. If the problem remains unresolved after 30 minutes, open an incident bridge and announce the current hypothesis, impact, and mitigation status.

Suggested communication template:

```text
Impact: Payment error rate elevated from 1.2% to 18% for testnet merchants.
Current status: Investigating RPC provider timeout leading to failed contract calls.
Mitigation: Switched to secondary RPC endpoint and reduced retry concurrency.
Next check: confirm ledger throughput and signature failure rate in Grafana.
```

---

## Post-incident follow-up

- Capture the exact error signature, time window, and affected merchants.
- Record whether the issue was caused by provider latency, contract logic, signature drift, or allowance exhaustion.
- File a follow-up issue if the mitigation exposed a repeated configuration mismatch or contract bug.
- Update the dashboard or alert thresholds if the incident reveals that the current signal is too noisy or too slow.

This runbook should be reviewed by the on-call team each quarter and updated whenever the payment stack changes.
