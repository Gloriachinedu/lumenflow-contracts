# Secrets and local environment setup

This guide explains how to configure LumenFlow locally without committing secrets,
how to validate the Docker Compose stack, and the automated secrets scanning
policy that protects the repository from accidental key commits.

## Secrets scanning policy (Issue #627)

LumenFlow uses [gitleaks](https://github.com/gitleaks/gitleaks) to automatically
detect and block accidental commits of secrets such as Stellar secret keys,
private key PEM blocks, API tokens, and seed phrases.

### What is scanned

The `.gitleaks.toml` file at the repository root defines the following custom rules:

| Rule ID | Description | Severity |
|---------|-------------|----------|
| `stellar-secret-key` | Stellar secret keys starting with `S` (56 chars) | CRITICAL |
| `stellar-secret-key-env` | Stellar keys assigned to `SOURCE_ACCOUNT`, `ADMIN_KEY`, etc. | CRITICAL |
| `private-key-pem` | PEM-encoded private key blocks | CRITICAL |
| `env-secret-assignment` | Plaintext passwords/tokens in variable assignments | HIGH |
| `mnemonic-seed-phrase` | BIP-39 mnemonic seed phrases | CRITICAL |
| `github-pat` | GitHub personal access tokens | HIGH |
| `aws-access-key` | AWS access key IDs | HIGH |

Additionally, all built-in gitleaks detectors are active.

### Where scanning runs

1. **Pre-commit hook** — `gitleaks protect --staged` runs on every `git commit`
   before the commit is made, scanning only staged files. Install the hooks with:
   ```bash
   git config core.hooksPath .githooks
   # or
   ./scripts/install_hooks.sh
   ```

2. **CI on every PR** — The `.github/workflows/secrets-scan.yml` workflow runs
   gitleaks on every pull request and push to `main`/`develop`. A PR cannot be
   merged if gitleaks finds a secret.

### Installing gitleaks

**macOS (Homebrew):**
```bash
brew install gitleaks
```

**Linux (binary):**
```bash
curl -sSfL https://github.com/gitleaks/gitleaks/releases/latest/download/gitleaks_linux_x64.tar.gz \
  | tar -xz -C /usr/local/bin
```

**Windows:**
```powershell
winget install gitleaks
```

Verify the installation:
```bash
gitleaks version
```

### Manual scan

To scan the full repository history at any time:
```bash
gitleaks detect --source . --config .gitleaks.toml
```

To scan only staged changes before committing:
```bash
gitleaks protect --staged --config .gitleaks.toml
```

### Handling false positives

If gitleaks flags a value that is not a real secret (e.g., a test fixture, a
placeholder address in documentation, or a public key), add an allowlist entry
to `.gitleaks.toml` with a clear justification comment:

```toml
[[rules]]
id    = "stellar-secret-key"
# ... existing rule ...

  [rules.allowlist]
  description = "Allow placeholder keys in docs"
  regexTarget = "line"
  regexes     = [
    # Justification: README.md uses <admin-secret> as a literal placeholder
    '''<admin-secret>''',
  ]
```

Or add path-level allowlist entries in the `[allowlist]` section for entire files
that are safe by construction (e.g., `.env.example`).

**Never add a real secret to an allowlist.** If a real key was committed by
mistake, rotate it immediately — do not simply allowlist it.

---

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
value for the local quickstart node, so it is safe to commit as-is..
