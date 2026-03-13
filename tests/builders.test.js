import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildVaultCreateTx,
  buildVaultDepositTx,
  buildLoanBrokerSetTx,
  buildLoanBrokerCollateralDepositTx,
  buildLoanBrokerCoverDepositTx,
  buildLoanSetTx
} from '../packages/xrpl-client/src/builders.js'

describe('XLS-66d aligned builders', () => {
  it('VaultCreate emits correct shape', () => {
    const tx = buildVaultCreateTx({
      account: 'rA', asset: { currency: 'XRP' }, assetsMaximum: '0', withdrawalPolicy: 0
    })
    assert.equal(tx.TransactionType, 'VaultCreate')
    assert.equal(tx.Account, 'rA')
  })

  it('VaultDeposit emits correct shape', () => {
    const tx = buildVaultDepositTx({ account: 'rD', vaultId: 'V1', amount: '1000' })
    assert.equal(tx.TransactionType, 'VaultDeposit')
    assert.equal(tx.VaultID, 'V1')
  })

  it('LoanBrokerSet uses CollateralRate fields', () => {
    const tx = buildLoanBrokerSetTx({
      account: 'rB', vaultId: 'V1',
      collateralRateMinimum: 100000, collateralRateLiquidation: 50000
    })
    assert.equal(tx.CollateralRateMinimum, 100000)
    assert.equal(tx.CollateralRateLiquidation, 50000)
  })

  it('LoanBrokerSet accepts legacy coverRate fields', () => {
    const tx = buildLoanBrokerSetTx({
      account: 'rB', vaultId: 'V1',
      coverRateMinimum: 100000, coverRateLiquidation: 50000
    })
    assert.equal(tx.CollateralRateMinimum, 100000)
    assert.equal(tx.CollateralRateLiquidation, 50000)
  })

  it('LoanBrokerCollateralDeposit emits correct TransactionType', () => {
    const tx = buildLoanBrokerCollateralDepositTx({
      account: 'rB', loanBrokerId: 'BR1', amount: '5000'
    })
    assert.equal(tx.TransactionType, 'LoanBrokerCollateralDeposit')
    assert.equal(tx.LoanBrokerID, 'BR1')
  })

  it('legacy CoverDeposit alias works', () => {
    const tx = buildLoanBrokerCoverDepositTx({
      account: 'rB', loanBrokerId: 'BR1', amount: '5000'
    })
    assert.equal(tx.TransactionType, 'LoanBrokerCollateralDeposit')
  })

  it('LoanSet uses Borrower field (not Counterparty)', () => {
    const tx = buildLoanSetTx({
      account: 'rBroker', borrower: 'rBorrower', loanBrokerId: 'BR1',
      principalRequested: '1000', interestRate: 500,
      paymentsTotal: 12, paymentInterval: 2592000
    })
    assert.equal(tx.TransactionType, 'LoanSet')
    assert.equal(tx.Borrower, 'rBorrower')
    assert.equal(tx.Counterparty, undefined)
    assert.equal(tx.PaymentsTotal, 12)
    assert.equal(tx.PaymentTotal, undefined)
  })

  it('LoanSet accepts legacy counterparty/paymentTotal', () => {
    const tx = buildLoanSetTx({
      account: 'rBroker', counterparty: 'rBorrower', loanBrokerId: 'BR1',
      principalRequested: '1000', interestRate: 500,
      paymentTotal: 12, paymentInterval: 2592000
    })
    assert.equal(tx.Borrower, 'rBorrower')
    assert.equal(tx.PaymentsTotal, 12)
  })

  it('LoanSet includes optional XLS-66d fields', () => {
    const tx = buildLoanSetTx({
      account: 'rB', borrower: 'rBr', loanBrokerId: 'BR1',
      principalRequested: '1000', interestRate: 500,
      paymentsTotal: 12, paymentInterval: 2592000,
      startDate: 784111600, gracePeriod: 604800,
      latePaymentFee: '100', fullPaymentFee: '50',
      lateInterestRate: 800, closingInterestRate: 200,
      loanOriginationFee: '10', loanServiceFee: '5'
    })
    assert.equal(tx.StartDate, 784111600)
    assert.equal(tx.LatePaymentFee, '100')
    assert.equal(tx.FullPaymentFee, '50')
    assert.equal(tx.LateInterestRate, 800)
    assert.equal(tx.ClosingInterestRate, 200)
    assert.equal(tx.GracePeriod, 604800)
  })
})
