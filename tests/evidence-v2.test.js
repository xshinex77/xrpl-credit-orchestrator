import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  createEvidenceEvent, verifyChain, generateChainAnchor, buildAuditBundle
} from '../packages/evidence-sdk/src/index.js'

describe('命令7: evidence chain anchor and audit bundle', () => {
  function buildChain(n = 3) {
    const events = []
    let prevHash = null
    for (let i = 0; i < n; i++) {
      const e = createEvidenceEvent({
        aggregateType: 'loan',
        aggregateId: 'loan-001',
        eventType: `event_${i}`,
        payload: { actor: `user_${i}`, action: `step_${i}`, txHash: `hash_${i}` },
        prevHash
      })
      events.push(e)
      prevHash = e.payloadHash
    }
    return events
  }

  it('verifyChain returns ok:true and headHash for valid chain', () => {
    const events = buildChain(5)
    const result = verifyChain(events)
    assert.equal(result.ok, true)
    assert.equal(result.valid, true)
    assert.equal(result.chainLength, 5)
    assert.ok(result.headHash)
  })

  it('verifyChain detects tampering', () => {
    const events = buildChain(3)
    events[1].payload.actor = 'tampered'
    const result = verifyChain(events)
    assert.equal(result.ok, false)
    assert.equal(result.failedAt, 1)
  })

  it('generateChainAnchor produces anchor hash', () => {
    const events = buildChain(3)
    const anchor = generateChainAnchor(events)
    assert.equal(anchor.ok, true)
    assert.ok(anchor.anchorHash)
    assert.equal(anchor.chainLength, 3)
    assert.ok(anchor.anchoredAt)
  })

  it('generateChainAnchor fails on broken chain', () => {
    const events = buildChain(3)
    events[1].payloadHash = 'broken'
    const anchor = generateChainAnchor(events)
    assert.equal(anchor.ok, false)
  })

  it('buildAuditBundle produces complete export', () => {
    const events = buildChain(3)
    const bundle = buildAuditBundle({
      events,
      transactions: [{ txHash: 'tx1', txType: 'VaultCreate', resultCode: 'tesSUCCESS' }],
      outboxItems: [{ id: 'o1', kind: 'vault_create', status: 'reconciled' }],
      reconciliationRuns: [{ id: 'r1', outcome: 'ok' }]
    })
    assert.ok(bundle.generatedAt)
    assert.equal(bundle.chain.verify.ok, true)
    assert.equal(bundle.chain.anchor.ok, true)
    assert.equal(bundle.chain.eventCount, 3)
    assert.equal(bundle.timeline.length, 3)
    assert.equal(bundle.relatedTransactions.length, 1)
    assert.equal(bundle.outboxHistory.length, 1)
    assert.equal(bundle.reconciliationHistory.length, 1)
    assert.ok(bundle.operators.length >= 1)
    assert.ok(bundle.exportHash)
  })

  it('createEvidenceEvent includes _evidenceVersion 2.0', () => {
    const e = createEvidenceEvent({
      aggregateType: 'vault',
      aggregateId: 'v1',
      eventType: 'test',
      payload: { actor: 'user1', action: 'test' },
      prevHash: null
    })
    assert.equal(e.payload._evidenceVersion, '2.0')
  })

  it('createEvidenceEvent warns on missing actor', () => {
    const e = createEvidenceEvent({
      aggregateType: 'vault',
      aggregateId: 'v1',
      eventType: 'test',
      payload: { action: 'test' },
      prevHash: null
    })
    assert.ok(e.payload._warnings.includes('missing_actor'))
  })
})
