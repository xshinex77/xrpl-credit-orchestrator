import { randomUUID } from 'node:crypto'
import { createEvidenceEvent } from '../../../../packages/evidence-sdk/src/index.js'
import { OutboxStatuses, Roles } from '../../../../packages/shared-types/src/index.js'
import { hashPassword } from '../http/auth.js'

export class MemoryDatabase {
  constructor(config) {
    this.config = config
    this.state = {
      users: [],
      parties: [],
      vaults: [],
      vaultPositions: [],
      loanBrokers: [],
      firstLossCoverLedger: [],
      loans: [],
      evidence: [],
      outbox: [],
      checkpoints: {},
      reconciliations: [],
      transactions: []
    }
    this.seedUsers()
  }

  seedUsers() {
    if (this.state.users.length > 0) return
    const seeds = [
      { username: this.config.devAdminUsername, passwordHash: hashPassword(this.config.devAdminPassword), role: Roles.PLATFORM_ADMIN },
      { username: 'risk_ops', passwordHash: hashPassword('risk_ops'), role: Roles.RISK_OPERATOR },
      { username: 'ledger_ops', passwordHash: hashPassword('ledger_ops'), role: Roles.LEDGER_OPERATOR },
      { username: 'auditor', passwordHash: hashPassword('auditor'), role: Roles.AUDITOR },
      { username: 'lender', passwordHash: hashPassword('lender'), role: Roles.LENDER },
      { username: 'borrower', passwordHash: hashPassword('borrower'), role: Roles.BORROWER }
    ]
    for (const user of seeds) {
      this.state.users.push({
        id: randomUUID(), username: user.username, passwordHash: user.passwordHash,
        role: user.role, isActive: true, createdAt: new Date().toISOString()
      })
    }
  }

  async health() { return { mode: 'memory', ok: true } }
  async findUserByUsername(username) { return this.state.users.find((x) => x.username === username) ?? null }

  async createBorrower(input) {
    const row = {
      id: randomUUID(), authUserId: input.authUserId ?? null,
      role: 'borrower', legalName: input.legalName,
      countryCode: input.countryCode ?? null, status: 'pending_kyc',
      xrplAddress: input.xrplAddress ?? null, createdAt: new Date().toISOString()
    }
    this.state.parties.push(row)
    return row
  }

  async findPartyByAuthUserId(authUserId) {
    return this.state.parties.find((x) => x.authUserId === authUserId) ?? null
  }

  async listBorrowers() { return this.state.parties.filter((x) => x.role === 'borrower') }

  async createVault(input) {
    const row = {
      id: randomUUID(), xrplVaultId: null, ownerAddress: input.ownerAddress,
      assetType: input.assetType, assetCode: input.assetCode ?? null,
      issuerAddress: input.issuerAddress ?? null, assetMptIssuanceId: input.assetMptIssuanceId ?? null,
      isPrivate: Boolean(input.isPrivate), permissionedDomainId: input.permissionedDomainId ?? null,
      status: 'queued', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    }
    this.state.vaults.push(row)
    return row
  }

  async listVaults() { return [...this.state.vaults] }
  async getVault(id) { return this.state.vaults.find((x) => x.id === id) ?? null }
  async updateVault(id, patch) {
    const row = await this.getVault(id); if (!row) return null
    Object.assign(row, patch, { updatedAt: new Date().toISOString() }); return row
  }

  async upsertVaultPosition(input) {
    let row = this.state.vaultPositions.find((x) => x.vaultId === input.vaultId && x.lenderAddress === input.lenderAddress)
    if (!row) {
      row = {
        id: randomUUID(), vaultId: input.vaultId, lenderPartyId: input.lenderPartyId ?? null,
        lenderAddress: input.lenderAddress ?? null, sharesNumeric: '0', depositedAmount: '0', withdrawnAmount: '0',
        updatedAt: new Date().toISOString()
      }
      this.state.vaultPositions.push(row)
    }
    if (input.depositedAmount !== undefined) row.depositedAmount = String(input.depositedAmount)
    if (input.withdrawnAmount !== undefined) row.withdrawnAmount = String(input.withdrawnAmount)
    if (input.sharesNumeric !== undefined) row.sharesNumeric = String(input.sharesNumeric)
    row.updatedAt = new Date().toISOString()
    return row
  }

