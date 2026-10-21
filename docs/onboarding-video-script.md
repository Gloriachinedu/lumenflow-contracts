# Contributor Onboarding Video Script

This short script is designed for a 3–5 minute contributor walkthrough of the LumenFlow repository.

## Suggested structure

1. Opening hook (0:00–0:20)
   - Introduce the repository and its purpose: a Soroban smart-contract payment platform for Stellar.
   - Mention that the goal of the walkthrough is to help a new contributor get from clone to first PR safely.

2. Repository tour (0:20–1:10)
   - Point contributors to the main contract implementation in [contracts/lumenflow/src/lib.rs](../contracts/lumenflow/src/lib.rs).
   - Highlight supporting modules such as [contracts/lumenflow/src/test.rs](../contracts/lumenflow/src/test.rs), [contracts/lumenflow/src/storage.rs](../contracts/lumenflow/src/storage.rs), and [contracts/lumenflow/src/error.rs](../contracts/lumenflow/src/error.rs).
   - Mention the docs folder and the developer guide in [docs/ONBOARDING.md](./ONBOARDING.md).

3. Setup and verification (1:10–2:00)
   - Show the required tools: Rust, Stellar CLI, Docker, and Git.
   - Mention the WASM target command: `rustup target add wasm32-unknown-unknown`.
   - Run a quick verification command such as `cargo test --all-features`.

4. Local workflow (2:00–3:00)
   - Explain how to run the local network helper script in [scripts/local_up.sh](../scripts/local_up.sh).
   - Mention that the local deployment flow is documented in [docs/ONBOARDING.md](./ONBOARDING.md).
   - Note that contributors should keep the contract auth model in mind, because Soroban calls are signed transactions rather than bearer-token requests.

5. Contribution workflow (3:00–4:00)
   - Encourage contributors to create a feature branch from the upstream repository.
   - Remind them to keep changes focused, add or update tests, and verify them before opening a PR.
   - Mention the importance of linking the PR to the relevant issue and following the repository’s contribution guidance in [CONTRIBUTING.md](../CONTRIBUTING.md).

## Sample narration

"Welcome to LumenFlow. In this short walkthrough, I’ll show you how the repository is organized, how to run the test suite locally, and how to prepare your first contribution. The contract entrypoints live in the main contract module, while the test suite and storage helpers live alongside them. After installing the prerequisites and adding the WASM target, you can build and run the tests with cargo. If you want to test against a local network, the repository includes a local startup script and the onboarding guide walks through the step-by-step flow. When you are ready to contribute, open a focused branch, verify your changes, and submit a PR that references the related issue."
