# SDK Integration Video Script

An 8–10 minute screen-recorded walkthrough for integrators who want to go
from `npm install` to a working payment integration using `@lumenflow/sdk`.
This is the SDK-focused companion to
[docs/onboarding-video-script.md](onboarding-video-script.md), which covers
contributing to the contract repository itself rather than integrating the
published SDK.

Every command and code snippet below is taken directly from
[sdk/README.md](../sdk/README.md) so the recording matches what a viewer
will find if they read the docs afterward. Update this script if that file's
Quick Start, Error Handling, or Real-Time Payment Notifications sections
change.

## Target audience

Backend/web engineers integrating LumenFlow payments into an existing
Stellar-aware application. Assumes basic TypeScript familiarity; does not
assume prior Soroban or Stellar SDK experience.

## Target duration: 8–10 minutes

| Segment | Time | Topic |
|---|---|---|
| 1 | 0:00–0:45 | Intro & what you'll build |
| 2 | 0:45–2:00 | Installation |
| 3 | 2:00–3:30 | Client setup |
| 4 | 3:30–6:00 | First payment |
| 5 | 6:00–7:45 | Handling errors |
| 6 | 7:45–9:15 | Event subscription |
| 7 | 9:15–10:00 | Wrap-up & next steps |

---

## Segment 1 — Intro (0:00–0:45)

**On screen:** Title card, then the repo's `sdk/README.md` at the top.

**Narration:**

> "This is a walkthrough of `@lumenflow/sdk`, the TypeScript SDK for the
> LumenFlow payment contract on Stellar's Soroban platform. By the end of
> this video you'll have installed the SDK, initialized a client against
> testnet, submitted a signed payment, handled a contract error, and
> subscribed to real-time payment events. Everything I run is copy-pasteable
> from the SDK README, so you can follow along or come back to it later."

---

## Segment 2 — Installation (0:45–2:00)

**On screen:** Terminal.

**Narration:**

> "First, install the SDK alongside the underlying Stellar SDK, since the
> SDK's payment-signing helper depends on it directly."

**Commands (screen-record verbatim):**

```bash
npm install @lumenflow/sdk @stellar/stellar-sdk
```

**Narration:**

> "You'll also need a funded testnet account. If you don't have one, Stellar's
> Friendbot will fund a new keypair for free — just hit
> `https://friendbot.stellar.org/?addr=YOUR_ADDRESS` with an address you
> control."

**On screen:** Briefly show the Friendbot URL in a browser tab returning a
funded-account JSON response.

---

## Segment 3 — Client setup (2:00–3:30)

**On screen:** Editor, new file `quickstart.ts`.

**Narration:**

> "Create a client pointed at testnet, and give it a signer function. The
> signer is how the SDK gets your transactions signed before submission —
> it's called for every state-changing contract call."

**Code (type or paste on screen):**

```typescript
// quickstart.ts
import { LumenFlowClient } from '@lumenflow/sdk';
import { Keypair } from '@stellar/stellar-sdk';

const CONTRACT_ID = 'CC...'; // your deployed testnet contract ID

const client = new LumenFlowClient({
  contractId: CONTRACT_ID,
  rpcUrl: 'https://soroban-testnet.stellar.org',
  networkPassphrase: 'Test SDF Network ; September 2015',
});

const adminKeypair = Keypair.fromSecret('S...'); // your admin account secret
client.setSigner(async (tx) => {
  tx.sign(adminKeypair);
  return tx;
});
```

**Narration:**

> "Note the signer isn't fixed to one keypair for the client's lifetime — you
> call `setSigner` again whenever you need to switch which account signs the
> next call, for example switching from an admin key to a merchant key. We'll
> do exactly that in the next segment."

---

## Segment 4 — First payment (3:30–6:00)

**On screen:** Continue in the editor.

**Narration:**

> "Before a merchant can be paid, it needs to be registered. Switch the
> signer to the merchant's own keypair, then check `isRegistered` before
> registering — registering twice is rejected by the contract."

**Code:**

```typescript
import { MerchantCategory } from '@lumenflow/sdk';

const merchantKeypair = Keypair.fromSecret('S...'); // merchant account secret

client.setSigner(async (tx) => {
  tx.sign(merchantKeypair);
  return tx;
});

const isRegistered = await client.isRegistered(merchantKeypair.publicKey());

if (!isRegistered) {
  await client.registerMerchant(
    merchantKeypair.publicKey(),
    'My Test Store',
    'Selling digital goods on Stellar',
    'support@myteststore.example.com',
    MerchantCategory.Retail,
  );
}
```

**Narration:**

> "Now the interesting part: submitting a payment. Payments are authorized by
> an ed25519 signature the merchant computes over the payment payload — not
> just a Stellar transaction signature. The SDK's `signPaymentPayload` helper
> builds that payload and signs it for you."

**Code:**

