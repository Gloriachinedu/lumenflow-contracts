# Privacy Policy — LumenFlow

**Effective date:** 2026-07-25  
**Last updated:** 2026-07-25

LumenFlow is a decentralised payment processing protocol built on the [Stellar Soroban](https://soroban.stellar.org) blockchain. This Privacy Policy explains what personal data is processed through the LumenFlow smart contracts, how it is handled, and the rights available to data subjects under the General Data Protection Regulation (GDPR) and equivalent privacy laws.

---

## 1. Data Controller

LumenFlow is an open-source protocol. The entity operating a specific deployment of the LumenFlow smart contracts is the data controller for that deployment. If you are unsure who operates the deployment you are interacting with, contact the platform or application you used to access LumenFlow.

For questions regarding this policy or to exercise your rights, contact:

- **Email:** privacy@lumenflow.example.com  
- **GitHub Issues:** https://github.com/Gloriachinedu/lumenflow-contracts/issues (use label `privacy`)

---

## 2. What Data Is Stored

The LumenFlow smart contract stores the following categories of data on-chain as part of merchant profiles:

| Field | Description | Category |
|-------|-------------|----------|
| `address` | Stellar public key (wallet address) | Pseudonymous identifier |
| `name` | Merchant display name | Potentially personal (for sole traders) |
| `description` | Free-text description of the merchant's business | Potentially personal |
| `contact_info` | Contact details (email, URL, etc.) | Potentially personal |
| `category` | Business category | Non-personal |
| `active` | Whether the merchant account is active | Non-personal |
| `verified` | Whether the merchant has been verified | Non-personal |
| `registered_at` | Timestamp of merchant registration | Non-personal |
| `total_received` | Cumulative payment volume received | Non-personal |

Payment records also store:

| Field | Description | Category |
|-------|-------------|----------|
| `payer` | Payer's Stellar public key | Pseudonymous identifier |
| `merchant_address` | Merchant's Stellar public key | Pseudonymous identifier |
| `amount` | Payment amount | Non-personal |
| `paid_at` | Timestamp of payment | Non-personal |
| `memo` | Optional payment note (user-provided) | Potentially personal |

> **Blockchain immutability notice:** Payment records are stored on the Stellar blockchain. Once confirmed, transaction data (including on-chain event logs) cannot be deleted. However, the merchant profile fields (`name`, `description`, `contact_info`) that may contain personal data **can** be anonymised through the data deletion procedure described in Section 5.

### 2.1 On-chain vs. off-chain payer data

Payer-related data exists in two distinct locations with very different erasure properties. The table below summarises what is stored where and whether it can be erased.

| Data | Location | Erasable? | Notes |
|------|----------|-----------|-------|
| Payer Stellar address in payment records | On-chain (Soroban contract storage) | **No** — immutable | Pseudonymous identifier; retained for financial record-keeping and dispute resolution |
| On-chain nonces | On-chain (Soroban contract storage) | **No** — immutable | Required for replay protection; deleting them would break transaction integrity |
| Payer index entries | On-chain (Soroban contract storage) | **No** — immutable | Maps payer address to payment records; required to preserve ledger consistency |
| Event logs / transaction history | On-chain (Stellar ledger, Horizon) | **No** — immutable | Outside LumenFlow's control; subject to Stellar network archive policy |
| Off-chain nonce stores | Off-chain (SDK / operator infrastructure) | **Yes** — erasable | Deleted automatically by the SDK `dataDeletion` module |
| Payer index caches | Off-chain (SDK / operator infrastructure) | **Yes** — erasable | Deleted automatically by the SDK `dataDeletion` module |
| Receipts | Off-chain (operator infrastructure) | **Yes** — erasable | Deleted automatically by the SDK `dataDeletion` module |
| Application logs | Off-chain (operator infrastructure) | **Yes** — erasable | Deleted automatically by the SDK `dataDeletion` module |
| Backups | Off-chain (operator infrastructure) | **Yes** — erasable | Purged on the next backup rotation after deletion |

On-chain nonces and payer index entries **cannot be deleted from the Soroban ledger**. They are retained on the basis of legitimate interests (Art. 6(1)(f)) — specifically fraud prevention, replay protection, and the integrity of the payment ledger — and because erasing them would corrupt the state of the contract for all other participants. The payer address is a pseudonymous identifier rather than a directly identifying attribute, which limits the impact of its retention.

All off-chain copies of payer personal data are erasable and are removed through the automated deletion workflow described in Section 5.

---

## 3. Legal Basis for Processing

LumenFlow processes the above data on the following legal bases under GDPR Article 6:

- **Contract performance (Art. 6(1)(b)):** Processing is necessary to register and identify merchants and to execute payment transactions.
- **Legitimate interests (Art. 6(1)(f)):** Maintaining payment history and global statistics for fraud prevention, dispute resolution, and system integrity.
- **Legal obligation (Art. 6(1)(c)):** Retaining transaction records for the period required by applicable financial regulations.

---

## 4. Data Retention

| Data type | Retention period | Basis |
|-----------|-----------------|-------|
| Merchant profile (PII fields) | Until deletion is requested and confirmed | Contract performance |
| Payment records (on-chain) | Indefinite (blockchain immutability) | Legitimate interests / legal obligation |
| Payment records (contract storage) | Configurable cleanup period (default: 90 days) | Admin discretion |
| Event logs (Horizon/archive) | Subject to Stellar network archive policy | Stellar Foundation |

Admins may configure a shorter payment cleanup period using `set_payment_cleanup_period` and remove stale records using `cleanup_expired_payments`.

---

## 5. Right to Erasure (Right to be Forgotten)

Under GDPR Article 17, data subjects have the right to request erasure of their personal data. LumenFlow implements this right in two parts: an on-chain pseudonymisation step for merchant profile data, and an automated off-chain deletion step for payer data.

### 5.1 Submitting a valid request

A right-to-erasure request is valid when it:

1. Identifies the data subject (merchant address or payer address) and the data to be erased;
2. Is submitted by the data subject, or by someone able to prove authority to act on their behalf; and
3. Is received at **privacy@lumenflow.example.com** or via a GitHub issue labelled `privacy`.

On receipt, the operator records the request and acknowledges it to the data subject. Requests are actioned **within 30 days** of receipt, in line with GDPR Article 12(3).

### 5.2 On-chain pseudonymisation (merchant profile)

When a deletion request is confirmed, the following PII fields in the on-chain merchant profile are replaced with the placeholder value `[deleted]`:

- `name` → `[deleted]`
- `description` → `[deleted]`
- `contact_info` → `[deleted]`

The merchant's Stellar public key (`address`) is retained as a pseudonymous reference to preserve the integrity of existing payment records. Payment amounts, timestamps, and other non-PII fields in payment records are also retained for financial record-keeping purposes.

A `lumenflow/merchant_data_deleted` event is emitted on-chain when deletion is completed.

### 5.3 Automated off-chain deletion (payer data)

Off-chain payer personal data — off-chain nonce stores, payer index caches, receipts, application logs, and backups — is deleted automatically through the SDK's `dataDeletion` module (`sdk/src/security/dataDeletion.ts`). The module:

- Accepts a validated erasure request for a payer address;
- Purges all matching off-chain records from the operator's stores;
- Schedules backup purging on the next rotation cycle; and
- Writes a **confirmation entry to the audit log** recording the request ID, the payer address (hashed), the data categories deleted, and the completion timestamp.

Operators must run the deletion job within the 30-day deadline; the module rejects requests whose deadline has already passed so that overdue requests are escalated rather than silently dropped.

### 5.4 What cannot be deleted

Due to the immutable nature of the Stellar blockchain:

- **On-chain nonces** and **payer index entries** cannot be deleted from the Soroban ledger. They are retained for replay protection, ledger integrity, and fraud prevention (Art. 6(1)(f)), and because deletion would corrupt contract state for other participants.
- **On-chain event logs** and **transaction history** recorded by Stellar Horizon nodes are outside LumenFlow's control and cannot be deleted.
- The payer's Stellar address in payment records is retained as a pseudonymous identifier only.

### 5.5 Confirmation

Once both the on-chain pseudonymisation and the off-chain deletion job have completed, the operator confirms completion to the data subject and the audit log entry produced by `dataDeletion` serves as the record of deletion. See [docs/receipt-privacy-audit.md](docs/receipt-privacy-audit.md) for the audit-log format.

### How to request deletion

See [docs/merchant-onboarding.md — Data Deletion](docs/merchant-onboarding.md#data-deletion) for step-by-step instructions.

---

## 6. Other Data Subject Rights

Under GDPR and equivalent laws, you have the following rights:

| Right | How to exercise |
|-------|----------------|
| **Access (Art. 15)** | Call `get_merchant(merchant_address)` to retrieve your stored profile. |
| **Rectification (Art. 16)** | Call `update_merchant` to correct inaccurate information. |
| **Erasure (Art. 17)** | Follow the [data deletion procedure](docs/merchant-onboarding.md#data-deletion). |
| **Restriction (Art. 18)** | Contact privacy@lumenflow.example.com to discuss restricting processing. |
| **Data portability (Art. 20)** | Your profile and payment history are readable via the contract's public query functions. |
| **Objection (Art. 21)** | Contact privacy@lumenflow.example.com. Note that certain processing is necessary for contract performance. |

To exercise any of these rights, email **privacy@lumenflow.example.com** or open an issue on GitHub with the label `privacy`.

---

## 7. Children's Data

LumenFlow's services are intended for use by businesses and individuals aged 18 and over. We do not knowingly collect or process personal data of children under the age of 16 (or the applicable minimum age in the relevant jurisdiction). If you believe that a child has registered a merchant profile, please contact **privacy@lumenflow.example.com** and we will take appropriate steps to remove the data.

---

## 8. International Data Transfers

Stellar blockchain data is replicated across a globally distributed network of validators. By interacting with the LumenFlow smart contract, you acknowledge that data stored on-chain may be replicated to nodes in jurisdictions outside the European Economic Area. The Stellar network does not provide standard contractual clauses or an adequacy decision. Deployment operators relying on off-chain infrastructure should ensure appropriate transfer mechanisms are in place.

---

## 9. Security

LumenFlow uses the following technical measures to protect data:

- All state-mutating functions require cryptographic authorisation from the relevant address (merchant, payer, or admin).
- The contract can be paused by an admin in response to a security incident.
- Merchant profile updates require the merchant's own signature, preventing unauthorised modification.
- Deletion requests require admin confirmation within 30 days.
- Off-chain payer data deletion is automated via the SDK `dataDeletion` module and confirmed through an audit log entry.

For responsible disclosure of security vulnerabilities, see [SECURITY.md](SECURITY.md).

---

## 10. Cookies and Tracking

The LumenFlow smart contract itself does not use cookies or tracking technologies. Front-end applications built on top of LumenFlow may use cookies or analytics; refer to those applications' privacy policies for details.

---

## 11. Changes to This Policy

We may update this policy from time to time. Material changes will be announced via the [GitHub repository](https://github.com/Gloriachinedu/lumenflow-contracts) and noted in [CHANGELOG.md](CHANGELOG.md). The "Last updated" date at the top of this document indicates when the policy was last revised.

---

## 12. Contact

For all privacy-related enquiries:

- **Email:** privacy@lumenflow.example.com  
- **GitHub:** https://github.com/Gloriachinedu/lumenflow-contracts/issues (label `privacy`)
- **Discord:** https://discord.gg/lumenflow
