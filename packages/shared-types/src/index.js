export const Roles = Object.freeze({
  PLATFORM_ADMIN: 'platform_admin',
  RISK_OPERATOR: 'risk_operator',
  LEDGER_OPERATOR: 'ledger_operator',
  AUDITOR: 'auditor',
  LENDER: 'lender',
  BORROWER: 'borrower',
  // Legacy compat
  ADMIN: 'platform_admin',
  OPERATOR: 'risk_operator'
})

/**
 * 命令8: Separation of Duties matrix.
 * Actions that the same user CANNOT perform in the same aggregate lifecycle.
 */
export const SoDConstraints = Object.freeze({
  // The user who approves a loan cannot also submit it
  LOAN_APPROVE: ['LOAN_SUBMIT', 'RECONCILIATION_CLOSE'],
  // The user who submits cannot close reconciliation
  LOAN_SUBMIT: ['LOAN_APPROVE', 'RECONCILIATION_CLOSE'],
  RECONCILIATION_CLOSE: ['LOAN_APPROVE', 'LOAN_SUBMIT']
})

export const TxKinds = Object.freeze({
  VAULT_CREATE: 'vault_create',
  VAULT_DEPOSIT: 'vault_deposit',
  LOAN_BROKER_SET: 'loan_broker_set',
  LOAN_BROKER_COLLATERAL_DEPOSIT: 'loan_broker_collateral_deposit',
  // Legacy alias
  LOAN_BROKER_COVER_DEPOSIT: 'loan_broker_collateral_deposit',
  LOAN_SET: 'loan_set'
})

export const OutboxStatuses = Object.freeze({
  PENDING: 'pending',
  PROCESSING: 'processing',
  PREPARED: 'prepared',
  SIGNED_1: 'signed_1',       // 命令2: broker/account signed
  SIGNED_2: 'signed_2',       // 命令2: counterparty signed (fully signed)
  SUBMITTED: 'submitted',
  VALIDATED: 'validated',
  INDEXED: 'indexed',
  RECONCILED: 'reconciled',
  CLOSED: 'closed',           // 命令2: terminal confirmed state
  FAILED: 'failed',
  BLOCKED: 'blocked',
  MANUAL_REVIEW: 'manual_review'  // 命令6: needs operator attention
})

export const LoanStatuses = Object.freeze({
  QUOTED: 'quoted',
  APPROVED: 'approved',
  COSIGN_PENDING: 'cosign_pending',
  ACTIVE: 'active',
  IMPAIRED: 'impaired',
  DEFAULTED: 'defaulted',
  REPAID: 'repaid',
  CLOSED: 'closed'
})

export const VaultStatuses = Object.freeze({
  QUEUED: 'queued',
  ACTIVE: 'active',
  FUNDED: 'funded',
  FAILED: 'failed'
})

export const LoanBrokerStatuses = Object.freeze({
  QUEUED: 'queued',
  ACTIVE: 'active',
  COVER_FUNDED: 'cover_funded',
  FAILED: 'failed'
})

export function nowIso() {
  return new Date().toISOString()
}