```typescript
import { signPaymentPayload } from '@lumenflow/sdk/signPaymentPayload';

const payerKeypair = Keypair.fromSecret('S...'); // payer account secret
client.setSigner(async (tx) => {
  tx.sign(payerKeypair);
  return tx;
});

const orderId = `ORDER_${Date.now()}`;
const amount = 1000n; // smallest unit of the token — stroops for XLM

const { signature, publicKey } = await signPaymentPayload({
  networkPassphrase: 'Test SDF Network ; September 2015',
  contractId: CONTRACT_ID,
  merchantAddress: merchantKeypair.publicKey(),
  orderId,
  amount,
  merchantSecretKey: merchantKeypair.rawSecretKey(),
});

await client.processPaymentWithSignature(
  payerKeypair.publicKey(),
  orderId,
  merchantKeypair.publicKey(),
  TOKEN_ADDRESS, // e.g. testnet USDC SAC address
  amount,
  'Quickstart test payment',
  null,
  signature,
  publicKey,
);

console.log('Payment submitted! Order ID:', orderId);
```

**On screen:** Run the script, show the console log with the order ID, then
quickly show `getMerchantPaymentHistory` returning that order.

**Narration:**

> "If you need to send several payments in one transaction instead, the SDK
> and contract also support batch payments — up to ten items at once. That's
> covered in `docs/batch-payments.md` and isn't something I'll demo here, but
> know it exists before you reach for ten separate calls."

---

## Segment 5 — Handling errors (6:00–7:45)

**On screen:** Editor, wrap the payment call in a try/catch.

**Narration:**

> "Contract and RPC failures don't come back as generic errors — they're
> normalized into a typed `LumenFlowError` with a numeric `code`, a
> human-readable `codeName`, and a catalogue `message`. That means you can
> branch on the specific failure instead of parsing a string."

**Code:**

```typescript
import { LumenFlowError, PaymentErrorCode } from '@lumenflow/sdk';

try {
  await client.processPaymentWithSignature(/* ...as above... */);
} catch (err) {
  if (err instanceof LumenFlowError) {
    switch (err.code) {
      case PaymentErrorCode.InvalidSignature:
        console.error('Signature check failed — recompute the payload signature');
        break;
      case PaymentErrorCode.DuplicateOrderId:
        console.error('This order ID was already used — generate a new one');
        break;
      default:
        console.error(`Contract error ${err.code}: ${err.message}`);
    }
  }
}
```

**Narration:**

> "One detail worth calling out on camera: `LumenFlowError` implements
> `toJSON()`, so `JSON.stringify(err)` actually gives you something useful —
> code, name, and message — instead of the `{}` you'd get from a bare
> `Error`. That matters the moment you log these to a file or ship them
> across a network boundary."

---

## Segment 6 — Event subscription (7:45–9:15)

**On screen:** New snippet, editor.

**Narration:**

> "Rather than polling for new payments, subscribe to them. `subscribeToPayments`
> opens a Horizon Server-Sent-Events stream for a merchant address and calls
> your callback with a strongly-typed event every time a payment lands."

**Code:**

```typescript
import { subscribeToPayments } from '@lumenflow/sdk';

const subscription = subscribeToPayments(
  merchantKeypair.publicKey(),
  (event) => {
    console.log('Payment received!');
    console.log('  From:    ', event.payer);
    console.log('  Amount:  ', event.amount.toString(), 'stroops');
    console.log('  Order ID:', event.order_id);
  },
  { horizonUrl: 'https://horizon-testnet.stellar.org' },
);

// later, when you no longer need it:
// subscription.unsubscribe();
```

**Narration:**

> "It reconnects automatically after 30 seconds of inactivity, so a dropped
> connection doesn't silently stop your app from hearing about payments.
> Call `unsubscribe()` when you're done — for example when a checkout page
> unmounts."

---

## Segment 7 — Wrap-up (9:15–10:00)

**On screen:** Back to `sdk/README.md`, scrolled to the table of contents.

**Narration:**

> "That's the core loop: install, configure a client and signer, register a
> merchant, submit a signed payment, handle typed errors, and subscribe to
> events in real time. The README covers everything else you'll eventually
> need — refunds, multi-signature payments, payment requests, batch
> payments, and the SDK's built-in retry and rate-limit handling. If
> something in this video and the README ever disagree, trust the README —
> and if you're reading this as a maintainer, that's your cue to update
> this script too."

---

## Recording notes

- Record all code segments against **testnet**, never mainnet, using
  disposable Friendbot-funded keypairs.
- Redact or blur any real secret key (`S...`) shown on screen; use the
  literal placeholder values from this script or generate fresh throwaway
  keys immediately before recording.
- Keep terminal font size large enough to read at 1080p.
- Cut dead air from `npm install` / RPC round-trips in post; narrate over
  the wait rather than showing it in real time.

## Review

Per the issue's acceptance criteria, this script should be reviewed by the
SDK maintainer before recording, in case the Quick Start flow in
`sdk/README.md` has changed since this was written.
