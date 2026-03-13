import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { VaultsService } from '../apps/control-api/src/services/vaults.service.js'

// Minimal mock DB
function mockDb(vaultOverrides = {}, brokerOverrides = {}) {
  return {
    getVault: async () => ({
      id: 'v1', xrplVaultId: null, ownerAddress: 'rOwner',
      assetType: 'XRP', assetCode: null, issuerAddress: null,
      assetMptIssuanceId: null, status: 'queued',
      ...vaultOverrides
    }),
    getLoanBroker: async () => ({
      id: 'b1', xrplLoanBrokerId: null, ownerAddress: 'rOwner',
      vaultId: 'v1', status: 'queued',
      ...brokerOverrides
    }),
    createVault: async (i) => ({ id: 'v1', ...i }),
    createLoanBroker: async (i) => ({ id: 'b1', ...i }),
    enqueueTx: async (i) => ({ id: 'tx1', kind: i.kind }),
    upsertVaultPosition: async () => ({}),
    appendCoverLedger: async () => ({})
  }
}

const mockEvidence = { append: async () => ({}) }

describe('vaults.service readiness guards', () => {
  it('deposit throws when xrplVaultId is null', async () => {
    const svc = new VaultsService(mockDb({ xrplVaultId: null }), mockEvidence)
    await assert.rejects(
      () => svc.deposit('v1', { account: 'rLender', amount: '1000' }, null),
      (err) => err.message.includes('vault_not_ready')
    )
  })

  it('deposit throws when xrplVaultId starts with UNSET', async () => {
    const svc = new VaultsService(mockDb({ xrplVaultId: 'UNSET-v1' }), mockEvidence)
    await assert.rejects(
      () => svc.deposit('v1', { account: 'rLender', amount: '1000' }, null),
      (err) => err.message.includes('vault_not_ready')
    )
  })

  it('deposit succeeds when xrplVaultId is real', async () => {
    const svc = new VaultsService(
      mockDb({ xrplVaultId: 'ABC123DEF456' }),
      mockEvidence
    )
    const result = await svc.deposit('v1', { account: 'rLender', amount: '1000' }, null)
    assert.ok(result.outbox)
  })

  it('createLoanBroker throws when vault xrplVaultId is null', async () => {
    const svc = new VaultsService(mockDb({ xrplVaultId: null }), mockEvidence)
    await assert.rejects(
      () => svc.createLoanBroker({
        vaultId: 'v1', ownerAddress: 'rOwner'
      }, null),
      (err) => err.message.includes('vault_not_ready')
    )
  })

  it('depositCover throws when xrplLoanBrokerId is null', async () => {
    const svc = new VaultsService(
      mockDb({}, { xrplLoanBrokerId: null }),
      mockEvidence
    )
    await assert.rejects(
      () => svc.depositCover('b1', { amount: '1000' }, null),
      (err) => err.message.includes('loan_broker_not_ready')
    )
  })

  it('depositCover succeeds when xrplLoanBrokerId is real', async () => {
    const svc = new VaultsService(
      mockDb({}, { xrplLoanBrokerId: 'BROKER_REAL_ID' }),
      mockEvidence
    )
    const result = await svc.depositCover('b1', { amount: '1000' }, null)
    assert.ok(result.outbox)
  })
})
