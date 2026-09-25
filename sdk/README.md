# LumenFlow SDK

The LumenFlow TypeScript SDK provides a convenient wrapper around the LumenFlow smart contract.

## Error Handling

The SDK maps numeric contract error codes to human-readable English messages and provides a typed `LumenFlowError` object.

### Usage

```typescript
import { LumenFlowError, PaymentErrorCode } from '@lumenflow/sdk';

try {
  // Call contract...
} catch (error) {
  if (error.code) {
    const lfError = new LumenFlowError(error.code);
    console.error(lfError.message); // "A payment with this order ID already exists."
    
    // For localization (e.g. in a dashboard):
    const translationKey = lfError.messageKey; // "error.paymentalreadyexists"
    // useTranslation(translationKey);
  }
}
```

### Toast Notification Example

```typescript
function handleContractError(error: any) {
  const lfError = new LumenFlowError(error.code || 50);
  toast.error(lfError.message, {
    description: `Error Code: ${lfError.code}`,
  });
}
```

---

## CSP Nonce Injection

When your page enforces a `Content-Security-Policy` with a `script-src 'nonce-<value>'` directive, any inline `<script>` elements created by the SDK must carry the same nonce or they will be blocked by the browser.

### Usage

Call `LumenFlowClient.setCspNonce()` once per page load, passing the server-generated nonce:

```typescript
import { LumenFlowClient } from '@lumenflow/sdk';

const client = new LumenFlowClient();

// Pass the nonce your server emits in the CSP header / meta tag.
client.setCspNonce(window.__CSP_NONCE__);
```

After calling `setCspNonce()`, every `<script>` element the SDK creates dynamically will have its `nonce` property set to this value.

### Behaviour in Node.js

`setCspNonce()` is a **no-op** in Node.js environments (where `window` is not defined). You can safely call it in isomorphic code without wrapping it in a browser check.

### Using CspNonceManager directly

For advanced use cases you can import the low-level manager:

```typescript
import { cspNonceManager } from '@lumenflow/sdk';

cspNonceManager.setNonce('abc123');

// Create a script element with the nonce already applied:
const script = cspNonceManager.createNoncedScript('console.log("hello")');
document.head.appendChild(script!);

// Or inject directly:
cspNonceManager.injectScript('window.myLib.init()');
```
