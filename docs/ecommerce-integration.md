# LumenFlow E-Commerce Integration Guide

This guide walks merchants through integrating LumenFlow payments into their storefront — from SDK installation to webhook handling and refunds.

**Supported platforms:** Next.js (Node.js), Vanilla JavaScript, Shopify Storefront, WooCommerce.

For off-chain notification setup, see [docs/webhook-integration.md](webhook-integration.md).

---

## Table of Contents

1. [SDK Installation](#1-sdk-installation)
2. [Payment Button Integration](#2-payment-button-integration)
3. [Webhook Setup](#3-webhook-setup)
4. [Refund Handling](#4-refund-handling)
5. [Next.js (Node.js) Integration](#5-nextjs-nodejs-integration)
6. [Vanilla JavaScript Integration](#6-vanilla-javascript-integration)
7. [Shopify Integration](#7-shopify-integration)
8. [WooCommerce Integration](#8-woocommerce-integration)

---

## 1. SDK Installation

### Node.js / Next.js

```bash
npm install @stellar/stellar-sdk
# or
yarn add @stellar/stellar-sdk
```

You will also need environment variables for your contract and network:

```env
# .env.local
NEXT_PUBLIC_LUMENFLOW_CONTRACT_ID=C...
NEXT_PUBLIC_STELLAR_NETWORK=testnet
NEXT_PUBLIC_STELLAR_RPC_URL=https://soroban-testnet.stellar.org
STELLAR_NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
LUMENFLOW_MERCHANT_SECRET=S...
```

> **Never expose the merchant secret key to the browser.** All signing must happen server-side.

### Vanilla JavaScript (browser)

```html
<script type="module">
  import { StellarSdk } from 'https://esm.sh/@stellar/stellar-sdk@latest';
</script>
```

Or bundle it via your preferred bundler (Webpack / Vite / Rollup):

```bash
npm install @stellar/stellar-sdk
```

---

## 2. Payment Button Integration

The payment flow has three steps:

1. **Generate a unique order ID** on your server.
2. **Sign the payment payload** with the merchant's ed25519 key (server-side).
3. **Submit the transaction** to the Soroban RPC.

### Payload structure

The merchant signs: `sha256(order_id + ":" + amount + ":" + merchant_address)`.

```js
import { hash } from '@stellar/stellar-sdk';

/**
 * Build the signing payload for a LumenFlow payment.
 * @param {string} orderId   - Unique order identifier
 * @param {bigint} amount    - Payment amount in stroops
 * @param {string} merchant  - Merchant Stellar address (G...)
 * @returns {Buffer}         - 32-byte hash to sign
 */
export function buildPaymentPayload(orderId, amount, merchant) {
  const raw = `${orderId}:${amount.toString()}:${merchant}`;
  return hash(Buffer.from(raw, 'utf8'));
}
```

### Signing (server-side only)

```js
import { Keypair } from '@stellar/stellar-sdk';

/**
 * Sign a payment payload with the merchant keypair.
 * MUST be called server-side — never expose the secret key.
 */
export function signPayload(payload, merchantSecretKey) {
  const keypair = Keypair.fromSecret(merchantSecretKey);
  return keypair.sign(payload);          // returns 64-byte Uint8Array
}
```

---

## 3. Webhook Setup

Webhooks notify your server when on-chain events are confirmed. LumenFlow emits the following events:

| Event | Trigger |
|-------|---------|
| `lumenflow/payment_processed` | Payment confirmed on-chain |
| `lumenflow/refund_initiated` | Refund request opened |
| `lumenflow/refund_executed` | Refund transfer completed |

For the full webhook setup (event listener, HMAC verification, retry logic), see [docs/webhook-integration.md](webhook-integration.md).

### Minimal webhook endpoint (Next.js API route)

```js
// pages/api/webhooks/lumenflow.js
import crypto from 'crypto';

const WEBHOOK_SECRET = process.env.LUMENFLOW_WEBHOOK_SECRET;

export default function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // Verify HMAC signature
  const sig = req.headers['x-lumenflow-signature'];
  const body = JSON.stringify(req.body);
  const expected = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(body)
    .digest('hex');

  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const { event, data } = req.body;

  switch (event) {
    case 'lumenflow/payment_processed':
      // Fulfil the order
      await fulfillOrder(data.order_id, data.amount);
      break;
    case 'lumenflow/refund_executed':
      // Update order status
      await markRefunded(data.order_id, data.refund_id);
      break;
    default:
      console.log('Unhandled event:', event);
  }

  res.status(200).json({ received: true });
}
```

---

## 4. Refund Handling

### Initiate a refund (server-side)

```js
import { Contract, Networks, TransactionBuilder, BASE_FEE } from '@stellar/stellar-sdk';

/**
 * Initiate a refund for an order.
 * @param {string} orderId     - Original order ID
 * @param {string} refundId    - Unique refund identifier
 * @param {bigint} amount      - Amount to refund (≤ original amount)
 * @param {string} reason      - Human-readable reason
 */
export async function initiateRefund({ orderId, refundId, amount, reason, callerKeypair, server }) {
  const contract = new Contract(process.env.NEXT_PUBLIC_LUMENFLOW_CONTRACT_ID);

  const account = await server.getAccount(callerKeypair.publicKey());
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: process.env.STELLAR_NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call(
        'initiate_refund',
        xdr.ScVal.scvAddress(callerKeypair.publicKey()),
        xdr.ScVal.scvString(refundId),
        xdr.ScVal.scvString(orderId),
        xdr.ScVal.scvI128(amount),
        xdr.ScVal.scvString(reason),
      )
    )
    .setTimeout(30)
    .build();

  tx.sign(callerKeypair);
  return server.sendTransaction(tx);
}
```

### Refund rules (enforced on-chain)

- Refunds must be initiated within **30 days** of `paid_at`.
- Partial refunds are allowed; cumulative total cannot exceed the original amount.
- The **merchant or admin** must approve before execution.
- The **merchant** executes the token transfer.

---

## 5. Next.js (Node.js) Integration

This section shows a complete Next.js checkout integration with a server-side API route for signing and a client-side payment button.

### Project structure

```
my-shop/
├── pages/
│   ├── checkout.js          # Checkout page with payment button
│   └── api/
│       ├── create-order.js  # Generates order ID + merchant signature
│       └── webhooks/
│           └── lumenflow.js # Webhook handler
├── lib/
│   └── lumenflow.js         # Shared SDK helpers
└── .env.local
```

### `lib/lumenflow.js` — shared helpers

```js
import {
  SorobanRpc,
  TransactionBuilder,
  Contract,
  Networks,
  BASE_FEE,
  xdr,
  Keypair,
  hash,
} from '@stellar/stellar-sdk';

export const rpc = new SorobanRpc.Server(process.env.NEXT_PUBLIC_STELLAR_RPC_URL);
export const CONTRACT_ID = process.env.NEXT_PUBLIC_LUMENFLOW_CONTRACT_ID;
export const NETWORK_PASSPHRASE = process.env.STELLAR_NETWORK_PASSPHRASE;

/** Build the 32-byte payment signing payload */
export function buildPaymentPayload(orderId, amount, merchantAddress) {
  const raw = `${orderId}:${amount.toString()}:${merchantAddress}`;
  return hash(Buffer.from(raw, 'utf8'));
}

/** Sign with merchant keypair (server-side only) */
export function signPayload(payload) {
  const kp = Keypair.fromSecret(process.env.LUMENFLOW_MERCHANT_SECRET);
  return { signature: kp.sign(payload), publicKey: kp.rawPublicKey() };
}

/** Submit a signed payment transaction */
export async function processPayment({
  payerKeypair,
  orderId,
  merchantAddress,
  tokenAddress,
  amount,
  memo,
  signature,
  merchantPublicKey,
}) {
  const contract = new Contract(CONTRACT_ID);
  const account = await rpc.getAccount(payerKeypair.publicKey());

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call(
        'process_payment_with_signature',
        xdr.ScVal.scvAddress(payerKeypair.publicKey()),
        xdr.ScVal.scvString(orderId),
        xdr.ScVal.scvAddress(merchantAddress),
        xdr.ScVal.scvAddress(tokenAddress),
        xdr.ScVal.scvI128(BigInt(amount)),
        xdr.ScVal.scvString(memo),
        xdr.ScVal.scvBytes(signature),
        xdr.ScVal.scvBytes(merchantPublicKey),
      )
    )
    .setTimeout(30)
    .build();

  const prepared = await rpc.prepareTransaction(tx);
  prepared.sign(payerKeypair);
  return rpc.sendTransaction(prepared);
}
```

### `pages/api/create-order.js` — server-side order creation

```js
import { buildPaymentPayload, signPayload } from '../../lib/lumenflow';
import { randomUUID } from 'crypto';

export default function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { amount, merchantAddress } = req.body;
  if (!amount || !merchantAddress) {
    return res.status(400).json({ error: 'Missing amount or merchantAddress' });
  }

  // Generate a unique, idempotent order ID
  const orderId = `ORDER_${Date.now()}_${randomUUID()}`;
  const payload = buildPaymentPayload(orderId, BigInt(amount), merchantAddress);
  const { signature, publicKey } = signPayload(payload);

  res.status(200).json({
    orderId,
    signature: Buffer.from(signature).toString('hex'),
    merchantPublicKey: Buffer.from(publicKey).toString('hex'),
  });
}
```

### `pages/checkout.js` — client-side payment button

```jsx
import { useState } from 'react';

export default function Checkout({ cart }) {
  const [status, setStatus] = useState('idle');
  const MERCHANT = process.env.NEXT_PUBLIC_MERCHANT_ADDRESS;
  const TOKEN = process.env.NEXT_PUBLIC_TOKEN_ADDRESS;

  async function handlePay() {
    setStatus('loading');
    try {
      // 1. Get signed order from server
      const orderRes = await fetch('/api/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: cart.total, merchantAddress: MERCHANT }),
      });
      const { orderId, signature, merchantPublicKey } = await orderRes.json();

      // 2. Connect payer wallet (e.g. Freighter)
      const { publicKey } = await window.freighter.getPublicKey();

      // 3. Build and submit transaction via your API
      const payRes = await fetch('/api/pay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payerAddress: publicKey,
          orderId,
          merchantAddress: MERCHANT,
          tokenAddress: TOKEN,
          amount: cart.total,
          memo: `Order ${orderId}`,
          signature,
          merchantPublicKey,
        }),
      });

      if (!payRes.ok) throw new Error('Payment failed');
      setStatus('success');
    } catch (err) {
      console.error(err);
      setStatus('error');
    }
  }

  return (
    <div>
      <p>Total: {cart.total} XLM</p>
      <button onClick={handlePay} disabled={status === 'loading'}
        aria-label="Pay with LumenFlow"
        aria-busy={status === 'loading'}>
        {status === 'loading' ? 'Processing…' : 'Pay with LumenFlow'}
      </button>
      {status === 'success' && <p role="status">Payment successful!</p>}
      {status === 'error' && <p role="alert">Payment failed. Please try again.</p>}
    </div>
  );
}
```

---

## 6. Vanilla JavaScript Integration

For storefronts that do not use a framework, you can integrate LumenFlow with plain ES modules.

### `lumenflow-pay.js`

```js
/**
 * LumenFlow payment helper — vanilla JS / browser
 * Requires: @stellar/stellar-sdk bundled or loaded via ESM CDN
 */
import {
  SorobanRpc,
  TransactionBuilder,
  Contract,
  BASE_FEE,
  xdr,
} from '@stellar/stellar-sdk';

const CONFIG = {
  contractId: document.querySelector('meta[name="lf-contract-id"]')?.content,
  rpcUrl: document.querySelector('meta[name="lf-rpc-url"]')?.content,
  networkPassphrase: document.querySelector('meta[name="lf-network-passphrase"]')?.content,
};

/**
 * Pay via LumenFlow.
 * @param {object} opts
 * @param {string} opts.orderId
 * @param {string} opts.payerAddress
 * @param {string} opts.merchantAddress
 * @param {string} opts.tokenAddress
 * @param {number} opts.amount         - in stroops
 * @param {string} opts.memo
 * @param {Uint8Array} opts.signature  - from server
 * @param {Uint8Array} opts.merchantPublicKey - from server
 * @param {Function} opts.signTransaction - wallet sign callback (e.g. Freighter)
 */
export async function lfPay(opts) {
  const server = new SorobanRpc.Server(CONFIG.rpcUrl);
  const contract = new Contract(CONFIG.contractId);
  const account = await server.getAccount(opts.payerAddress);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: CONFIG.networkPassphrase,
  })
    .addOperation(
      contract.call(
        'process_payment_with_signature',
        xdr.ScVal.scvAddress(opts.payerAddress),
        xdr.ScVal.scvString(opts.orderId),
        xdr.ScVal.scvAddress(opts.merchantAddress),
        xdr.ScVal.scvAddress(opts.tokenAddress),
        xdr.ScVal.scvI128(BigInt(opts.amount)),
        xdr.ScVal.scvString(opts.memo),
        xdr.ScVal.scvBytes(opts.signature),
        xdr.ScVal.scvBytes(opts.merchantPublicKey),
      )
    )
    .setTimeout(30)
    .build();

  const prepared = await server.prepareTransaction(tx);
  const signedXdr = await opts.signTransaction(prepared.toXDR());
  const signed = TransactionBuilder.fromXDR(signedXdr, CONFIG.networkPassphrase);
  return server.sendTransaction(signed);
}
```

### Usage in HTML

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta name="lf-contract-id" content="C...">
  <meta name="lf-rpc-url" content="https://soroban-testnet.stellar.org">
  <meta name="lf-network-passphrase" content="Test SDF Network ; September 2015">
</head>
<body>
  <button id="lf-pay-btn" aria-label="Pay with LumenFlow">Pay 10 XLM</button>

  <script type="module">
    import { lfPay } from './lumenflow-pay.js';

    document.getElementById('lf-pay-btn').addEventListener('click', async () => {
      // 1. Fetch signed order from your backend
      const res = await fetch('/api/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: 100000000, merchantAddress: 'G...' }),
      });
      const { orderId, signature, merchantPublicKey } = await res.json();

      // 2. Connect Freighter wallet
      const { publicKey } = await window.freighter.getPublicKey();

      // 3. Submit payment
      const result = await lfPay({
        orderId,
        payerAddress: publicKey,
        merchantAddress: 'G...',
        tokenAddress: 'G...',
        amount: 100000000,
        memo: `Order ${orderId}`,
        signature: Uint8Array.from(Buffer.from(signature, 'hex')),
        merchantPublicKey: Uint8Array.from(Buffer.from(merchantPublicKey, 'hex')),
        signTransaction: window.freighter.signTransaction,
      });

      console.log('Payment submitted:', result.hash);
    });
  </script>
</body>
</html>
```

---

## 7. Shopify Integration

Shopify storefronts can integrate LumenFlow via the **Storefront API** and a custom app.

### Architecture

```
Shopify Storefront
     ↓ (Storefront API)
Your Next.js/Node.js checkout service
     ↓ (process_payment_with_signature)
LumenFlow Soroban contract
     ↓ (webhook)
Your webhook endpoint
     ↓ (Order API)
Shopify backend (mark order as paid)
```

### Step 1 — Create a custom Shopify app

1. In your Shopify admin, go to **Apps** → **App and sales channel settings** → **Develop apps**.
2. Create a new app with these scopes:
   - `read_orders`, `write_orders` (to fulfil orders)
   - `read_products` (to display cart items)
3. Install the app and copy the **Admin API access token**.

### Step 2 — Storefront API checkout hook

Use the Shopify Storefront API to retrieve cart details and pass them to your payment backend:

```js
// lib/shopify-storefront.js
const STOREFRONT_API = process.env.SHOPIFY_STOREFRONT_API_URL;
const ACCESS_TOKEN = process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN;

export async function getCheckout(checkoutId) {
  const query = `
    query ($id: ID!) {
      node(id: $id) {
        ... on Checkout {
          id
          totalPriceV2 { amount currencyCode }
          lineItems(first: 100) {
            edges {
              node {
                title
                quantity
                variant { priceV2 { amount } }
              }
            }
          }
        }
      }
    }
  `;

  const res = await fetch(STOREFRONT_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Storefront-Access-Token': ACCESS_TOKEN,
    },
    body: JSON.stringify({ query, variables: { id: checkoutId } }),
  });

  return res.json();
}
```

### Step 3 — Custom checkout page with LumenFlow

```jsx
// pages/shopify-checkout.js
import { useEffect, useState } from 'react';
import { getCheckout } from '../lib/shopify-storefront';

export default function ShopifyCheckout({ checkoutId }) {
  const [checkout, setCheckout] = useState(null);

  useEffect(() => {
    getCheckout(checkoutId).then(setCheckout);
  }, [checkoutId]);

  async function handlePayWithLumenFlow() {
    const amount = Math.round(parseFloat(checkout.totalPriceV2.amount) * 1e7); // XLM stroops

    // 1. Get signed order
    const orderRes = await fetch('/api/create-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount, merchantAddress: process.env.NEXT_PUBLIC_MERCHANT_ADDRESS }),
    });
    const { orderId, signature, merchantPublicKey } = await orderRes.json();

    // 2. Connect wallet + submit payment
    // (same flow as Next.js §5)
  }

  return (
    <div>
      <h1>Checkout</h1>
      {checkout && (
        <>
          <p>Total: {checkout.totalPriceV2.amount} {checkout.totalPriceV2.currencyCode}</p>
          <button onClick={handlePayWithLumenFlow}>Pay with LumenFlow</button>
        </>
      )}
    </div>
  );
}
```

### Step 4 — Webhook fulfils the Shopify order

```js
// pages/api/webhooks/lumenflow.js
import shopify from '../../lib/shopify-admin';

export default async function handler(req, res) {
  // ... HMAC verification (see §3) ...

  const { event, data } = req.body;

  if (event === 'lumenflow/payment_processed') {
    // Mark Shopify order as paid
    const shopifyOrderId = await getShopifyOrderIdByLFOrderId(data.order_id);
    await shopify.order.update(shopifyOrderId, {
      financial_status: 'paid',
    });

    // Fulfil the order
    await shopify.fulfillment.create(shopifyOrderId, {
      location_id: process.env.SHOPIFY_LOCATION_ID,
      tracking_number: null,
      notify_customer: true,
    });
  }

  res.status(200).json({ received: true });
}
```

**Shopify-specific notes:**
- The checkout is created via the Storefront API `checkoutCreate` mutation.
- After payment confirmation, use the **Admin API** to mark the order paid and fulfilled.
- Store the mapping between `orderId` (LumenFlow) and `order.id` (Shopify) in your database.

---

## 8. WooCommerce Integration

WooCommerce integrations are built as a **payment gateway plugin** using the `WC_Payment_Gateway` class.

### Plugin structure

```
lumenflow-woocommerce/
├── lumenflow-woocommerce.php   # Plugin entry point
├── includes/
│   └── class-wc-lumenflow-gateway.php
└── assets/
    └── js/
        └── lumenflow-checkout.js
```

### `lumenflow-woocommerce.php`

```php
<?php
/**
 * Plugin Name: LumenFlow Payments for WooCommerce
 * Description: Accept LumenFlow (Stellar/Soroban) payments in your WooCommerce store.
 * Version: 1.0.0
 * Requires WC: 7.0
 */

defined('ABSPATH') || exit;

add_action('plugins_loaded', 'lumenflow_wc_init');

function lumenflow_wc_init() {
    if (!class_exists('WC_Payment_Gateway')) {
        return;
    }
    require_once plugin_dir_path(__FILE__) . 'includes/class-wc-lumenflow-gateway.php';
}

add_filter('woocommerce_payment_gateways', function ($gateways) {
    $gateways[] = 'WC_LumenFlow_Gateway';
    return $gateways;
});
```

### `includes/class-wc-lumenflow-gateway.php`

```php
<?php
class WC_LumenFlow_Gateway extends WC_Payment_Gateway {

    public function __construct() {
        $this->id                 = 'lumenflow';
        $this->has_fields         = true;
        $this->method_title       = 'LumenFlow';
        $this->method_description = 'Pay with Stellar via LumenFlow smart contracts.';
        $this->supports           = ['products', 'refunds'];

        $this->init_form_fields();
        $this->init_settings();

        $this->title       = $this->get_option('title');
        $this->description = $this->get_option('description');

        add_action('woocommerce_update_options_payment_gateways_' . $this->id,
                   [$this, 'process_settings_update']);
    }

    /** Admin settings fields */
    public function init_form_fields() {
        $this->form_fields = [
            'enabled'          => [
                'title'   => 'Enable/Disable',
                'type'    => 'checkbox',
                'label'   => 'Enable LumenFlow Payments',
                'default' => 'yes',
            ],
            'title'            => [
                'title'   => 'Title',
                'type'    => 'text',
                'default' => 'LumenFlow (Stellar)',
            ],
            'contract_id'      => [
                'title' => 'Contract ID',
                'type'  => 'text',
            ],
            'merchant_address' => [
                'title' => 'Merchant Stellar Address',
                'type'  => 'text',
            ],
            'merchant_secret'  => [
                'title'       => 'Merchant Secret Key',
                'type'        => 'password',
                'description' => 'Stored securely. Never shown after saving.',
            ],
            'token_address'    => [
                'title'   => 'Payment Token Address',
                'type'    => 'text',
                'default' => 'native',
            ],
            'rpc_url'          => [
                'title'   => 'Soroban RPC URL',
                'type'    => 'text',
                'default' => 'https://soroban-testnet.stellar.org',
            ],
            'network_passphrase' => [
                'title'   => 'Network Passphrase',
                'type'    => 'text',
                'default' => 'Test SDF Network ; September 2015',
            ],
        ];
    }

    /** Process the payment (called by WooCommerce on order submission) */
    public function process_payment($order_id) {
        $order = wc_get_order($order_id);

        // Build LumenFlow order ID
        $lf_order_id = 'WC_' . $order_id . '_' . time();

        // Call your signing service (PHP or external Node microservice)
        $signed = $this->get_signed_order($lf_order_id, $order->get_total());

        if (is_wp_error($signed)) {
            wc_add_notice($signed->get_error_message(), 'error');
            return ['result' => 'failure'];
        }

        // Store LF order ID for webhook reconciliation
        $order->update_meta_data('_lf_order_id', $lf_order_id);
        $order->update_meta_data('_lf_signature', $signed['signature']);
        $order->save();

        // Redirect to hosted payment page with signed params
        $pay_url = add_query_arg([
            'lf_order_id'        => urlencode($lf_order_id),
            'lf_amount'          => urlencode($order->get_total()),
            'lf_signature'       => urlencode($signed['signature']),
            'lf_merchant_pubkey' => urlencode($signed['merchant_public_key']),
            'wc_order_id'        => $order_id,
        ], get_site_url() . '/lumenflow-pay');

        return [
            'result'   => 'success',
            'redirect' => $pay_url,
        ];
    }

    /** Handle refunds from WooCommerce admin */
    public function process_refund($order_id, $amount = null, $reason = '') {
        $order      = wc_get_order($order_id);
        $lf_order   = $order->get_meta('_lf_order_id');
        $refund_id  = 'REFUND_' . $order_id . '_' . time();
        $stroops    = intval($amount * 1e7);

        $response = wp_remote_post(get_site_url() . '/api/lumenflow/refund', [
            'body' => json_encode([
                'orderId'   => $lf_order,
                'refundId'  => $refund_id,
                'amount'    => $stroops,
                'reason'    => $reason,
            ]),
            'headers' => ['Content-Type' => 'application/json'],
        ]);

        if (is_wp_error($response)) {
            return new WP_Error('refund_failed', $response->get_error_message());
        }

        $order->add_order_note(sprintf('LumenFlow refund initiated: %s', $refund_id));
        return true;
    }

    /** Call Node.js signing microservice */
    private function get_signed_order($lf_order_id, $amount) {
        $res = wp_remote_post(get_option('lf_signing_service_url') . '/sign', [
            'body'    => json_encode([
                'orderId'         => $lf_order_id,
                'amount'          => intval($amount * 1e7),
                'merchantAddress' => $this->get_option('merchant_address'),
            ]),
            'headers' => ['Content-Type' => 'application/json'],
            'timeout' => 10,
        ]);

        if (is_wp_error($res)) return $res;
        return json_decode(wp_remote_retrieve_body($res), true);
    }
}
```

### Webhook receiver (WooCommerce REST endpoint)

```php
add_action('rest_api_init', function () {
    register_rest_route('lumenflow/v1', '/webhook', [
        'methods'             => 'POST',
        'callback'            => 'lf_handle_webhook',
        'permission_callback' => '__return_true',
    ]);
});

function lf_handle_webhook(WP_REST_Request $request) {
    $sig      = $request->get_header('X-LumenFlow-Signature');
    $body     = $request->get_body();
    $expected = hash_hmac('sha256', $body, get_option('lf_webhook_secret'));

    if (!hash_equals($sig, $expected)) {
        return new WP_Error('unauthorized', 'Invalid signature', ['status' => 401]);
    }

    $data  = $request->get_json_params();
    $event = $data['event'] ?? '';

    if ($event === 'lumenflow/payment_processed') {
        // Find WC order by LF order ID meta
        $orders = wc_get_orders(['meta_key' => '_lf_order_id', 'meta_value' => $data['data']['order_id']]);
        if (!empty($orders)) {
            $order = $orders[0];
            $order->payment_complete();
            $order->add_order_note('LumenFlow payment confirmed on-chain.');
        }
    }

    return rest_ensure_response(['received' => true]);
}
```

**WooCommerce-specific notes:**
- The plugin uses `WC_Payment_Gateway::process_payment` to redirect customers to a hosted checkout page where the wallet interaction happens.
- Signing **must** be done server-side; consider a small Node.js microservice that the PHP plugin calls via HTTP.
- Refunds are wired via `WC_Payment_Gateway::process_refund` which calls the LumenFlow `initiate_refund` entry point.
- Webhook verification uses `hash_hmac` / `hash_equals` to prevent timing attacks.

---

## Further Reading

- [docs/webhook-integration.md](webhook-integration.md) — full webhook event reference and retry logic
- [LumenFlow Contract API](../README.md#contract-api) — all contract entry points
- [Stellar Soroban SDK docs](https://developers.stellar.org/docs/tools/sdks/library-sdk)
- [Freighter wallet API](https://docs.freighter.app)
