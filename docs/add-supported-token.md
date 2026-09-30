# Adding a Supported Token (Asset Whitelisting)

Operator guide for adding a new Stellar/Soroban token to the LumenFlow
contract's allowlist: how to validate it on testnet, invoke the whitelisting
functions, smoke-test it, and promote it to mainnet.

This document is the "how" companion to
[docs/supported-asset-expansion-backlog.md](supported-asset-expansion-backlog.md)
(the "which asset, and why") and is referenced from
[docs/deployment-runbook.md](deployment-runbook.md) section 6 (post-deployment
verification).

---

## Prerequisites

- Contract already deployed and initialised (see
  [deployment-runbook.md](deployment-runbook.md) sections 3–5).
- Admin keypair with access to invoke admin-only contract calls.
- The candidate asset has already cleared the scoring and due-diligence gates
  in [supported-asset-expansion-backlog.md](supported-asset-expansion-backlog.md)
  (verified issuer, documented redemption path, no unresolved security
  findings).
- The token's Stellar Asset Contract (SAC) address for **both** the network
  you are validating on and the network you intend to promote to — these are
  different contract IDs on testnet vs. mainnet even for the "same" asset.

## The whitelisting mechanism

Tokens are gated by an on-chain allowlist in contract storage
(`storage::set_token_allowed` / `storage::is_token_allowed`), toggled by two
admin-only entry points:

- `add_allowed_token(admin, token, issuer)` — adds `token` to the allowlist.
  If the contract has any registered approved issuers (via
  `add_allowed_issuer`), `issuer` must be supplied and must match one of
  them, or the call fails with `InvalidIssuer`. If no issuers have been
  registered yet, `issuer` is ignored and any token may be added.
- `remove_allowed_token(admin, token)` — removes `token` from the allowlist.
  Payments for a removed token subsequently fail with `TokenNotAllowed`;
  already-completed payments are unaffected.
- `add_allowed_issuer(admin, issuer)` / `remove_allowed_issuer(admin, issuer)`
  — maintain the optional approved-issuer list that `add_allowed_token`
  checks against.

Every payment, batch payment, payment-request, and refund code path checks
`is_token_allowed` and rejects unlisted tokens with
[`PaymentError::TokenNotAllowed`]. There is no separate "config file"
whitelist for these flows — the allowlist is contract storage, set only
through the calls above.

> **Known issue — do not rely on the CLI signature shown by `--help` alone.**
> `contracts/lumenflow/src/lib.rs` currently contains **two** definitions of
> `add_allowed_token` (one 3-argument form with the `issuer` parameter
> described above, one older 2-argument form without it) and two definitions
> of `remove_allowed_token` in the same `impl` block. This guide documents the
> 3-argument/issuer-aware form, which is the one with full doc comments and
> issuer validation. Whichever definition the build actually resolves to
> should be confirmed against the ABI/CLI help output for your deployed WASM
> before running any of the commands below — this is a contract-code
> conflict, not a documentation choice, and is out of scope for this guide to
> fix. Flag it to a maintainer if you hit a signature mismatch.

## Step 1 — Testnet validation

1. Deploy or use an existing testnet contract instance
   ([deployment-runbook.md](deployment-runbook.md) section 4).
2. Obtain the token's testnet SAC address. For a new Stellar classic asset,
   derive it with `stellar contract asset id --asset CODE:ISSUER`.
3. (Optional) Register the issuer first if you want issuer validation
   enforced for future additions:

   ```bash
   stellar contract invoke \
     --id $CONTRACT_ID \
     --source-account $ADMIN_SECRET \
     --network-passphrase "$NETWORK_PASSPHRASE" \
     --rpc-url $RPC_URL \
     -- add_allowed_issuer \
     --admin $ADMIN_ADDRESS \
     --issuer $TOKEN_ISSUER_ADDRESS
   ```

4. Whitelist the token:

   ```bash
   stellar contract invoke \
     --id $CONTRACT_ID \
     --source-account $ADMIN_SECRET \
     --network-passphrase "$NETWORK_PASSPHRASE" \
     --rpc-url $RPC_URL \
     -- add_allowed_token \
     --admin $ADMIN_ADDRESS \
     --token $NEW_TOKEN_ADDRESS \
     --issuer $TOKEN_ISSUER_ADDRESS
   ```

   Omit `--issuer` (pass `null`) if no issuers are registered on this
   contract instance yet.

## Step 2 — Smoke test the new token

Run the standard smoke test, but override `TOKEN_ADDRESS` with the new
token's testnet SAC address so the payment step exercises it:

