# XRPL Credit Orchestrator

A control-plane prototype for XRPL native lending workflows.

This repository focuses on the **off-chain orchestration layer** around XRPL Single Asset Vaults and Lending:

- Vault and loan-broker lifecycle orchestration
- Loan preparation and cosign workflow handling
- Transaction outbox and worker execution with sequence coordination
- Evidence hash-chaining and operator audit surfaces
- Borrower / lender / operator control interfaces
- Structured logging, metrics, and reconciliation

This is **not** a protocol-complete or production-ready implementation.
It is a practical prototype intended to demonstrate system architecture, orchestration boundaries, and operational workflow design around XRPL lending.

## Protocol alignment note

This repository is aligned to the XRPL lending direction (XLS-65d / XLS-66d) and related protocol work, but should be treated as an **orchestration prototype** rather than a full spec-complete implementation.

Field names, transaction naming, and signing flows may continue to evolve with upstream protocol and implementation changes. The XRPL Lending Protocol requires off-chain underwriting and risk management by design — this repository implements that control plane.

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│ Borrower    │     │ Lender       │     │ Operator        │
│ Portal      │     │ Portal       │     │ Console         │
└──────┬──────┘     └──────┬───────┘     └───────┬─────────┘
       │                   │                     │
       └───────────────────┴─────────────────────┘
                           │
                    ┌──────▼──────┐
                    │ control-api │  ← auth, RBAC, SoD, rate limit
                    │             │  ← evidence hash-chain
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │ tx outbox   │  ← idempotent, dedupe-keyed
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │ ledger      │  ← sequence coordinator
                    │ worker      │  ← network guard (amendment, fee)
                    │             │  ← sign via keystore (KMS/HSM)
                    │             │  ← submit → lookup (no submitAndWait)
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │ XRPL Devnet │
                    └─────────────┘
```

## What is implemented

- **control-api**: HTTP API with 6-tier RBAC, SoD enforcement, rate limiting
- **ledger-worker**: outbox processor, sequence coordinator, network guard, retry matrix
- **evidence-sdk**: append-only hash-chain with chain anchoring and audit bundle export
- **keystore**: sign-only interface (seed never exposed), AWS KMS / GCP KMS / HSM scaffold
- **logger**: structured JSON logging with automatic secret redaction
- **metrics**: Prometheus-compatible counters, histograms, gauges
- **reconciliation**: object-type-specific jobs, mismatch severity, daily full reconciliation
- **builders**: XLS-66d aligned tx builders (VaultCreate, VaultDeposit, LoanBrokerSet, LoanBrokerCollateralDeposit, LoanSet)
- **cosign workflow**: two-phase signing (broker → borrower) with signature order invariant
- **portals**: operator console, borrower portal, lender portal

## What is intentionally not included

- Production secrets, funded accounts, or live network keys
- Production signer backend implementations
- Internal underwriting decision models
- Fraud detection, sanctions screening, AML logic
- Collections and default management
- Incident response runbooks
- Production deployment manifests with real secrets

## Local development

```bash
cp .env.example .env
# Edit .env with your values

# For Devnet testing:
node scripts/devnet-fund.js    # Funds 3 accounts, writes .env + .devnet-seeds.json
npm run check:env              # Validates configuration
npm run smoke:devnet           # Verifies XRPL Devnet connectivity

# Start services:
npm run start:api              # control-api on :3000
npm run start:worker           # ledger-worker
npm run start:ops              # operator console on :4173

# Tests:
npm test                       # All tests
npm run e2e:devnet             # End-to-end Devnet flow
```

## Security

See [docs/SECURITY.md](docs/SECURITY.md) for authentication limitations, key management, and public/private boundary details.

**Never commit `.env`, `.devnet-seeds.json`, or `.devnet-accounts.json` to source control.**

## Tests

```
114 tests passing across 23 suites
```

Coverage includes: builder shape validation, evidence chain verification, keystore interface, SoD enforcement, role-based access, result code classification, reconciliation severity, metadata parsing, sequence coordination, redaction, and metrics.

## License

See LICENSE file.
