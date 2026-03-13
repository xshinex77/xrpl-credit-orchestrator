import test from 'node:test'
import assert from 'node:assert/strict'
import { MemoryDatabase } from '../apps/control-api/src/db/memory.js'
import { EvidenceService } from '../apps/control-api/src/services/evidence.service.js'
import { AuditService } from '../apps/control-api/src/services/audit.service.js'

test('audit export bundles aggregate, evidence, and outbox rows', async () => {
  const db = new MemoryDatabase({ devAdminUsername: 'admin', devAdminPassword: 'change-me' })
  const evidence = new EvidenceService(db)
  const audit = new AuditService(db, evidence)
  const vault = await db.createVault({ ownerAddress: 'rOwner', assetType: 'XRP', isPrivate: true })
  await db.enqueueTx({ kind: 'vault_create', aggregateType: 'vault', aggregateId: vault.id, txJson: { TransactionType: 'VaultCreate', Account: 'rOwner' } })
  await evidence.append('vault', vault.id, 'vault.created', { actor: 'test', action: 'create' })
  const bundle = await audit.exportAggregateBundle('vault', vault.id)
  assert.equal(bundle.aggregate.id, vault.id)
  assert.equal(bundle.chain.eventCount, 1)
  assert.equal(bundle.chain.verify.ok, true)
  assert.equal(bundle.outboxHistory.length, 1)
  assert.ok(bundle.timeline.length >= 1)
  assert.ok(bundle.exportHash)
})
