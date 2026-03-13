import { readJson } from './http/json.js'
import { createDatabase } from './db/index.js'
import { EvidenceService } from './services/evidence.service.js'
import { BorrowersService } from './services/borrowers.service.js'
import { LoansService } from './services/loans.service.js'
import { VaultsService } from './services/vaults.service.js'
import { AuditService } from './services/audit.service.js'

export async function createContext(config) {
  const db = await createDatabase(config)
  const evidence = new EvidenceService(db)
  return {
    config,
    db,
    evidence,
    readJson,
    services: {
      borrowers: new BorrowersService(db, evidence),
      loans: new LoansService(db, evidence),
      vaults: new VaultsService(db, evidence),
      audit: new AuditService(db, evidence)
    }
  }
}
