import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { extractCreatedLedgerIds } from '../apps/ledger-worker/src/runs/xrpl-state.js'

describe('extractCreatedLedgerIds', () => {
  it('extracts vaultId from standard CreatedNode', () => {
    const result = {
      meta: {
        AffectedNodes: [
          {
            CreatedNode: {
              LedgerEntryType: 'Vault',
              LedgerIndex: 'AABB00112233'
            }
          }
        ]
      }
    }
    const out = extractCreatedLedgerIds(result)
    assert.equal(out.vaultId, 'AABB00112233')
    assert.deepEqual(out.affectedTypes, ['Vault'])
  })

  it('extracts vaultId from NewFields.index fallback', () => {
    const result = {
      meta: {
        AffectedNodes: [
          {
            CreatedNode: {
              LedgerEntryType: 'Vault',
              NewFields: { index: 'FALLBACK_INDEX_123' }
            }
          }
        ]
      }
    }
    const out = extractCreatedLedgerIds(result)
    assert.equal(out.vaultId, 'FALLBACK_INDEX_123')
  })

  it('extracts loanBrokerId from LoanBroker type', () => {
    const result = {
      meta: {
        AffectedNodes: [
          {
            CreatedNode: {
              LedgerEntryType: 'LoanBroker',
              LedgerIndex: 'BROKER_001'
            }
          }
        ]
      }
    }
    const out = extractCreatedLedgerIds(result)
    assert.equal(out.loanBrokerId, 'BROKER_001')
  })

  it('extracts loanBrokerId from LoanManager variant', () => {
    const result = {
      meta: {
        AffectedNodes: [
          {
            CreatedNode: {
              LedgerEntryType: 'LoanManager',
              LedgerIndex: 'MANAGER_001'
            }
          }
        ]
      }
    }
    const out = extractCreatedLedgerIds(result)
    assert.equal(out.loanBrokerId, 'MANAGER_001')
  })

  it('extracts loanId and loanSeq', () => {
    const result = {
      meta: {
        AffectedNodes: [
          {
            CreatedNode: {
              LedgerEntryType: 'Loan',
              LedgerIndex: 'LOAN_XYZ',
              NewFields: { LoanSeq: 42 }
            }
          }
        ]
      }
    }
    const out = extractCreatedLedgerIds(result)
    assert.equal(out.loanId, 'LOAN_XYZ')
    assert.equal(out.loanSeq, 42)
  })

  it('does not pick modified nodes for create IDs', () => {
    const result = {
      meta: {
        AffectedNodes: [
          {
            ModifiedNode: {
              LedgerEntryType: 'Vault',
              LedgerIndex: 'SHOULD_NOT_PICK'
            }
          },
          {
            CreatedNode: {
              LedgerEntryType: 'Vault',
              LedgerIndex: 'CORRECT_ONE'
            }
          }
        ]
      }
    }
    const out = extractCreatedLedgerIds(result)
    assert.equal(out.vaultId, 'CORRECT_ONE')
  })

  it('returns nulls for empty meta', () => {
    const out = extractCreatedLedgerIds({ meta: { AffectedNodes: [] } })
    assert.equal(out.vaultId, null)
    assert.equal(out.loanBrokerId, null)
    assert.equal(out.loanId, null)
  })

  it('returns nulls for null result', () => {
    const out = extractCreatedLedgerIds(null)
    assert.equal(out.vaultId, null)
  })

  it('handles mixed created and modified nodes', () => {
    const result = {
      meta: {
        AffectedNodes: [
          { ModifiedNode: { LedgerEntryType: 'AccountRoot', LedgerIndex: 'ACC1' } },
          { CreatedNode: { LedgerEntryType: 'Vault', LedgerIndex: 'V1' } },
          { ModifiedNode: { LedgerEntryType: 'DirectoryNode', LedgerIndex: 'DIR1' } },
          { CreatedNode: { LedgerEntryType: 'MPTokenIssuance', LedgerIndex: 'MPT1' } }
        ]
      }
    }
    const out = extractCreatedLedgerIds(result)
    assert.equal(out.vaultId, 'V1')
    assert.equal(out.loanBrokerId, null)
    assert.deepEqual(out.affectedTypes, ['AccountRoot', 'Vault', 'DirectoryNode', 'MPTokenIssuance'])
  })
})
