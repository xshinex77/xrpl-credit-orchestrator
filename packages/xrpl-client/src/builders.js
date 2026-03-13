/**
 * packages/xrpl-client/src/builders.js
 * ──────────────────────────────────────────────
 * XLS-65d / XLS-66d aligned transaction builders.
 *
 * Field names match public XRPL Lending / Vault spec:
 *   - LoanBrokerCollateralDeposit (not CoverDeposit)
 *   - Borrower (not Counterparty)
 *   - PaymentsTotal (not PaymentTotal)
 *   - StartDate, LatePaymentFee, FullPaymentFee, LateInterestRate, ClosingInterestRate
 */

export function ensureString(name, value) {
  if (!value || typeof value !== 'string') {
    throw new Error(`${name} must be a non-empty string`)
  }
  return value
}

export function hexMetadataFromJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('hex').toUpperCase()
}

// ─── Vault ──────

export function buildVaultCreateTx(input) {
  const tx = {
    TransactionType: 'VaultCreate',
    Account: ensureString('account', input.account),
    Asset: input.asset,
    AssetsMaximum: String(input.assetsMaximum ?? '0'),
    WithdrawalPolicy: input.withdrawalPolicy ?? 0
  }
  if (input.domainId) tx.DomainID = input.domainId
  if (input.data) tx.Data = typeof input.data === 'string' ? input.data : hexMetadataFromJson(input.data)
  if (input.mptMetadataHex) tx.MPTokenMetadata = input.mptMetadataHex
  if (typeof input.flags === 'number') tx.Flags = input.flags
  return tx
}

export function buildVaultDepositTx(input) {
  return {
    TransactionType: 'VaultDeposit',
    Account: ensureString('account', input.account),
    VaultID: ensureString('vaultId', input.vaultId),
    Amount: input.amount
  }
}

// ─── Loan Broker ──────

export function buildLoanBrokerSetTx(input) {
  const tx = {
    TransactionType: 'LoanBrokerSet',
    Account: ensureString('account', input.account),
    VaultID: ensureString('vaultId', input.vaultId)
  }
  if (input.loanBrokerId) tx.LoanBrokerID = input.loanBrokerId
  if (input.managementFeeRate !== undefined) tx.ManagementFeeRate = input.managementFeeRate
  if (input.debtMaximum !== undefined) tx.DebtMaximum = String(input.debtMaximum)
  if (input.collateralRateMinimum !== undefined) tx.CollateralRateMinimum = input.collateralRateMinimum
  if (input.collateralRateLiquidation !== undefined) tx.CollateralRateLiquidation = input.collateralRateLiquidation
  // Legacy compat: accept old field names
  if (input.coverRateMinimum !== undefined && tx.CollateralRateMinimum === undefined) tx.CollateralRateMinimum = input.coverRateMinimum
  if (input.coverRateLiquidation !== undefined && tx.CollateralRateLiquidation === undefined) tx.CollateralRateLiquidation = input.coverRateLiquidation
  if (input.data) tx.Data = typeof input.data === 'string' ? input.data : hexMetadataFromJson(input.data)
  return tx
}

/**
 * XLS-66d: LoanBrokerCollateralDeposit (not CoverDeposit)
 */
export function buildLoanBrokerCollateralDepositTx(input) {
  return {
    TransactionType: 'LoanBrokerCollateralDeposit',
    Account: ensureString('account', input.account),
    LoanBrokerID: ensureString('loanBrokerId', input.loanBrokerId),
    Amount: input.amount
  }
}

// Legacy alias — will be removed in future version
export const buildLoanBrokerCoverDepositTx = buildLoanBrokerCollateralDepositTx

// ─── Loan ──────

/**
 * XLS-66d aligned LoanSet builder.
 *
 * Required: Account, Borrower, LoanBrokerID, PrincipalRequested,
 *           InterestRate, PaymentsTotal, PaymentInterval
 * Optional: GracePeriod, StartDate, LoanOriginationFee, LoanServiceFee,
 *           LatePaymentFee, FullPaymentFee, LateInterestRate, ClosingInterestRate
 */
export function buildLoanSetTx(input) {
  const tx = {
    TransactionType: 'LoanSet',
    Account: ensureString('account', input.account),
    Borrower: ensureString('borrower', input.borrower ?? input.counterparty),
    LoanBrokerID: ensureString('loanBrokerId', input.loanBrokerId),
    PrincipalRequested: String(input.principalRequested),
    InterestRate: input.interestRate,
    PaymentsTotal: input.paymentsTotal ?? input.paymentTotal,
    PaymentInterval: input.paymentInterval
  }
  // Optional fields
  if (input.gracePeriod !== undefined) tx.GracePeriod = input.gracePeriod
  if (input.startDate !== undefined) tx.StartDate = input.startDate
  if (input.loanOriginationFee !== undefined) tx.LoanOriginationFee = String(input.loanOriginationFee)
  if (input.loanServiceFee !== undefined) tx.LoanServiceFee = String(input.loanServiceFee)
  if (input.latePaymentFee !== undefined) tx.LatePaymentFee = String(input.latePaymentFee)
  if (input.fullPaymentFee !== undefined) tx.FullPaymentFee = String(input.fullPaymentFee)
  if (input.lateInterestRate !== undefined) tx.LateInterestRate = input.lateInterestRate
  if (input.closingInterestRate !== undefined) tx.ClosingInterestRate = input.closingInterestRate
  return tx
}
