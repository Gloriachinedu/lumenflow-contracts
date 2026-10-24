# 👋 Welcome to LumenFlow Discussions!

Thank you for being part of the LumenFlow community. This space is for
questions, ideas, and conversation about building on LumenFlow — Soroban's
production-grade payment processing contract.

---

## 🗂️ Category Guide

Please use the category that best fits your topic so others can find answers
more easily:

| Category | What it's for |
|----------|--------------|
| **🙋 Q&A** | General questions about LumenFlow — how it works, supported features, usage patterns |
| **🛠️ Developer Help** | SDK integration, contract deployment, tooling, WASM builds, debugging |
| **💡 Feature Requests** | Propose new features, vote on ideas, discuss roadmap direction |
| **🎉 Show and Tell** | Share apps, integrations, or tools you have built with LumenFlow |
| **📢 Announcements** | Official releases, breaking changes, and project news (maintainers only) |

---

## 📋 Community Guidelines

1. **Be respectful and inclusive.** We follow the [Contributor Covenant](https://www.contributor-covenant.org/). Harassment or discrimination of any kind will not be tolerated.

2. **Search before posting.** Your question may already have an answer. Use the search bar to check.

3. **Use the right channel.** Questions → Discussions. Confirmed bugs → [GitHub Issues](https://github.com/PrincessnJoy/lumenflow-contracts/issues). Security issues → [SECURITY.md](https://github.com/PrincessnJoy/lumenflow-contracts/blob/main/SECURITY.md) (never public).

4. **Provide context.** Include your Rust version, Stellar CLI version, network (local/testnet/mainnet), and relevant code snippets. Good context leads to faster answers.

5. **Mark helpful answers.** If a reply answers your question, mark it as the accepted answer so others can benefit.

6. **Stay on topic.** This community is focused on LumenFlow and Soroban smart contract development. Off-topic posts may be moved or removed.

---

## 🚀 Quick Links

- 📖 [README](https://github.com/PrincessnJoy/lumenflow-contracts/blob/main/README.md) — Full documentation
- 🤝 [CONTRIBUTING.md](https://github.com/PrincessnJoy/lumenflow-contracts/blob/main/CONTRIBUTING.md) — How to contribute
- 🛡️ [SECURITY.md](https://github.com/PrincessnJoy/lumenflow-contracts/blob/main/SECURITY.md) — Responsible disclosure
- 🗺️ [ROADMAP.md](https://github.com/PrincessnJoy/lumenflow-contracts/blob/main/ROADMAP.md) — Versioned milestone targets
- 💬 [Discord](https://discord.gg/lumenflow) — Real-time community chat

---

We are glad you are here. Happy building! 🌟

## Category Descriptions and Pinned Post Templates

The following descriptions and pinned post content should be configured in the
GitHub repository settings under **Discussions → Edit categories**.

---

### 🙋 Q&A

**Description (set in GitHub UI):**
> Ask questions about LumenFlow — how it works, which features are supported, usage patterns, and general how-to questions. Mark the answer that helped you so others can find it.

**Pinned post title:** Welcome to Q&A — How to ask a great question

**Pinned post body:**

Welcome to the LumenFlow Q&A category! 👋

Before posting:
- 🔍 Search existing discussions — your question may already be answered.
- 📖 Check the [README](../blob/main/README.md) and [API reference](../blob/main/docs/api-reference.md).
- 🐛 For confirmed bugs, open a [GitHub Issue](../issues) instead.

When posting, include:
- Your Rust and Stellar CLI versions (`rustc --version`, `stellar --version`)
- The network you are using (`local` / `testnet` / `mainnet`)
- The exact error message or unexpected behavior
- A minimal code snippet that reproduces the issue

Mark the reply that answers your question as the **accepted answer** so others can find the solution easily.

---

### 🛠️ Developer Help

**Description (set in GitHub UI):**
> SDK integration, contract deployment, WASM builds, CLI usage, tooling setup, and debugging. For build or deploy issues, include your toolchain versions and the full error output.

**Pinned post title:** Developer Help — What belongs here and how to get unstuck fast

**Pinned post body:**

Welcome to Developer Help! 🛠️

This category is for technical questions about:
- SDK integration (`@lumenflow/sdk` TypeScript/JavaScript)
- Contract deployment and upgrade procedures
- WASM builds, toolchain setup, and Cargo configuration
- CLI (`lumenflow-cli`) usage and configuration
- Docker Compose local network setup
- Signature construction and ed25519 verification

**To get help faster, include:**
- `rustc --version`, `stellar --version`, `node --version`
- Full error output (paste the complete stack trace)
- Your `Cargo.toml` dependencies section (if relevant)
- Network target: `local`, `testnet`, or `mainnet`

**Useful starting points:**
- [Troubleshooting guide](../blob/main/docs/troubleshooting.md)
- [Signature format](../blob/main/docs/signature-format.md)
- [Deployment guide](../blob/main/docs/deployment-guide.md)
- [SDK README](../blob/main/sdk/README.md)

---

### 💡 Feature Requests

**Description (set in GitHub UI):**
> Propose new features, vote on ideas, and discuss roadmap direction. Check the roadmap before posting — your idea may already be planned.

**Pinned post title:** Feature Requests — How to propose a new feature

**Pinned post body:**

Welcome to Feature Requests! 💡

Before proposing a feature:
- 📋 Check [ROADMAP.md](../blob/main/ROADMAP.md) — it may already be planned.
- 🔍 Search existing discussions and issues for duplicates.

A strong feature request includes:
1. **Problem statement** — what user need or pain point does this solve?
2. **Proposed solution** — how would it work from the user's perspective?
3. **Alternatives considered** — what other approaches did you consider?
4. **Scope** — is this a contract change, SDK addition, CLI command, or documentation?

Popular requests with community support are more likely to be prioritised. 👍 react to proposals you want to see.

For well-scoped, actionable proposals, you can also open a [formal feature request issue](../issues/new?template=feature_request.yml).