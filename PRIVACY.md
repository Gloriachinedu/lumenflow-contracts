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

Under GDPR Article 17, data subjects have the right to request erasure of their personal data. LumenFlow implements this right through the `request_merchant_data_deletion` contract function.

### What happens when you request deletion

When a deletion request is confirmed, the following PII fields in the on-chain merchant profile are replaced with the placeholder value `[deleted]`:

- `name` → `[deleted]`
- `description` → `[deleted]`
- `contact_info` → `[deleted]`

The merchant's Stellar public key (`address`) is retained as a pseudonymous reference to preserve the integrity of existing payment records. Payment amounts, timestamps, and other non-PII fields in payment records are also retained for financial record-keeping purposes.

A `lumenflow/merchant_data_deleted` event is emitted on-chain when deletion is completed.

### Limitations

Due to the immutable nature of the Stellar blockchain:

- On-chain **event logs** and **transaction history** recorded by Stellar Horizon nodes are outside LumenFlow's control and cannot be deleted.
- **Off-chain copies** of data (backups, analytics systems, third-party integrations) must be handled separately by the platform operator.

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