  async listVaultPositions() { return [...this.state.vaultPositions] }

  async createLoanBroker(input) {
    const row = {
      id: randomUUID(), xrplLoanBrokerId: null, vaultId: input.vaultId, ownerAddress: input.ownerAddress,
      managementFeeRate: input.managementFeeRate ?? 0, debtMaximum: String(input.debtMaximum ?? '0'),
      coverRateMinimum: input.coverRateMinimum ?? 0, coverRateLiquidation: input.coverRateLiquidation ?? 0,
      status: 'queued', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    }
    this.state.loanBrokers.push(row)
    return row
  }

  async listLoanBrokers() { return [...this.state.loanBrokers] }
  async getLoanBroker(id) { return this.state.loanBrokers.find((x) => x.id === id) ?? null }
  async updateLoanBroker(id, patch) {
    const row = await this.getLoanBroker(id); if (!row) return null
    Object.assign(row, patch, { updatedAt: new Date().toISOString() }); return row
  }

  async appendCoverLedger(input) {
    const row = { id: randomUUID(), createdAt: new Date().toISOString(), ...input }
    this.state.firstLossCoverLedger.push(row)
    return row
  }

  async createLoan(input) {
    const row = {
      id: randomUUID(), applicationId: input.applicationId ?? null, xrplLoanId: null, xrplLoanSeq: null,
      loanBrokerId: input.loanBrokerId, borrowerPartyId: input.borrowerPartyId,
      borrowerAddress: input.borrowerAddress, principal: String(input.principal),
      interestRate: input.interestRate, paymentTotal: input.paymentTotal,
      paymentInterval: input.paymentInterval, gracePeriod: input.gracePeriod,
      loanOriginationFee: String(input.loanOriginationFee ?? '0'), loanServiceFee: String(input.loanServiceFee ?? '0'),
      status: 'approved', cosignPacket: null, partiallySignedTxJson: null,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    }
    this.state.loans.push(row)
    return row
  }

  async listLoans() { return [...this.state.loans] }
  async getLoan(id) { return this.state.loans.find((x) => x.id === id) ?? null }
  async updateLoan(id, patch) {
    const row = await this.getLoan(id); if (!row) return null
    Object.assign(row, patch, { updatedAt: new Date().toISOString() }); return row
  }

  async appendEvidence(aggregateType, aggregateId, eventType, payload) {
    const scope = `${aggregateType}:${aggregateId}`
    const scopeEvents = this.state.evidence.filter((e) => e.chainScope === scope)
    const prevHash = scopeEvents.length ? scopeEvents[scopeEvents.length - 1].payloadHash : null
    const event = createEvidenceEvent({ aggregateType, aggregateId, eventType, payload, prevHash })
    const stored = { id: randomUUID(), createdAt: new Date().toISOString(), ...event }
    this.state.evidence.push(stored)
    return stored
  }

  async getEvidence(aggregateType, aggregateId) {
    return this.state.evidence.filter((x) => x.aggregateType === aggregateType && x.aggregateId === aggregateId)
  }

  async enqueueTx(input) {
    // Dedupe enforcement: if dedupeKey provided, reject duplicate for non-terminal outbox
    const dedupeKey = input.dedupeKey ?? null
    if (dedupeKey) {
      const terminalStatuses = [OutboxStatuses.VALIDATED, OutboxStatuses.INDEXED, OutboxStatuses.FAILED, OutboxStatuses.CLOSED]
      const existing = this.state.outbox.find(
        o => o.dedupeKey === dedupeKey && !terminalStatuses.includes(o.status)
      )
      if (existing) {
        throw new Error(`duplicate_outbox: dedupeKey=${dedupeKey} already exists (outbox=${existing.id}, status=${existing.status})`)
      }
    }

    const row = {
      id: randomUUID(), kind: input.kind, status: OutboxStatuses.PENDING,
      aggregateType: input.aggregateType, aggregateId: input.aggregateId,
      requestedByUser: input.requestedByUser ?? null, dedupeKey,
      txJson: input.txJson, submittedTxJson: null, txHash: null, txResult: null,
      metadata: input.metadata ?? {}, error: null, attempts: 0,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    }
    this.state.outbox.push(row)
    return row
  }

