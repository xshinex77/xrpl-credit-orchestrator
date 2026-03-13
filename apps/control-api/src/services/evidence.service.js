export class EvidenceService {
  constructor(db) {
    this.db = db
  }

  append(aggregateType, aggregateId, eventType, payload) {
    return this.db.appendEvidence(aggregateType, aggregateId, eventType, payload)
  }

  list(aggregateType, aggregateId) {
    return this.db.getEvidence(aggregateType, aggregateId)
  }
}
