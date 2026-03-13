import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryDatabase } from '../apps/control-api/src/db/memory.js'
import { EvidenceService } from '../apps/control-api/src/services/evidence.service.js'
import { LoansService } from '../apps/control-api/src/services/loans.service.js'

describe('loan_set idempotency', () => {
  async function setup() {
    const db = new MemoryDatabase({ devAdminUsername: 'admin', devAdminPassword: 'test' })
    const evidence = new EvidenceService(db)
    const loans = new LoansService(db, evidence)
    const vault = await db.createVault({ ownerAddress: 'rOwner', assetType: 'XRP', isPrivate: false })
    await db.updateVault(vault.id, { xrplVaultId: 'V_ID' })
    const broker = await db.createLoanBroker({ vaultId: vault.id, ownerAddress: 'rOwner' })
    await db.updateLoanBroker(broker.id, { xrplLoanBrokerId: 'B_ID' })
    const loan = await loans.create({
      loanBrokerId: broker.id, borrowerAddress: 'rBorrower', borrowerPartyId: null,
      principal: 1000000, interestRate: 120000, paymentTotal: 12,
      paymentInterval: 2592000, gracePeriod: 604800
    }, { sub: 'approver', role: 'risk_operator' })
    return { db, loans, loan }
  }

  it('first cosign packet creation succeeds', async () => {
    const { loans, loan } = await setup()
    const result = await loans.prepareCosignPacket(loan.id, { sub: 'submitter', role: 'ledger_operator' })
    assert.ok(result.cosignPacket)
    assert.ok(result.outbox)
  })

  it('second cosign packet for same loan is rejected (dedupe)', async () => {
    const { loans, loan } = await setup()
    await loans.prepareCosignPacket(loan.id, { sub: 'submitter', role: 'ledger_operator' })
    await assert.rejects(
      () => loans.prepareCosignPacket(loan.id, { sub: 'submitter2', role: 'ledger_operator' }),
      (err) => err.message.includes('duplicate_outbox') || err.message.includes('invalid_state')
    )
  })
})
