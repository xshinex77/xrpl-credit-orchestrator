import test from 'node:test'
import assert from 'node:assert/strict'
import { createEvidenceEvent, verifyChain } from '../packages/evidence-sdk/src/index.js'

test('evidence hash-chain verifies sequential events', () => {
  const a = createEvidenceEvent({
    aggregateType: 'loan',
    aggregateId: '11111111-1111-1111-1111-111111111111',
    eventType: 'loan.approved',
    payload: { principal: '1000' },
    prevHash: null
  })
  const b = createEvidenceEvent({
    aggregateType: 'loan',
    aggregateId: '11111111-1111-1111-1111-111111111111',
    eventType: 'loan.cosign_packet.created',
    payload: { signer: 'broker' },
    prevHash: a.payloadHash
  })
  assert.equal(verifyChain([a, b]).ok, true)
})

test('evidence hash-chain detects tampering', () => {
  const a = createEvidenceEvent({
    aggregateType: 'loan',
    aggregateId: '11111111-1111-1111-1111-111111111111',
    eventType: 'loan.approved',
    payload: { principal: '1000' },
    prevHash: null
  })
  const b = createEvidenceEvent({
    aggregateType: 'loan',
    aggregateId: '11111111-1111-1111-1111-111111111111',
    eventType: 'loan.cosign_packet.created',
    payload: { signer: 'broker' },
    prevHash: a.payloadHash
  })
  b.payload.signer = 'attacker'
  assert.equal(verifyChain([a, b]).ok, false)
})
