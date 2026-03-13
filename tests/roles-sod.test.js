import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Roles, SoDConstraints } from '../packages/shared-types/src/index.js'
import { isRoleAllowed } from '../apps/control-api/src/http/auth.js'

describe('命令8: 6-tier role model', () => {
  it('Roles has 6 distinct tiers', () => {
    const tiers = new Set([
      Roles.PLATFORM_ADMIN, Roles.RISK_OPERATOR, Roles.LEDGER_OPERATOR,
      Roles.AUDITOR, Roles.LENDER, Roles.BORROWER
    ])
    assert.equal(tiers.size, 6)
  })

  it('Legacy aliases resolve correctly', () => {
    assert.equal(Roles.ADMIN, 'platform_admin')
    assert.equal(Roles.OPERATOR, 'risk_operator')
  })

  it('SoDConstraints defines separation rules', () => {
    assert.ok(SoDConstraints.LOAN_APPROVE.includes('LOAN_SUBMIT'))
    assert.ok(SoDConstraints.LOAN_SUBMIT.includes('RECONCILIATION_CLOSE'))
    assert.ok(SoDConstraints.RECONCILIATION_CLOSE.includes('LOAN_APPROVE'))
  })
})

describe('命令8: isRoleAllowed with legacy compat', () => {
  it('platform_admin matches ADMIN route', () => {
    assert.equal(isRoleAllowed('platform_admin', ['platform_admin']), true)
  })

  it('legacy admin role maps to platform_admin', () => {
    assert.equal(isRoleAllowed('admin', ['platform_admin']), true)
  })

  it('legacy operator maps to risk_operator', () => {
    assert.equal(isRoleAllowed('operator', ['risk_operator']), true)
  })

  it('borrower matches borrower', () => {
    assert.equal(isRoleAllowed('borrower', ['borrower']), true)
  })

  it('auditor cannot access admin routes', () => {
    assert.equal(isRoleAllowed('auditor', ['platform_admin', 'risk_operator']), false)
  })

  it('lender cannot access operator routes', () => {
    assert.equal(isRoleAllowed('lender', ['platform_admin', 'risk_operator']), false)
  })
})
