# Escrow Guide

> **Status:** This feature is under active design. The escrow hold/release functions are tracked in issue [#1111](https://github.com/Gloriachinedu/lumenflow-contracts/issues/1111).

The design decisions for the escrow feature — including the condition-hash mechanism, arbiter model, timeout handling, and partial release tradeoffs — are recorded in:

**[docs/adr/ADR-007-escrow-design.md](./adr/ADR-007-escrow-design.md)**

This guide will be expanded with full usage examples, CLI commands, and SDK integration once the implementation is finalised and the ADR is approved.

---

## Overview (planned)

LumenFlow escrow allows a payer to lock funds on-chain pending the satisfaction of an agreed condition. The key properties:

- **Condition binding** — the agreed condition is committed on-chain as a SHA-256 hash at creation time; neither party can change it afterwards.
- **Named arbiter** — a trusted third party (or the merchant) evaluates the condition and releases funds by revealing the condition pre-image.
- **Timeout** — if the arbiter is unresponsive, the payer can reclaim funds after the escrow expires.
- **Partial release** — funds can be released in stages to support milestone-based payments.

See [ADR-007](./adr/ADR-007-escrow-design.md) for the full design rationale.
