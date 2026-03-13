import test from 'node:test'
import assert from 'node:assert/strict'
import { extractCreatedLedgerIds } from '../apps/ledger-worker/src/runs/xrpl-state.js'
import { createKeyStore } from '../packages/keystore/src/index.js'

test('extractCreatedLedgerIds finds created vault, broker, and loan ids', () => {
  const parsed = extractCreatedLedgerIds({
    meta: {
      AffectedNodes: [
        { CreatedNode: { LedgerEntryType: 'Vault', LedgerIndex: 'V123', NewFields: {} } },
        { CreatedNode: { LedgerEntryType: 'LoanBroker', LedgerIndex: 'B456', NewFields: {} } },
        { CreatedNode: { LedgerEntryType: 'Loan', LedgerIndex: 'L789', NewFields: { LoanSeq: 77 } } }
      ]
    }
  })
  assert.equal(parsed.vaultId, 'V123')
  assert.equal(parsed.loanBrokerId, 'B456')
  assert.equal(parsed.loanId, 'L789')
  assert.equal(parsed.loanSeq, 77)
})

test('keystore factory returns env provider with hasKey', () => {
  const store = createKeyStore({ provider: 'env', seedsJson: '{"rTest":"sTest"}' })
  assert.equal(store.hasKey('rTest'), true)
  assert.equal(store.hasKey('rNonExistent'), false)
  assert.equal(store.describe().provider, 'env')
  assert.equal(store.describe().mode, 'DEV_ONLY')
  assert.equal(store.describe().loadedAddresses, 1)
})
