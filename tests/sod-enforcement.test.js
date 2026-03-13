import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryDatabase } from '../apps/control-api/src/db/memory.js'
import { EvidenceService } from '../apps/control-api/src/services/evidence.service.js'
import { LoansService } from '../apps/control-api/src/services/loans.service.js'

describe('SoD enforcement in LoansService', () => {
  async function setup() {
    const db = new MemoryDatabase({ devAdminUsername: 'admin', devAdminPassword: 'test' })
    const evidence = new EvidenceService(db)
    const loans = new LoansService(db, evidence)

    // Create broker + vault with real IDs so prepareCosignPacket works
    const vault = await db.createVault({ ownerAddress: 'rOwner', assetType: 'XRP', isPrivate: false })
    await db.updateVault(vault.id, { xrplVaultId: 'VAULT_REAL_ID' })
    const broker = await db.createLoanBroker({ vaultId: vault.id, ownerAddress: 'rOwner' })
    await db.updateLoanBroker(broker.id, { xrplLoanBrokerId: 'BROKER_REAL_ID' })

    const loan = await loans.create({
      loanBrokerId: broker.id,
      borrowerAddress: 'rBorrower',
      borrowerPartyId: null,
      principal: 1000000,
      interestRate: 120000,
      paymentTotal: 12,
      paymentInterval: 2592000,
      gracePeriod: 604800
    }, { sub: 'user_approver', role: 'risk_operator' })

    return { db, evidence, loans, loan, broker }
  }

  it('allows different users for approve and submit', async () => {
    const { loans, loan } = await setup()
    // Different user does prepareCosignPacket — should succeed
    const result = await loans.prepareCosignPacket(loan.id, { sub: 'user_submitter', role: 'ledger_operator' })
    assert.ok(result.cosignPacket)
  })

  it('blocks same user from approve + submit (SoD violation)', async () => {
    const { loans, loan } = await setup()
    // Same user who approved tries to submit — should fail
    await assert.rejects(
      () => loans.prepareCosignPacket(loan.id, { sub: 'user_approver', role: 'risk_operator' }),
      (err) => err.message.includes('sod_violation')
    )
  })

  it('blocks same user from approve + broker sign', async () => {
    const { loans, loan } = await setup()
    // First prepare cosign packet with different user
    await loans.prepareCosignPacket(loan.id, { sub: 'user_submitter', role: 'ledger_operator' })
    // Same user who approved tries to broker sign — should fail
    await assert.rejects(
      () => loans.recordBrokerSignature(loan.id, 'blob', 'hash', { sub: 'user_approver', role: 'risk_operator' }),
      (err) => err.message.includes('sod_violation')
    )
  })
})
