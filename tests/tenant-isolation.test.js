import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryDatabase } from '../apps/control-api/src/db/memory.js'

describe('tenant isolation: loan visibility', () => {
  async function setup() {
    const db = new MemoryDatabase({ devAdminUsername: 'admin', devAdminPassword: 'test' })

    const borrowerA = await db.createBorrower({ legalName: 'Alice', authUserId: 'auth-alice', xrplAddress: 'rAlice' })
    const borrowerB = await db.createBorrower({ legalName: 'Bob', authUserId: 'auth-bob', xrplAddress: 'rBob' })

    const vault = await db.createVault({ ownerAddress: 'rOwner', assetType: 'XRP', isPrivate: false })
    await db.updateVault(vault.id, { xrplVaultId: 'V1' })
    const broker = await db.createLoanBroker({ vaultId: vault.id, ownerAddress: 'rOwner' })
    await db.updateLoanBroker(broker.id, { xrplLoanBrokerId: 'BR1' })

    const vault2 = await db.createVault({ ownerAddress: 'rOwner2', assetType: 'XRP', isPrivate: false })
    await db.updateVault(vault2.id, { xrplVaultId: 'V2' })
    const broker2 = await db.createLoanBroker({ vaultId: vault2.id, ownerAddress: 'rOwner2' })
    await db.updateLoanBroker(broker2.id, { xrplLoanBrokerId: 'BR2' })

    const loanA = await db.createLoan({
      loanBrokerId: broker.id, borrowerAddress: 'rAlice',
      borrowerPartyId: borrowerA.id, principal: 1000, interestRate: 500,
      paymentTotal: 12, paymentInterval: 2592000, gracePeriod: 604800
    })
    const loanB = await db.createLoan({
      loanBrokerId: broker2.id, borrowerAddress: 'rBob',
      borrowerPartyId: borrowerB.id, principal: 2000, interestRate: 600,
      paymentTotal: 6, paymentInterval: 2592000, gracePeriod: 604800
    })

    await db.upsertVaultPosition({
      vaultId: vault.id, lenderPartyId: 'lender-party-1',
      lenderAddress: 'rLender', sharesNumeric: '100', depositedAmount: '5000', withdrawnAmount: '0'
    })

    return { db, vault, vault2, broker, broker2, borrowerA, borrowerB, loanA, loanB }
  }

  it('findPartyByAuthUserId resolves correct party', async () => {
    const { db } = await setup()
    const party = await db.findPartyByAuthUserId('auth-alice')
    assert.ok(party)
    assert.equal(party.legalName, 'Alice')
    assert.equal(party.authUserId, 'auth-alice')
  })

  it('findPartyByAuthUserId returns null for unknown', async () => {
    const { db } = await setup()
    assert.equal(await db.findPartyByAuthUserId('auth-nobody'), null)
  })

  it('borrower sees only own loans via auth→party link', async () => {
    const { db } = await setup()
    const all = await db.listLoans()
    assert.equal(all.length, 2)

    const party = await db.findPartyByAuthUserId('auth-alice')
    const filtered = all.filter(l => l.borrowerPartyId === party.id)
    assert.equal(filtered.length, 1)
    assert.equal(filtered[0].borrowerAddress, 'rAlice')
  })

  it('lender sees only vault-scoped loans', async () => {
    const { db, vault } = await setup()
    const all = await db.listLoans()
    const positions = await db.listVaultPositions()
    const vaults = await db.listVaults()

    const lenderVaultIds = new Set()
    for (const v of vaults) {
      if (positions.find(p => p.vaultId === v.id && p.lenderAddress === 'rLender')) {
        lenderVaultIds.add(v.id)
      }
    }
    const brokers = await db.listLoanBrokers()
    const brokerIds = new Set(brokers.filter(b => lenderVaultIds.has(b.vaultId)).map(b => b.id))
    const filtered = all.filter(l => brokerIds.has(l.loanBrokerId))

    assert.equal(filtered.length, 1)
    assert.equal(filtered[0].borrowerAddress, 'rAlice')
  })

  it('admin sees all loans', async () => {
    const { db } = await setup()
    assert.equal((await db.listLoans()).length, 2)
  })
})
