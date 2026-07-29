# LumenFlow Developer Onboarding — Video Script

**Target length:** ~10 minutes  
**Audience:** Developers integrating LumenFlow for the first time  
**Accessibility:** Captions/subtitles required — see notes at end of each segment  
**Review cadence:** Re-record or update on every major release (see CHANGELOG.md)

> **Video link:** [YouTube — LumenFlow Developer Onboarding](https://youtube.com/watch?v=PLACEHOLDER)
> *(Link will be updated once the video is published)*

---

## Segment 1 — Introduction (0:00–0:45)

**[SCREEN: LumenFlow GitHub repository landing page]**

**Narrator:**
Welcome to LumenFlow — a production-grade payment processing smart contract
built on Stellar's Soroban platform.

In the next ten minutes you will go from zero to running your first payment
on a local Stellar network. By the end of this video you will have:

- Cloned the repo and built the contract
- Started a local Stellar node with Docker
- Deployed the contract and registered a merchant
- Processed your first payment and checked the history

Let's get started.

**[CAPTION: "LumenFlow Developer Onboarding | ~10 min"]**

---

## Segment 2 — Prerequisites (0:45–2:00)

**[SCREEN: Terminal, running version commands]**

**Narrator:**
Before we begin, make sure you have four tools installed.

First, **Rust**. Run `rustc --version` to check. If you don't have it, install
it from rustup.rs.

```bash
rustc --version   # should print 1.87.0 or later
cargo --version
```

Second, the **Stellar CLI**. Check with `stellar --version`. Installation
instructions are linked in the repo README.

```bash
stellar --version
```

Third, **Docker**. We will use it to run a local Stellar node.

```bash
docker --version
```

Finally, add the WASM compilation target that Soroban requires:

```bash
rustup target add wasm32-unknown-unknown
```

**[SCREEN: Split view — README prerequisites table on the left, terminal on the right]**

Once all four commands return cleanly, you are ready to clone the repo.

**[CAPTION: "Prerequisites: Rust, Stellar CLI, Docker, WASM target"]**

---

## Segment 3 — Clone and Build (2:00–3:30)

**[SCREEN: Terminal]**

**Narrator:**
Clone the repository and build the contract WASM:

```bash
git clone https://github.com/Gloriachinedu/lumenflow-contracts.git
cd lumenflow-contracts
cargo build --target wasm32-unknown-unknown --release --package lumenflow
```

**[PAUSE — wait for build to complete, ~30 s]**

The compiled WASM lands at:

```
target/wasm32-unknown-unknown/release/lumenflow.wasm
```

Let's confirm the size is under the 128 KB Soroban limit:

```bash
wc -c target/wasm32-unknown-unknown/release/lumenflow.wasm
```

You should see approximately 55 000 bytes — well under the limit.

**[CAPTION: "Build time: ~30 seconds on a modern laptop"]**

---

## Segment 4 — Run the Test Suite (3:30–4:30)

**[SCREEN: Terminal — cargo test output]**

**Narrator:**
Before touching a network, let's verify everything works locally:

```bash
cargo test --all-features
```

You will see over one hundred tests pass. The test suite covers merchant
registration, payment processing, refund lifecycle, multisig payments,
subscriptions, escrow, and disputes.

For the full lint-and-test pipeline that mirrors CI, run:

```bash
./scripts/test.sh
```

**[PAUSE — show passing test output]**

Green across the board. Let's move on to the local network.

**[CAPTION: "100+ tests cover all contract entry points"]**

---

## Segment 5 — Start the Local Network (4:30–6:00)

**[SCREEN: Terminal — docker compose output]**

**Narrator:**
LumenFlow ships with a Docker Compose file that spins up a local Stellar node
with Soroban RPC enabled.

First, generate a local account and fund it:

```bash
stellar keys generate --network local alice
stellar keys address alice
```

Copy the address, then fund it via the local Friendbot:

```bash
curl "http://localhost:8000/friendbot?addr=<alice-address>"
```

Now start the full environment — node, deploy, and seed data — in one command:

```bash
export SOURCE_ACCOUNT=<alice-secret-key>
docker compose up
```

**[PAUSE — show setup service logs, highlight "CONTRACT_ID written" line]**

The `setup` service deploys the contract and prints the `CONTRACT_ID`. Copy it —
you will need it for every CLI call.

**[CAPTION: "Local node runs at http://localhost:8000"]**

---

## Segment 6 — First Contract Deploy and Admin Init (6:00–7:15)

**[SCREEN: Terminal]**

**Narrator:**
The Docker setup service handles deployment automatically. But to understand
what it does, here is the manual deploy command:

```bash
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/lumenflow.wasm \
  --source-account alice \
  --network local
```

Once deployed, initialise the admin — this can only be done once:

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source-account $ADMIN_KEY \
  --rpc-url http://localhost:8000/soroban/rpc \
  --network-passphrase "Standalone Network ; February 2017" \
  -- set_admin --admin $ADMIN_ADDRESS
```

And whitelist a token so payments can flow:

```bash
stellar contract invoke --id $CONTRACT_ID --source-account $ADMIN_KEY \
  --rpc-url http://localhost:8000/soroban/rpc \
  --network-passphrase "Standalone Network ; February 2017" \
  -- add_allowed_token --admin $ADMIN_ADDRESS --token $TOKEN_ADDRESS
```

**[CAPTION: "Admin initialisation is a one-time, irreversible operation"]**

---

## Segment 7 — Register a Merchant and Process a Payment (7:15–8:45)

**[SCREEN: Terminal]**

**Narrator:**
Register a merchant:

```bash
stellar contract invoke --id $CONTRACT_ID --source-account $MERCHANT_KEY \
  --rpc-url http://localhost:8000/soroban/rpc \
  --network-passphrase "Standalone Network ; February 2017" \
  -- register_merchant \
  --merchant_address $MERCHANT_ADDRESS \
  --name "Demo Store" \
  --description "Accepts payments for digital goods" \
  --contact_info "ops@example.com" \
  --category Retail
```

Now process a payment. For testnet and local runs you can use the nonce-based
variant which skips the Ed25519 signature check:

```bash
stellar contract invoke --id $CONTRACT_ID --source-account $PAYER_KEY \
  --rpc-url http://localhost:8000/soroban/rpc \
  --network-passphrase "Standalone Network ; February 2017" \
  -- process_payment_with_nonce \
  --payer $PAYER_ADDRESS \
  --order_id "ORDER_001" \
  --merchant_address $MERCHANT_ADDRESS \
  --token_address $TOKEN_ADDRESS \
  --amount 1000 \
  --memo "First demo payment" \
  --nonce 0
```

You should see the transaction hash in the output — payment complete.

**[CAPTION: "Ed25519 signature mode is required on mainnet — see docs/signature-format.md"]**

---

## Segment 8 — Check Payment History (8:45–9:30)

**[SCREEN: Terminal showing history output, then browser showing frontend/history.html]**

**Narrator:**
Query the merchant payment history:

```bash
stellar contract invoke --id $CONTRACT_ID --source-account $MERCHANT_KEY \
  --rpc-url http://localhost:8000/soroban/rpc \
  --network-passphrase "Standalone Network ; February 2017" \
  -- get_merchant_payment_history \
  --merchant $MERCHANT_ADDRESS \
  --cursor null \
  --limit 10 \
  --filter null \
  --sort_field Date \
  --sort_order Descending
```

You will see `ORDER_001` with status `Completed` and amount `1000`.

Alternatively, open the frontend in your browser for a visual view:

```bash
xdg-open frontend/history.html   # Linux
open frontend/history.html        # macOS
```

Set `LUMENFLOW_CONTRACT_ID`, `LUMENFLOW_NETWORK`, and `LUMENFLOW_RPC_URL` in
the page's script block to switch from demo mode to live mode.

**[CAPTION: "Frontend pages work offline in demo mode with no config required"]**

---

## Segment 9 — Next Steps (9:30–10:00)

**[SCREEN: docs/ONBOARDING.md open in browser]**

**Narrator:**
You have now built, deployed, registered a merchant, and processed your first
payment on LumenFlow. Here is what to explore next:

- **Refund lifecycle** — see `docs/refund-lifecycle.md`
- **Multi-signature payments** — see `docs/multisig-guide.md`
- **Ed25519 signature format** for mainnet payments — see `docs/signature-format.md`
- **SDK** — TypeScript helper library in `sdk/` for integrating from a backend
- **Contributing** — `CONTRIBUTING.md` and `docs/ONBOARDING.md` for your first PR

Join the Discord community or open a GitHub Discussion if you have questions.
Links are in the README.

Happy building!

**[SCREEN: LumenFlow logo + GitHub URL]**

**[CAPTION: "Full docs at github.com/Gloriachinedu/lumenflow-contracts"]**

---

## Production Notes

### Accessibility

- Add auto-generated captions in YouTube Studio after upload, then manually
  correct any technical terms (Soroban, XDR, Ed25519, Friendbot, etc.).
- Subtitle file (`.srt` or `.vtt`) should be committed to `docs/` alongside
  this script on first publish.

### Screen recording guidelines

- Resolution: 1920×1080, font size ≥ 14pt in terminal
- Terminal theme: high-contrast (dark background, light text)
- Highlight key lines with a cursor or annotation overlay
- Pause 2 s after each command output before narrating the next step

### Review schedule

This script must be reviewed and updated whenever a major release changes any
of the following:

- CLI command signatures
- Docker Compose setup flow
- Contract function names or parameters
- Default network endpoints

Create a GitHub issue referencing this file when a review is due.

### Recording checklist

- [ ] All terminal commands match the current `main` branch
- [ ] Contract version in `get_contract_version` output matches `Cargo.toml`
- [ ] YouTube link updated in the heading above after upload
- [ ] `docs/ONBOARDING.md` updated with the YouTube link
- [ ] Captions reviewed and corrected
- [ ] Video is marked public and listed in the channel
