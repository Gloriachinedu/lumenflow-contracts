# LumenFlow Governance

This document describes how the LumenFlow project is governed: who maintains it, how decisions are made, and how to get involved.

---

## Project Maintainers

Maintainers are responsible for:

- Reviewing and merging pull requests
- Triaging issues and setting priorities
- Cutting releases and maintaining the changelog
- Enforcing the Code of Conduct
- Guiding the technical direction of the project

Current maintainers are listed in [CODEOWNERS](.github/CODEOWNERS).

---

## Decision Making

### Day-to-day changes

Bug fixes, documentation updates, and small improvements are decided by **consensus** among active maintainers. A single maintainer approval is sufficient to merge a PR that has no objections within 48 hours.

### Significant changes

Changes that affect the public contract API, storage layout, security model, or project structure require:

1. An RFC (see below) or a detailed issue describing the proposal.
2. At least **two maintainer approvals**.
3. A minimum **72-hour review window** with no unresolved objections.

### Disagreements

If maintainers cannot reach consensus, the decision is put to a **vote** among all active maintainers. A simple majority decides. In the event of a tie, the project lead (listed in CODEOWNERS) has the casting vote.

---

## RFC Process

An RFC (Request for Comments) is required for:

- New contract entry points or breaking changes to existing ones
- Changes to the storage schema
- New dependencies or toolchain upgrades
- Significant changes to CI/CD or release processes

**Steps:**

1. Open a GitHub Issue with the title prefix `RFC:` and describe the motivation, design, and trade-offs.
2. Allow at least **7 days** for community and maintainer feedback.
3. Address feedback and update the issue.
4. A maintainer closes the RFC as **accepted** or **rejected** with a summary comment.
5. Accepted RFCs are implemented via a normal PR that references the RFC issue.

---

## Becoming a Maintainer

Anyone who has made consistent, high-quality contributions over time may be nominated as a maintainer.

**Criteria:**

- Multiple merged PRs demonstrating code quality and project understanding
- Active participation in issue triage and code review
- Demonstrated alignment with project values and Code of Conduct

**Process:**

1. Any existing maintainer opens an issue proposing the nomination.
2. Existing maintainers discuss and vote (simple majority, 7-day window).
3. If accepted, the new maintainer is added to CODEOWNERS and given repository write access.

Maintainers who are inactive for more than 6 months may be moved to emeritus status after a courtesy notice.

---

## Code of Conduct Enforcement

LumenFlow follows the [Contributor Covenant](https://www.contributor-covenant.org/). Reports of unacceptable behaviour should be sent privately to the maintainers via the contact listed in [SECURITY.md](SECURITY.md).

**Process:**

1. Report received → acknowledged within 48 hours.
2. Maintainers investigate privately and reach a decision.
3. Response may include: warning, temporary ban, or permanent ban depending on severity.
4. The reporter is informed of the outcome.

All reports are handled confidentially.

---

## Related Documents

- [CONTRIBUTING.md](CONTRIBUTING.md) — how to submit code and documentation
- [SECURITY.md](SECURITY.md) — responsible disclosure
- [CODE_OF_CONDUCT](https://www.contributor-covenant.org/version/2/1/code_of_conduct/) — community standards
