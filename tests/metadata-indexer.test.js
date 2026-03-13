import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeAffectedNodes, extractCreatedLedgerIds, extractTxMetadata } from '../apps/ledger-worker/src/runs/xrpl-state.js'

describe('命令4: metadata-driven indexer', () => {
  it('normalizeAffectedNodes handles all 3 node types', () => {
    const nodes = normalizeAffectedNodes({
      AffectedNodes: [
        { CreatedNode: { LedgerEntryType: 'Vault', LedgerIndex: 'V1', NewFields: { Asset: 'XRP' } } },
        { ModifiedNode: { LedgerEntryType: 'AccountRoot', LedgerIndex: 'A1', FinalFields: { Balance: '100' }, PreviousFields: { Balance: '200' } } },
        { DeletedNode: { LedgerEntryType: 'Offer', LedgerIndex: 'O1', FinalFields: { TakerPays: '50' } } }
      ]
    })
    assert.equal(nodes.length, 3)
    assert.equal(nodes[0].action, 'created')
    assert.equal(nodes[0].entryType, 'Vault')
    assert.deepEqual(nodes[0].newFields, { Asset: 'XRP' })
    assert.equal(nodes[1].action, 'modified')
    assert.deepEqual(nodes[1].previousFields, { Balance: '200' })
    assert.equal(nodes[2].action, 'deleted')
  })

  it('extractCreatedLedgerIds includes normalizedNodes', () => {
    const result = extractCreatedLedgerIds({
      meta: { AffectedNodes: [
        { CreatedNode: { LedgerEntryType: 'Vault', LedgerIndex: 'V1', NewFields: {} } }
      ]}
    })
    assert.equal(result.vaultId, 'V1')
    assert.ok(Array.isArray(result.normalizedNodes))
    assert.equal(result.normalizedNodes.length, 1)
    assert.equal(result.normalizedNodes[0].action, 'created')
  })

  it('extractTxMetadata captures ledgerIndex and transactionIndex', () => {
    const meta = extractTxMetadata({
      hash: 'TX_HASH_123',
      ledger_index: 42,
      meta: {
        TransactionResult: 'tesSUCCESS',
        TransactionIndex: 7,
        AffectedNodes: [
          { CreatedNode: { LedgerEntryType: 'Vault', LedgerIndex: 'V1', NewFields: {} } }
        ]
      }
    })
    assert.equal(meta.txHash, 'TX_HASH_123')
    assert.equal(meta.ledgerIndex, 42)
    assert.equal(meta.transactionIndex, 7)
    assert.equal(meta.resultCode, 'tesSUCCESS')
    assert.equal(meta.nodes.length, 1)
  })

  it('extractCreatedLedgerIds only picks created nodes', () => {
    const result = extractCreatedLedgerIds({
      meta: { AffectedNodes: [
        { ModifiedNode: { LedgerEntryType: 'Vault', LedgerIndex: 'MODIFIED_NOT_CREATED' } },
        { CreatedNode: { LedgerEntryType: 'Vault', LedgerIndex: 'CREATED' } }
      ]}
    })
    assert.equal(result.vaultId, 'CREATED')
  })
})
