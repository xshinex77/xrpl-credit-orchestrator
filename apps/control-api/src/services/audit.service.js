import { buildAuditBundle, verifyChain, generateChainAnchor } from '../../../../packages/evidence-sdk/src/index.js'

export class AuditService {
  constructor(db, evidence) {
    this.db = db
    this.evidence = evidence
  }

  async exportAggregateBundle(aggregateType, aggregateId) {
    const [events, outboxItems, transactions, reconciliationRuns, aggregate] = await Promise.all([
      this.evidence.list(aggregateType, aggregateId),
      this.db.listOutboxByAggregate(aggregateType, aggregateId),
      this.db.listTransactionsByAggregate?.(aggregateType, aggregateId) ?? [],
      this.db.listReconciliationRuns?.(50) ?? [],
      this.resolveAggregate(aggregateType, aggregateId)
    ])

    // Filter reconciliation runs to this aggregate
    const relevantRecons = reconciliationRuns.filter(r =>
      r.targetType === aggregateType && r.targetId === aggregateId
    )

    // 命令7: build full audit bundle with chain verification
    const bundle = buildAuditBundle({
      events,
      transactions,
      outboxItems,
      reconciliationRuns: relevantRecons
    })

    return {
      ...bundle,
      aggregate,
      aggregateType,
      aggregateId
    }
  }

  async resolveAggregate(aggregateType, aggregateId) {
    if (aggregateType === 'vault') return this.db.getVault(aggregateId)
    if (aggregateType === 'loan_broker') return this.db.getLoanBroker(aggregateId)
    if (aggregateType === 'loan') return this.db.getLoan(aggregateId)
    return null
  }

  async getChainAnchor(aggregateType, aggregateId) {
    const events = await this.evidence.list(aggregateType, aggregateId)
    return generateChainAnchor(events)
  }

  async verifyChain(aggregateType, aggregateId) {
    const events = await this.evidence.list(aggregateType, aggregateId)
    return verifyChain(events)
  }
}
