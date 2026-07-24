# Merchant Refunds UI (prototype)

This is a small static prototype for the merchant refunds UI used for demonstration and PR purposes.

Files:
- `index.html` — main UI
- `app.js` — minimal logic: tabs, approve/reject, execute, wallet modal
- `styles.css` — styles and visible focus indicators

Notes:
- The wallet execute path attempts to call `window.freighter` or `window.albedo` if available.
- Replace the mock `fetchRefunds` with real backend calls or Horizon streaming for production.
