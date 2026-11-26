# SDK Integration Walkthrough — Video Transcript

This document is the full transcript of the LumenFlow SDK integration walkthrough video for Node.js. It is provided for accessibility so the content can be consumed without audio. The transcript follows the same segment structure as `docs/sdk-integration-video-script.md`.

**Video:** LumenFlow SDK Integration Walkthrough (Node.js)
**Channel:** LumenFlow (YouTube)
**Audience:** New merchants integrating the LumenFlow Node.js SDK

---

## Segment 1 — Intro

**[00:00]**

> **Narrator:** Welcome to the LumenFlow SDK integration walkthrough for Node.js. In this video we'll take you from a fresh project to your first successful payment, and then show you how to handle errors and subscribe to events. By the end, you'll have a working integration you can build on.

**[00:12]**

> **Narrator:** Before we start, make sure you have a LumenFlow merchant account and your API keys handy. You can find them in the LumenFlow dashboard under **Settings → API Keys**. We'll be using the sandbox keys for this walkthrough.

**[00:24]**

> **Narrator:** You'll also need Node.js installed — version 18 or later is recommended. Let's get started.

*On screen: LumenFlow dashboard showing the API Keys page with sandbox keys highlighted.*

---

## Segment 2 — Installation

**[00:32]**

> **Narrator:** First, let's create a new project directory and initialize it.

*On screen:*

```bash
mkdir lumenflow-demo
cd lumenflow-demo
npm init -y
```

**[00:45]**

> **Narrator:** Now install the LumenFlow SDK from npm.

*On screen:*

```bash
npm install @lumenflow/sdk
```

**[00:55]**

> **Narrator:** That's it for installation. The SDK has no additional peer dependencies, so you're ready to go.

---

## Segment 3 — Client setup

**[01:02]**

> **Narrator:** Next, we'll set up the SDK client. Create a file called `index.js` in your project root.

*On screen:*

```bash
touch index.js
```

**[01:12]**

> **Narrator:** Inside `index.js`, import the SDK and initialize the client with your API key. We recommend loading the key from an environment variable rather than hard-coding it.

*On screen:*

```javascript
const { LumenFlowClient } = require('@lumenflow/sdk');

const client = new LumenFlowClient({
  apiKey: process.env.LUMENFLOW_API_KEY,
  environment: 'sandbox', // use 'production' when you go live
});
```

**[01:30]**

> **Narrator:** Set the environment variable in your shell before running the script.

*On screen:*

```bash
export LUMENFLOW_API_KEY="sk_sandbox_your_key_here"
```

**[01:40]**

> **Narrator:** A quick note on security: never commit your API keys to source control. Use a `.env` file locally and your platform's secret manager in production.

---

## Segment 4 — First payment

**[01:50]**

> **Narrator:** Now for the fun part — creating your first payment. We'll add a call to `client.payments.create` with a small amount.

*On screen:*

```javascript
async function main() {
  const payment = await client.payments.create({
    amount: 1000,          // amount in the smallest currency unit (e.g. cents)
    currency: 'USD',
    description: 'Test payment from SDK walkthrough',
    paymentMethod: 'pm_card_visa', // sandbox test payment method
  });

  console.log('Payment created:', payment.id);
  console.log('Status:', payment.status);
}

main().catch(console.error);
```

**[02:15]**

> **Narrator:** Run the script with `node index.js`.

*On screen:*

```bash
node index.js
```

**[02:22]**

> **Narrator:** You should see output like this — a payment ID and a status of `succeeded` for the sandbox test card.

*On screen:*

```
Payment created: pay_1234567890abcdef
Status: succeeded
```

**[02:35]**

> **Narrator:** Congratulations — you've just created your first payment with the LumenFlow SDK. You can view this payment in the dashboard under **Payments**.

---

## Segment 5 — Handling errors

**[02:45]**

> **Narrator:** Real-world integrations need to handle errors gracefully. The SDK throws typed errors you can catch and inspect.

*On screen:*

```javascript
const { LumenFlowError, CardDeclinedError } = require('@lumenflow/sdk');

async function createPaymentSafely() {
  try {
    const payment = await client.payments.create({
      amount: 1000,
      currency: 'USD',
      paymentMethod: 'pm_card_declined', // sandbox card that always declines
    });
    return payment;
  } catch (err) {
    if (err instanceof CardDeclinedError) {
      console.error('Card was declined:', err.declineCode);
    } else if (err instanceof LumenFlowError) {
      console.error('LumenFlow error:', err.message, err.code);
    } else {
      console.error('Unexpected error:', err);
    }
  }
}
```

**[03:15]**

> **Narrator:** Here we're using the sandbox declined card to trigger a `CardDeclinedError`. Notice we check for the specific error type first, then fall back to the general `LumenFlowError`. Always log the error code — it makes debugging much easier.

**[03:30]**

> **Narrator:** For network failures, the SDK will throw a standard error after retrying automatically. You can configure retry behavior when you initialize the client if you need to.

---

## Segment 6 — Event subscription

**[03:40]**

> **Narrator:** Finally, let's subscribe to events so your application can react to payment state changes. The SDK provides a helper for verifying and parsing webhook events.

*On screen:*

```javascript
const express = require('express');
const { verifyWebhook } = require('@lumenflow/sdk');

const app = express();

app.post(
  '/webhooks/lumenflow',
  express.raw({ type: 'application/json' }),
  (req, res) => {
    let event;
    try {
      event = verifyWebhook(
        req.body,
        req.headers['lumenflow-signature'],
        process.env.LUMENFLOW_WEBHOOK_SECRET
      );
    } catch (err) {
      return res.status(400).send('Invalid signature');
    }

    switch (event.type) {
      case 'payment.succeeded':
        console.log('Payment succeeded:', event.data.id);
        break;
      case 'payment.failed':
        console.log('Payment failed:', event.data.id);
        break;
      default:
        console.log('Unhandled event type:', event.type);
    }

    res.status(200).send('OK');
  }
);

app.listen(3000, () => console.log('Listening on port 3000'));
```

**[04:15]**

> **Narrator:** A few important points here. First, we use `express.raw` so the signature can be verified against the raw body — parsing the JSON first will break verification. Second, always verify the signature before trusting the event. Third, respond with a 2xx status quickly so LumenFlow doesn't retry the delivery.

**[04:35]**

> **Narrator:** You can find your webhook secret in the dashboard under **Settings → Webhooks**. Use the LumenFlow CLI to forward events to your local server during development.

*On screen:*

```bash
npx @lumenflow/cli listen --forward-to localhost:3000/webhooks/lumenflow
```

---

## Segment 7 — Wrap-up

**[04:50]**

> **Narrator:** That's the full walkthrough. Let's recap what we covered: installing the SDK, setting up the client with your API key, creating your first payment, handling errors with typed exceptions, and subscribing to webhook events.

**[05:05]**

> **Narrator:** For more details, check out the SDK README and the merchant onboarding guide, both linked in the description. If you run into issues, reach out to LumenFlow support or open an issue on our GitHub repository.

**[05:20]**

> **Narrator:** Thanks for watching, and happy integrating!

*On screen: LumenFlow logo with links to documentation, support, and the GitHub repository.*

---

## Resources

- SDK README: `sdk/README.md`
- Merchant onboarding guide: `docs/merchant-onboarding.md`
- Video script: `docs/sdk-integration-video-script.md`
- LumenFlow support: support@lumenflow.example
- GitHub repository: https://github.com/lumenflow/sdk-node