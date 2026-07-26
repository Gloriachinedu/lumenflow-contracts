# Secrets and local environment setup

This guide explains how to configure LumenFlow locally without committing secrets,
and how to validate the Docker Compose stack.

## Environment files

`.env.example` is the only environment file tracked in git. It documents every
variable but contains no real values. Everything else is ignored:

```gitignore
.env
.env.*
!.env.example
```

To set up locally, copy the example to a network-specific file and fill it in:

```bash
cp .env.example .env.local      # local quickstart
cp .env.example .env.testnet    # testnet
cp .env.example .env.mainnet    # mainnet
```

Never commit `.env.local`, `.env.testnet`, or `.env.mainnet`. They are gitignored
on purpose.

## Which values are secret

| Variable          | Secret? | Notes                                                            |
| ----------------- | ------- | ---------------------------------------------------------------- |
| `NETWORK`         | No      | `local` / `testnet` / `mainnet`.                                 |
| `RPC_URL`         | No      | Public RPC endpoint.                                             |
| `NETWORK_PASSPHRASE` | No   | Public, fixed per network.                                       |
| `SOURCE_ACCOUNT`  | **Yes** | Stellar secret key (starts with `S`). Pays deployment fees.      |
| `CONTRACT_ID`     | No      | Public, populated after deploy.                                  |
| `ADMIN_ADDRESS`   | No      | Public key (`G...`).                                             |

Only `SOURCE_ACCOUNT` is sensitive. Treat it like a password.

## Handling the source secret key safely

- Keep `SOURCE_ACCOUNT` in your gitignored `.env.<network>` file or pass it
  inline for one-off commands; do not hardcode it in scripts, the `Makefile`, or
  source.
- Use a dedicated **testnet** key for day-to-day work. Fund it from the
  [testnet friendbot](https://laboratory.stellar.org/#account-creator?network=test).
- For mainnet, store the key in a password manager or OS keychain and export it
  into the shell only for the deploy command:

  ```bash
  NETWORK=mainnet SOURCE_ACCOUNT="$(read -rs k; echo "$k")" ./scripts/deploy.sh
  ```

- Use separate keys per network so a leaked testnet key never affects mainnet.
- Never echo the secret in CI logs; pass it through the CI provider's secret store.

The deploy scripts read the key from the environment, so it never needs to be
written to a tracked file:

```bash
SOURCE_ACCOUNT=<secret-key> ./scripts/local_up.sh
NETWORK=testnet SOURCE_ACCOUNT=<testnet-secret-key> ./scripts/deploy.sh
```

## Validating Docker Compose

Validate the compose file before bringing the stack up:

```bash
docker compose config        # prints the resolved config, errors on problems
docker compose up -d stellar # start the local Stellar quickstart node
```

`docker compose config` resolves and type-checks `docker-compose.yml`. The
committed compose file contains no secrets; it only sets the public `NETWORK`
value for the local quickstart node, so it is safe to commit as-is.

## Frontend Content Security Policy (CSP)

All frontend HTML pages include a `Content-Security-Policy` meta tag to protect
against XSS attacks, wallet-key exfiltration, and Soroban RPC hijacking.

### Policy structure

```html
<meta http-equiv="Content-Security-Policy" content="
  default-src 'self';
  script-src  'self' https://cdn.jsdelivr.net;
  style-src   'self' 'unsafe-inline';
  connect-src 'self'
              https://soroban-testnet.stellar.org
              https://horizon-testnet.stellar.org
              https://horizon.stellar.org;
  img-src     'self' data:;
  font-src    'self';
  object-src  'none';
  frame-ancestors 'none';
" />
```

### Directive rationale

| Directive       | Value                                   | Why                                                                           |
| --------------- | --------------------------------------- | ----------------------------------------------------------------------------- |
| `default-src`   | `'self'`                                | Block all unlisted resource origins by default.                               |
| `script-src`    | `'self' https://cdn.jsdelivr.net`       | Allows the Stellar SDK loaded via jsDelivr CDN. No `unsafe-inline`.          |
| `style-src`     | `'self' 'unsafe-inline'`               | Inline styles used by shared utilities (overlays, banners). No external CSS. |
| `connect-src`   | `'self'` + Stellar RPC/Horizon URLs     | Restricts XHR/fetch to the configured Soroban RPC and Horizon endpoints.     |
| `img-src`       | `'self' data:`                          | Allows inline SVG data URIs used for icons.                                   |
| `font-src`      | `'self'`                                | System fonts only; no external font loading.                                  |
| `object-src`    | `'none'`                                | Blocks Flash/plugins entirely.                                                |
| `frame-ancestors` | `'none'`                              | Prevents clickjacking by disallowing framing.                                 |

### Adapting the policy for production

If you deploy to mainnet or a custom RPC endpoint, update `connect-src` to include
your production URLs. For example:

```
connect-src 'self' https://soroban-mainnet.stellar.org https://horizon.stellar.org https://your-rpc.example.com;
```

Never add `unsafe-eval` or `unsafe-inline` to `script-src` — doing so would
defeat the XSS protection the policy provides.

### CI linting

The policy is validated in CI using the `htmlhint` linter (configured in
`.htmlhintrc`). Run locally with:

```bash
cd frontend && npx htmlhint "*.html"
```