```bash
CONTRACT_ID=<contract-id> \
ADMIN_KEY=<admin-secret> \
MERCHANT_KEY=<merchant-secret> \
PAYER_KEY=<payer-secret> \
TOKEN_ADDRESS=<new-token-testnet-sac-address> \
ADMIN_ADDRESS=<admin-address> \
MERCHANT_ADDRESS=<merchant-address> \
PAYER_ADDRESS=<payer-address> \
NETWORK=testnet \
./scripts/smoke_test.sh
```

Confirm `✅ Smoke test passed.` (see
[deployment-runbook.md](deployment-runbook.md) section 6.1 for the full
smoke-test contract and failure-step diagnostics).

Beyond the base smoke test, exercise the paths a new asset actually needs:

- A refund on a payment made in the new token (`initiate_refund` →
  `approve_refund` → `execute_refund`).
- A batch payment containing at least one item in the new token
  (`process_batch_payment`; see [batch-payments.md](batch-payments.md)).
- A payment request created and paid in the new token
  (`create_payment_request` → `pay_payment_request`; see the "Payment
  Requests" folder in
  [lumenflow.postman_collection.json](lumenflow.postman_collection.json)).
- If the asset has clawback enabled at the issuer level, confirm a refund
  still completes if the issuer claws back the merchant's balance mid-flow
  (see the clawback row in
  [supported-asset-expansion-backlog.md](supported-asset-expansion-backlog.md#failure-permission-and-boundary-cases)).

## Step 3 — Security considerations before promotion

Do not promote to mainnet until each item below is explicitly checked off:

- **Issuer trust.** Confirm the issuer identity, regulatory status, and
  reserve/audit posture per the criteria in
  [supported-asset-expansion-backlog.md](supported-asset-expansion-backlog.md#prioritization-criteria).
  Hard gates (verified issuer, documented redemption path, no unresolved
  security findings) must pass regardless of demand score.
- **Clawback exposure.** If the issuer can clawback balances, flag the asset
  as `clawback: true` in any client-side config and verify the refund/dispute
  flow behaves correctly when a clawback happens mid-refund.
- **Decimals and precision.** Confirm the token's `decimals()` matches what
  the SDK and frontend expect; a mismatch silently corrupts displayed and
  computed amounts without a contract-level error.
- **Rate limits and batch caps.** The token itself does not get its own rate
  limit — it shares the merchant-level and batch-size (10 item) limits. Confirm
  this is acceptable for the asset's expected transaction volume.
- **Duplicate display symbols.** If another allowed token shares a display
  symbol (e.g. two USDC issuers), confirm the SDK/UI disambiguate by issuer,
  not by symbol.
- **Admin key custody.** `add_allowed_token` and `add_allowed_issuer` are
  admin-only. Follow the key-handling practices in
  [admin-key-rotation.md](admin-key-rotation.md) — do not run this step from a
  key that hasn't gone through that process's custody checks.
- **Rollback plan.** Confirm `remove_allowed_token` is sufficient to disable
  the asset if a problem is found post-launch (it is — it does not affect
  already-completed payments, only new ones).

## Step 4 — Mainnet promotion

1. Repeat step 1 against the mainnet contract, using **mainnet** admin
   keys and the token's **mainnet** SAC address (never reuse a testnet
   token address on mainnet — see the caution in
   [deployment-runbook.md](deployment-runbook.md) section 5, Step 1).
2. Repeat the smoke test and asset-specific checks from step 2 against
   mainnet, ideally with a pilot merchant rather than the full merchant base.
3. Update the SDK constants / generated types and
   [webhook-integration.md](webhook-integration.md) with the new asset code,
   per the rollout checklist in
   [supported-asset-expansion-backlog.md](supported-asset-expansion-backlog.md#rollout-checklist-per-asset).
4. Move the asset from "Prioritized Backlog" to "shipped" status in
   [supported-asset-expansion-backlog.md](supported-asset-expansion-backlog.md)
   and announce in [CHANGELOG.md](../CHANGELOG.md).

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `InvalidIssuer` on `add_allowed_token` | An issuer allowlist exists (via `add_allowed_issuer`) and the supplied `issuer` isn't on it, or was omitted |
| `TokenNotAllowed` on a payment after whitelisting | Whitelisted on the wrong network/contract instance, or the token address is the testnet SAC while paying against mainnet (or vice versa) |
| `Unauthorized` on `add_allowed_token` / `add_allowed_issuer` | Caller is not the configured admin address; see [admin-key-rotation.md](admin-key-rotation.md) |
| CLI rejects the argument list for `add_allowed_token` | The build resolved the older 2-argument definition — see "Known issue" above; confirm the actual deployed ABI |