  async claimPendingOutbox(limit = 10) {
    const claimable = [OutboxStatuses.PENDING, OutboxStatuses.SIGNED_2]
    const rows = this.state.outbox.filter((x) => claimable.includes(x.status)).slice(0, limit)
    for (const row of rows) {
      row.status = OutboxStatuses.PROCESSING
      row.attempts += 1
      row.updatedAt = new Date().toISOString()
    }
    return rows
  }

  async updateOutbox(id, patch) {
    const row = this.state.outbox.find((x) => x.id === id)
    if (!row) return null
    Object.assign(row, patch, { updatedAt: new Date().toISOString() })
    return row
  }

  async getOutboxById(id) { return this.state.outbox.find((x) => x.id === id) ?? null }
  async listOutbox(status = null) { return this.state.outbox.filter((x) => status ? x.status === status : true) }
  async listOutboxByAggregate(aggregateType, aggregateId) { return this.state.outbox.filter((x) => x.aggregateType === aggregateType && x.aggregateId === aggregateId) }

  async listTransactionsByAggregate(aggregateType, aggregateId) {
    const ids = new Set(this.state.outbox.filter((x) => x.aggregateType === aggregateType && x.aggregateId === aggregateId).map((x) => x.txHash).filter(Boolean))
    return this.state.transactions.filter((x) => ids.has(x.txHash))
  }

  async listOutboxNeedingIndex(limit = 20) {
    return this.state.outbox.filter((x) => [OutboxStatuses.SUBMITTED, OutboxStatuses.VALIDATED].includes(x.status)).slice(0, limit)
  }
  async listOutboxForReconciliation(limit = 20) {
    return this.state.outbox.filter((x) => [OutboxStatuses.VALIDATED, OutboxStatuses.INDEXED, OutboxStatuses.PREPARED].includes(x.status)).slice(0, limit)
  }

  async recordTransaction(tx) {
    const existing = this.state.transactions.find((x) => x.txHash === tx.txHash)
    if (existing) Object.assign(existing, tx)
    else this.state.transactions.push({ observedAt: new Date().toISOString(), ...tx })
  }
  async getTransactionByHash(hash) { return this.state.transactions.find((x) => x.txHash === hash) ?? null }
  async listTransactions(limit = 50) { return [...this.state.transactions].slice(-limit).reverse() }

  async saveCheckpoint(name, ledgerIndex) {
    this.state.checkpoints[name] = { lastValidatedLedger: ledgerIndex, updatedAt: new Date().toISOString() }
    return this.state.checkpoints[name]
  }
  async getCheckpoint(name) { return this.state.checkpoints[name] ?? null }

  async saveReconciliationRun(row) {
    const stored = { id: randomUUID(), createdAt: new Date().toISOString(), ...row }
    this.state.reconciliations.push(stored)
    return stored
  }
  async listReconciliationRuns(limit = 50) { return [...this.state.reconciliations].slice(-limit).reverse() }

  async getDashboardSummary() {
    const statusCounts = (rows, key='status') => rows.reduce((acc, row) => {
      acc[row[key]] = (acc[row[key]] ?? 0) + 1
      return acc
    }, {})
    return {
      counts: {
        borrowers: this.state.parties.filter((x) => x.role === 'borrower').length,
        vaults: this.state.vaults.length,
        loanBrokers: this.state.loanBrokers.length,
        loans: this.state.loans.length,
        outbox: this.state.outbox.length,
        transactions: this.state.transactions.length
      },
      statuses: {
        vaults: statusCounts(this.state.vaults),
        loanBrokers: statusCounts(this.state.loanBrokers),
        loans: statusCounts(this.state.loans),
        outbox: statusCounts(this.state.outbox)
      },
      checkpoints: this.state.checkpoints
    }
  }

  // ── Sequence coordination (memory-backed) ──
  #sequences = new Map()

  async reserveAccountSequence(account, fetchFromLedger) {
    let current = this.#sequences.get(account)
    if (current === undefined) {
      const seq = await fetchFromLedger(null)
      this.#sequences.set(account, seq + 1)
      return seq
    }
    const seq = current
    this.#sequences.set(account, seq + 1)
    return seq
  }

  async forgetAccountSequence(account) {
    this.#sequences.delete(account)
  }
}
