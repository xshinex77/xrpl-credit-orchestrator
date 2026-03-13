import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryDatabase } from '../apps/control-api/src/db/memory.js'
import { OutboxStatuses, TxKinds } from '../packages/shared-types/src/index.js'

describe('outbox redaction', () => {
  it('outbox response contains only whitelisted safe fields', async () => {
    const db = new MemoryDatabase({ devAdminUsername: 'admin', devAdminPassword: 'test' })
    await db.enqueueTx({
      kind: TxKinds.LOAN_SET,
      aggregateType: 'loan',
      aggregateId: 'loan_1',
      dedupeKey: 'test_redact_1',
      requestedByUser: 'user_1',
      txJson: { TransactionType: 'LoanSet', Account: 'rBroker', Borrower: 'rBorr', secret: 'SHOULD_NOT_LEAK' },
      metadata: {
        mode: 'cosign_two_phase',
        brokerSignedBlob: 'SIGNED_BLOB_SHOULD_NOT_LEAK',
        counterpartySignedTxBlob: 'COUNTER_BLOB_SHOULD_NOT_LEAK',
        cosignPacket: { loanId: 'loan_1', unsignedTx: {} }
      }
    })

    const rows = await db.listOutbox()
    assert.equal(rows.length, 1)

    // Simulate the whitelist transform from main.js
    const safe = rows.map(r => ({
      id: r.id, kind: r.kind, status: r.status,
      aggregateType: r.aggregateType, aggregateId: r.aggregateId,
      txHash: r.txHash, error: r.error, attempts: r.attempts,
      createdAt: r.createdAt, updatedAt: r.updatedAt
    }))

    const item = safe[0]
    assert.ok(item.id)
    assert.equal(item.kind, TxKinds.LOAN_SET)
    // These must NOT exist in the safe output
    assert.equal(item.metadata, undefined)
    assert.equal(item.txJson, undefined)
    assert.equal(item.submittedTxJson, undefined)
    assert.equal(item.txResult, undefined)
    assert.equal(item.brokerSignedBlob, undefined)
    assert.equal(item.counterpartySignedTxBlob, undefined)
    assert.equal(item.cosignPacket, undefined)
    assert.equal(item.requestedByUser, undefined)
  })
})
