# Security

## Authentication — Development Only

The current authentication implementation is **development-only** and is **not production-grade**.

Specifically:

- Password hashing uses a fixed salt (`scryptSync` with static salt). Production must use per-user random salts.
- Token issuance is a self-contained HMAC-SHA256 JWT without refresh, rotation, issuer, or audience validation.
- There is no session management, token revocation, or rate-limited login attempt tracking.
- Default credentials exist for development convenience and must never be used in any deployment.

**Do not deploy this authentication layer to any environment accessible from the internet.**

For production, replace with:

- OAuth 2.0 / OIDC provider (Auth0, AWS Cognito, Keycloak, etc.)
- Per-user salted password hashing (argon2id recommended)
- Short-lived access tokens with refresh rotation
- MFA for operator and admin roles

## Key Management

- `DevEnvKeyStore` and `DevFileKeyStore` are **development-only**. They hold seeds in process memory.
- Production signing must use `AwsKmsKeyStore`, `GcpKmsKeyStore`, or `HsmKeyStore`.
- Seeds must never appear in environment variables, logs, CI output, or source control.
- The `packages/logger` redaction system masks seed patterns, but defense-in-depth requires that seeds never reach the logger in the first place.

## What is not in this repository

The following are intentionally excluded from the public repository:

- Production signer backend implementations (KMS/HSM key bindings)
- Underwriting decision models and scoring rules
- Fraud detection, sanctions screening, and AML logic
- Collections and default management procedures
- Incident response runbooks and escalation procedures
- Production deployment manifests with real secrets
- Funded account credentials and live network keys

## Reporting

If you discover a security issue, do not open a public issue. Contact the maintainer directly.
