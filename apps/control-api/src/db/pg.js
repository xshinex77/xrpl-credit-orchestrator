import { createEvidenceEvent } from '../../../../packages/evidence-sdk/src/index.js'
import { hashPassword } from '../http/auth.js'
import { OutboxStatuses } from '../../../../packages/shared-types/src/index.js'

function jsonable(value) {
  return typeof value === 'object' && value !== null ? JSON.stringify(value) : value
}

function buildPatch(patch, columnMap) {
  const fields = []
  const values = []
  let idx = 1
  for (const [key, value] of Object.entries(patch)) {
    const column = columnMap[key]
    if (!column) continue
    fields.push(`${column} = $${idx++}`)
    values.push(jsonable(value))
  }
  return { fields, values, nextIndex: idx }
}

export class PgDatabase {
  constructor(config, pool) {
    this.config = config
    this.pool = pool
  }

  static async create(config) {
    const { Pool } = await import('pg')
    const pool = new Pool({ connectionString: config.databaseUrl })
    const db = new PgDatabase(config, pool)
    await db.seedUsers()
    return db
  }

  async query(text, values = []) { return this.pool.query(text, values) }
  async health() { await this.query('select 1'); return { mode: 'postgres', ok: true } }

  async seedUsers() {
    const users = [
      [this.config.devAdminUsername, hashPassword(this.config.devAdminPassword), 'platform_admin'],
      ['risk_ops', hashPassword('risk_ops'), 'risk_operator'],
      ['ledger_ops', hashPassword('ledger_ops'), 'ledger_operator'],
      ['auditor', hashPassword('auditor'), 'auditor'],
      ['lender', hashPassword('lender'), 'lender'],
      ['borrower', hashPassword('borrower'), 'borrower']
    ]
    for (const [username, passwordHash, role] of users) {
      await this.query(`insert into auth_users (username, password_hash, role)
        values ($1,$2,$3) on conflict (username) do nothing`, [username, passwordHash, role])
    }
  }

  async findUserByUsername(username) {
    const { rows } = await this.query(
      `select id, username, password_hash as "passwordHash", role, is_active as "isActive", created_at as "createdAt"
       from auth_users where username = $1`, [username]
    )
    return rows[0] ?? null
  }

  async createBorrower(input) {
    const { rows } = await this.query(
      `insert into parties (role, legal_name, country_code, auth_user_id, status)
       values ('borrower',$1,$2,$3,'pending_kyc')
       returning id, role, legal_name as "legalName", country_code as "countryCode", auth_user_id as "authUserId", status, created_at as "createdAt"`,
      [input.legalName, input.countryCode ?? null, input.authUserId ?? null]
    )
    const borrower = rows[0]
    if (input.xrplAddress) {
      await this.query(`insert into party_wallets (party_id, xrpl_address, wallet_type, is_primary)
        values ($1,$2,'external',true)`, [borrower.id, input.xrplAddress])
      borrower.xrplAddress = input.xrplAddress
    } else borrower.xrplAddress = null
    return borrower
  }

  async listBorrowers() {
    const { rows } = await this.query(
      `select p.id, p.role, p.legal_name as "legalName", p.country_code as "countryCode", p.status, p.created_at as "createdAt",
              w.xrpl_address as "xrplAddress"
       from parties p
       left join party_wallets w on w.party_id = p.id and w.is_primary = true
       where p.role = 'borrower'
       order by p.created_at desc`
    )
    return rows
  }

  async createVault(input) {
    const { rows } = await this.query(
      `insert into vaults (owner_address, asset_type, asset_code, issuer_address, asset_mpt_issuance_id, is_private, permissioned_domain_id, status)
       values ($1,$2,$3,$4,$5,$6,$7,'queued')
       returning id, xrpl_vault_id as "xrplVaultId", owner_address as "ownerAddress", asset_type as "assetType",
                 asset_code as "assetCode", issuer_address as "issuerAddress", asset_mpt_issuance_id as "assetMptIssuanceId",
                 is_private as "isPrivate", permissioned_domain_id as "permissionedDomainId", status,
                 created_at as "createdAt", updated_at as "updatedAt"`,
      [input.ownerAddress, input.assetType, input.assetCode ?? null, input.issuerAddress ?? null,
        input.assetMptIssuanceId ?? null, Boolean(input.isPrivate), input.permissionedDomainId ?? null]
    )
    return rows[0]
  }

  async listVaults() {
    const { rows } = await this.query(
      `select id, xrpl_vault_id as "xrplVaultId", owner_address as "ownerAddress", asset_type as "assetType", asset_code as "assetCode",
              issuer_address as "issuerAddress", asset_mpt_issuance_id as "assetMptIssuanceId", is_private as "isPrivate",
              permissioned_domain_id as "permissionedDomainId", status, created_at as "createdAt", updated_at as "updatedAt"
       from vaults order by created_at desc`
    )
    return rows
  }

  async getVault(id) {
    const { rows } = await this.query(
      `select id, xrpl_vault_id as "xrplVaultId", owner_address as "ownerAddress", asset_type as "assetType", asset_code as "assetCode",
              issuer_address as "issuerAddress", asset_mpt_issuance_id as "assetMptIssuanceId", is_private as "isPrivate",
              permissioned_domain_id as "permissionedDomainId", status, created_at as "createdAt", updated_at as "updatedAt"
       from vaults where id = $1`, [id]
    )
    return rows[0] ?? null
  }

  async updateVault(id, patch) {
    const { fields, values, nextIndex } = buildPatch(patch, {
      xrplVaultId: 'xrpl_vault_id', status: 'status', permissionedDomainId: 'permissioned_domain_id'
    })
    if (!fields.length) return this.getVault(id)
    values.push(id)
    await this.query(`update vaults set ${fields.join(', ')}, updated_at = now() where id = $${nextIndex}`, values)
    return this.getVault(id)
  }

  async upsertVaultPosition(input) {
    const { rows } = await this.query(
      `insert into vault_positions (vault_id, lender_party_id, lender_address, shares_numeric, deposited_amount, withdrawn_amount)
       values ($1,$2,$3,$4,$5,$6)
       on conflict (vault_id, lender_address) do update
       set shares_numeric = excluded.shares_numeric,
           deposited_amount = excluded.deposited_amount,
           withdrawn_amount = excluded.withdrawn_amount,
           updated_at = now()
       returning id, vault_id as "vaultId", lender_party_id as "lenderPartyId", lender_address as "lenderAddress",
                 shares_numeric as "sharesNumeric", deposited_amount as "depositedAmount", withdrawn_amount as "withdrawnAmount",
                 updated_at as "updatedAt"`,
      [input.vaultId, input.lenderPartyId ?? null, input.lenderAddress ?? null,
        String(input.sharesNumeric ?? '0'), String(input.depositedAmount ?? '0'), String(input.withdrawnAmount ?? '0')]
    )
    return rows[0]
  }

  async listVaultPositions() {
    const { rows } = await this.query(
      `select id, vault_id as "vaultId", lender_party_id as "lenderPartyId", lender_address as "lenderAddress",
              shares_numeric as "sharesNumeric", deposited_amount as "depositedAmount", withdrawn_amount as "withdrawnAmount",
              updated_at as "updatedAt"
       from vault_positions order by updated_at desc`
    )
    return rows
  }

  async findPartyByAuthUserId(authUserId) {
    const { rows } = await this.query(
      `select id, auth_user_id as "authUserId", role, legal_name as "legalName",
              country_code as "countryCode", status, created_at as "createdAt"
       from parties where auth_user_id = $1 limit 1`, [authUserId]
    )
    return rows[0] ?? null
  }

  async updateParty(partyId, patch) {
    if (patch.authUserId !== undefined) {
      await this.query(`update parties set auth_user_id = $1 where id = $2`, [patch.authUserId, partyId])
    }
  }

  async createLoanBroker(input) {
    const { rows } = await this.query(
      `insert into loan_brokers (vault_id, owner_address, management_fee_rate_ppm, debt_maximum, cover_rate_minimum_ppm, cover_rate_liquidation_ppm, status)
       values ($1,$2,$3,$4,$5,$6,'queued')
       returning id, xrpl_loan_broker_id as "xrplLoanBrokerId", vault_id as "vaultId", owner_address as "ownerAddress",
                 management_fee_rate_ppm as "managementFeeRate", debt_maximum as "debtMaximum",
                 cover_rate_minimum_ppm as "coverRateMinimum", cover_rate_liquidation_ppm as "coverRateLiquidation",
                 status, created_at as "createdAt", updated_at as "updatedAt"`,
      [input.vaultId, input.ownerAddress, input.managementFeeRate ?? 0, String(input.debtMaximum ?? '0'),
        input.coverRateMinimum ?? 0, input.coverRateLiquidation ?? 0]
    )
    return rows[0]
  }

  async listLoanBrokers() {
    const { rows } = await this.query(
      `select id, xrpl_loan_broker_id as "xrplLoanBrokerId", vault_id as "vaultId", owner_address as "ownerAddress",
              management_fee_rate_ppm as "managementFeeRate", debt_maximum as "debtMaximum",
              cover_rate_minimum_ppm as "coverRateMinimum", cover_rate_liquidation_ppm as "coverRateLiquidation",
              status, created_at as "createdAt", updated_at as "updatedAt"
       from loan_brokers order by created_at desc`
    )
    return rows
  }

  async getLoanBroker(id) {
    const { rows } = await this.query(
      `select id, xrpl_loan_broker_id as "xrplLoanBrokerId", vault_id as "vaultId", owner_address as "ownerAddress",
              management_fee_rate_ppm as "managementFeeRate", debt_maximum as "debtMaximum",
              cover_rate_minimum_ppm as "coverRateMinimum", cover_rate_liquidation_ppm as "coverRateLiquidation",
              status, created_at as "createdAt", updated_at as "updatedAt"
       from loan_brokers where id = $1`, [id]
    )
    return rows[0] ?? null
  }

  async updateLoanBroker(id, patch) {
    const { fields, values, nextIndex } = buildPatch(patch, {
      xrplLoanBrokerId: 'xrpl_loan_broker_id', status: 'status'
    })
    if (!fields.length) return this.getLoanBroker(id)
    values.push(id)
    await this.query(`update loan_brokers set ${fields.join(', ')}, updated_at = now() where id = $${nextIndex}`, values)
    return this.getLoanBroker(id)
  }

  async appendCoverLedger(input) {
    const { rows } = await this.query(
      `insert into first_loss_cover_ledger (loan_broker_id, entry_type, amount, asset_ref, xrpl_tx_hash)
       values ($1,$2,$3,$4,$5)
       returning id, loan_broker_id as "loanBrokerId", entry_type as "entryType", amount, asset_ref as "assetRef", xrpl_tx_hash as "xrplTxHash", created_at as "createdAt"`,
      [input.loanBrokerId, input.entryType, String(input.amount), input.assetRef, input.xrplTxHash ?? null]
    )
    return rows[0]
  }

  async createLoan(input) {
    const { rows } = await this.query(
      `insert into loans (application_id, loan_broker_id, borrower_party_id, borrower_address, principal, interest_rate_ppm, payment_total, payment_interval_seconds, grace_period_seconds, loan_origination_fee, loan_service_fee, status)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'approved')
       returning id, application_id as "applicationId", xrpl_loan_id as "xrplLoanId", xrpl_loan_seq as "xrplLoanSeq",
                 loan_broker_id as "loanBrokerId", borrower_party_id as "borrowerPartyId", borrower_address as "borrowerAddress",
                 principal, interest_rate_ppm as "interestRate", payment_total as "paymentTotal", payment_interval_seconds as "paymentInterval",
                 grace_period_seconds as "gracePeriod", loan_origination_fee as "loanOriginationFee", loan_service_fee as "loanServiceFee",
                 status, cosign_packet_json as "cosignPacket", partially_signed_tx_json as "partiallySignedTxJson",
                 created_at as "createdAt", updated_at as "updatedAt"`,
      [input.applicationId ?? null, input.loanBrokerId, input.borrowerPartyId, input.borrowerAddress, String(input.principal),
        input.interestRate, input.paymentTotal, input.paymentInterval, input.gracePeriod,
        String(input.loanOriginationFee ?? '0'), String(input.loanServiceFee ?? '0')]
    )
    return rows[0]
  }

  async listLoans() {
    const { rows } = await this.query(
      `select id, application_id as "applicationId", xrpl_loan_id as "xrplLoanId", xrpl_loan_seq as "xrplLoanSeq",
              loan_broker_id as "loanBrokerId", borrower_party_id as "borrowerPartyId", borrower_address as "borrowerAddress",
              principal, interest_rate_ppm as "interestRate", payment_total as "paymentTotal", payment_interval_seconds as "paymentInterval",
              grace_period_seconds as "gracePeriod", loan_origination_fee as "loanOriginationFee", loan_service_fee as "loanServiceFee",
              status, cosign_packet_json as "cosignPacket", partially_signed_tx_json as "partiallySignedTxJson",
              created_at as "createdAt", updated_at as "updatedAt"
       from loans order by created_at desc`
    )
    return rows
  }

  async getLoan(id) {
    const { rows } = await this.query(
      `select id, application_id as "applicationId", xrpl_loan_id as "xrplLoanId", xrpl_loan_seq as "xrplLoanSeq",
              loan_broker_id as "loanBrokerId", borrower_party_id as "borrowerPartyId", borrower_address as "borrowerAddress",
              principal, interest_rate_ppm as "interestRate", payment_total as "paymentTotal", payment_interval_seconds as "paymentInterval",
              grace_period_seconds as "gracePeriod", loan_origination_fee as "loanOriginationFee", loan_service_fee as "loanServiceFee",
              status, cosign_packet_json as "cosignPacket", partially_signed_tx_json as "partiallySignedTxJson",
              created_at as "createdAt", updated_at as "updatedAt"
       from loans where id = $1`, [id]
    )
    return rows[0] ?? null
  }

  async updateLoan(id, patch) {
    const { fields, values, nextIndex } = buildPatch(patch, {
      status: 'status', xrplLoanId: 'xrpl_loan_id', xrplLoanSeq: 'xrpl_loan_seq', cosignPacket: 'cosign_packet_json',
      partiallySignedTxJson: 'partially_signed_tx_json', dueAt: 'due_at', impairedAt: 'impaired_at', defaultedAt: 'defaulted_at'
    })
    if (!fields.length) return this.getLoan(id)
    values.push(id)
    await this.query(`update loans set ${fields.join(', ')}, updated_at = now() where id = $${nextIndex}`, values)
    return this.getLoan(id)
  }

  async appendEvidence(aggregateType, aggregateId, eventType, payload) {
    const chainScope = `${aggregateType}:${aggregateId}`
    const { rows: prevRows } = await this.query(
      `select payload_hash as "payloadHash" from evidence_events where chain_scope = $1 order by created_at desc limit 1`, [chainScope]
    )
    const prevHash = prevRows[0]?.payloadHash ?? null
    const event = createEvidenceEvent({ aggregateType, aggregateId, eventType, payload, prevHash })
    const { rows } = await this.query(
      `insert into evidence_events (chain_scope, aggregate_type, aggregate_id, event_type, payload, payload_hash, prev_hash)
       values ($1,$2,$3,$4,$5::jsonb,$6,$7)
       returning id, chain_scope as "chainScope", aggregate_type as "aggregateType", aggregate_id as "aggregateId",
                 event_type as "eventType", payload, payload_hash as "payloadHash", prev_hash as "prevHash", created_at as "createdAt"`,
      [event.chainScope, aggregateType, aggregateId, eventType, JSON.stringify(payload), event.payloadHash, event.prevHash]
    )
    return rows[0]
  }

  async getEvidence(aggregateType, aggregateId) {
    const { rows } = await this.query(
      `select id, chain_scope as "chainScope", aggregate_type as "aggregateType", aggregate_id as "aggregateId",
              event_type as "eventType", payload, payload_hash as "payloadHash", prev_hash as "prevHash", created_at as "createdAt"
       from evidence_events where aggregate_type = $1 and aggregate_id = $2 order by created_at asc`,
      [aggregateType, aggregateId]
    )
    return rows
  }

  async enqueueTx(input) {
    const dedupeKey = input.dedupeKey ?? null

    // Dedupe enforcement: check for non-terminal outbox with same key
    if (dedupeKey) {
      const { rows: existing } = await this.query(
        `select id, status from tx_outbox
         where dedupe_key = $1 and status not in ('validated','indexed','failed','closed')
         limit 1`,
        [dedupeKey]
      )
      if (existing.length > 0) {
        throw new Error(`duplicate_outbox: dedupeKey=${dedupeKey} already exists (outbox=${existing[0].id}, status=${existing[0].status})`)
      }
    }

    const { rows } = await this.query(
      `insert into tx_outbox (kind, status, aggregate_type, aggregate_id, requested_by_user, tx_json, metadata, dedupe_key)
       values ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8)
       returning id, kind, status, aggregate_type as "aggregateType", aggregate_id as "aggregateId", requested_by_user as "requestedByUser",
                 tx_json as "txJson", submitted_tx_json as "submittedTxJson", tx_hash as "txHash", tx_result_json as "txResult", metadata,
                 error_text as error, attempts, dedupe_key as "dedupeKey", created_at as "createdAt", updated_at as "updatedAt"`,
      [input.kind, OutboxStatuses.PENDING, input.aggregateType, input.aggregateId, input.requestedByUser ?? null, JSON.stringify(input.txJson), JSON.stringify(input.metadata ?? {}), dedupeKey]
    )
    return rows[0]
  }

  async claimPendingOutbox(limit = 10) {
    const claimable = [OutboxStatuses.PENDING, OutboxStatuses.SIGNED_2]
    const { rows } = await this.query(
      `with claimed as (
         select id from tx_outbox
         where status = any($1::text[])
         order by created_at asc
         limit $2
         for update skip locked
       )
       update tx_outbox t
       set status = $3, attempts = attempts + 1, updated_at = now()
       from claimed
       where t.id = claimed.id
       returning t.id, t.kind, t.status, t.aggregate_type as "aggregateType", t.aggregate_id as "aggregateId",
                 t.requested_by_user as "requestedByUser", t.tx_json as "txJson", t.submitted_tx_json as "submittedTxJson",
                 t.tx_hash as "txHash", t.tx_result_json as "txResult", t.metadata, t.error_text as error,
                 t.attempts, t.created_at as "createdAt", t.updated_at as "updatedAt"`,
      [claimable, limit, OutboxStatuses.PROCESSING]
    )
    return rows
  }

  async updateOutbox(id, patch) {
    const { fields, values, nextIndex } = buildPatch(patch, {
      status: 'status', submittedTxJson: 'submitted_tx_json', txHash: 'tx_hash', txResult: 'tx_result_json', error: 'error_text', metadata: 'metadata'
    })
    if (!fields.length) return this.getOutboxById(id)
    values.push(id)
    await this.query(`update tx_outbox set ${fields.join(', ')}, updated_at = now() where id = $${nextIndex}`, values)
    return this.getOutboxById(id)
  }

  async getOutboxById(id) {
    const { rows } = await this.query(
      `select id, kind, status, aggregate_type as "aggregateType", aggregate_id as "aggregateId", requested_by_user as "requestedByUser",
              tx_json as "txJson", submitted_tx_json as "submittedTxJson", tx_hash as "txHash", tx_result_json as "txResult", metadata,
              error_text as error, attempts, created_at as "createdAt", updated_at as "updatedAt"
       from tx_outbox where id = $1`, [id]
    )
    return rows[0] ?? null
  }

  async listOutboxByAggregate(aggregateType, aggregateId) {
    const { rows } = await this.query(
      `select id, kind, status, aggregate_type as "aggregateType", aggregate_id as "aggregateId", requested_by_user as "requestedByUser",
              tx_json as "txJson", submitted_tx_json as "submittedTxJson", tx_hash as "txHash", tx_result_json as "txResult", metadata,
              error_text as error, attempts, created_at as "createdAt", updated_at as "updatedAt"
       from tx_outbox where aggregate_type = $1 and aggregate_id = $2 order by created_at asc`, [aggregateType, aggregateId]
    )
    return rows
  }

  async listTransactionsByAggregate(aggregateType, aggregateId) {
    const { rows } = await this.query(
      `select x.tx_hash as "txHash", x.tx_type as "txType", x.ledger_index as "ledgerIndex", x.result_code as "resultCode", x.account, x.counterparty,
              x.observed_at as "observedAt", x.raw_json as "rawJson"
       from xrpl_transactions x
       join tx_outbox o on o.tx_hash = x.tx_hash
       where o.aggregate_type = $1 and o.aggregate_id = $2
       order by x.observed_at asc`, [aggregateType, aggregateId]
    )
    return rows
  }

  async listOutbox(status = null) {
    const { rows } = status
      ? await this.query(`select id, kind, status, aggregate_type as "aggregateType", aggregate_id as "aggregateId", requested_by_user as "requestedByUser",
                                 tx_json as "txJson", submitted_tx_json as "submittedTxJson", tx_hash as "txHash", tx_result_json as "txResult", metadata,
                                 error_text as error, attempts, created_at as "createdAt", updated_at as "updatedAt"
                          from tx_outbox where status = $1 order by created_at desc`, [status])
      : await this.query(`select id, kind, status, aggregate_type as "aggregateType", aggregate_id as "aggregateId", requested_by_user as "requestedByUser",
                                 tx_json as "txJson", submitted_tx_json as "submittedTxJson", tx_hash as "txHash", tx_result_json as "txResult", metadata,
                                 error_text as error, attempts, created_at as "createdAt", updated_at as "updatedAt"
                          from tx_outbox order by created_at desc`)
    return rows
  }

  async listOutboxNeedingIndex(limit = 20) {
    const statuses = [OutboxStatuses.SUBMITTED, OutboxStatuses.VALIDATED]
    const { rows } = await this.query(
      `select id, kind, status, aggregate_type as "aggregateType", aggregate_id as "aggregateId", requested_by_user as "requestedByUser",
              tx_json as "txJson", submitted_tx_json as "submittedTxJson", tx_hash as "txHash", tx_result_json as "txResult", metadata,
              error_text as error, attempts, created_at as "createdAt", updated_at as "updatedAt"
       from tx_outbox where status = any($1::text[]) order by updated_at asc limit $2`, [statuses, limit]
    )
    return rows
  }

  async listOutboxForReconciliation(limit = 20) {
    const { rows } = await this.query(
      `select id, kind, status, aggregate_type as "aggregateType", aggregate_id as "aggregateId", requested_by_user as "requestedByUser",
              tx_json as "txJson", submitted_tx_json as "submittedTxJson", tx_hash as "txHash", tx_result_json as "txResult", metadata,
              error_text as error, attempts, created_at as "createdAt", updated_at as "updatedAt"
       from tx_outbox where status = any($1::text[]) order by updated_at asc limit $2`, [[OutboxStatuses.VALIDATED, OutboxStatuses.INDEXED, OutboxStatuses.PREPARED], limit]
    )
    return rows
  }

  async recordTransaction(tx) {
    await this.query(
      `insert into xrpl_transactions (tx_hash, tx_type, ledger_index, result_code, account, counterparty, raw_json)
       values ($1,$2,$3,$4,$5,$6,$7::jsonb)
       on conflict (tx_hash) do update set tx_type = excluded.tx_type, ledger_index = excluded.ledger_index,
          result_code = excluded.result_code, account = excluded.account, counterparty = excluded.counterparty,
          raw_json = excluded.raw_json, observed_at = now()`,
      [tx.txHash, tx.txType, tx.ledgerIndex ?? null, tx.resultCode ?? null, tx.account ?? null, tx.counterparty ?? null, JSON.stringify(tx.rawJson)]
    )
  }

  async getTransactionByHash(hash) {
    const { rows } = await this.query(
      `select tx_hash as "txHash", tx_type as "txType", ledger_index as "ledgerIndex", result_code as "resultCode", account, counterparty,
              observed_at as "observedAt", raw_json as "rawJson" from xrpl_transactions where tx_hash = $1`, [hash]
    )
    return rows[0] ?? null
  }

  async listTransactions(limit = 50) {
    const { rows } = await this.query(
      `select tx_hash as "txHash", tx_type as "txType", ledger_index as "ledgerIndex", result_code as "resultCode", account, counterparty,
              observed_at as "observedAt", raw_json as "rawJson" from xrpl_transactions order by observed_at desc limit $1`, [limit]
    )
    return rows
  }

  async saveCheckpoint(name, ledgerIndex) {
    const { rows } = await this.query(
      `insert into ledger_checkpoints (stream_name, last_validated_ledger) values ($1,$2)
       on conflict (stream_name) do update set last_validated_ledger = excluded.last_validated_ledger, updated_at = now()
       returning stream_name as "streamName", last_validated_ledger as "lastValidatedLedger", updated_at as "updatedAt"`,
      [name, ledgerIndex]
    )
    return rows[0]
  }

  async getCheckpoint(name) {
    const { rows } = await this.query(
      `select stream_name as "streamName", last_validated_ledger as "lastValidatedLedger", updated_at as "updatedAt"
       from ledger_checkpoints where stream_name = $1`, [name]
    )
    return rows[0] ?? null
  }

  async saveReconciliationRun(row) {
    const { rows } = await this.query(
      `insert into reconciliation_runs (job_name, target_type, target_id, outcome, detail)
       values ($1,$2,$3,$4,$5::jsonb)
       returning id, job_name as "jobName", target_type as "targetType", target_id as "targetId", outcome, detail, created_at as "createdAt"`,
      [row.jobName, row.targetType, row.targetId, row.outcome, JSON.stringify(row.detail ?? {})]
    )
    return rows[0]
  }

  async listReconciliationRuns(limit = 50) {
    const { rows } = await this.query(
      `select id, job_name as "jobName", target_type as "targetType", target_id as "targetId", outcome, detail, created_at as "createdAt"
       from reconciliation_runs order by created_at desc limit $1`, [limit]
    )
    return rows
  }

  async getDashboardSummary() {
    const queries = await Promise.all([
      this.query(`select count(*)::int as count from parties where role = 'borrower'`),
      this.query(`select count(*)::int as count from vaults`),
      this.query(`select count(*)::int as count from loan_brokers`),
      this.query(`select count(*)::int as count from loans`),
      this.query(`select count(*)::int as count from tx_outbox`),
      this.query(`select count(*)::int as count from xrpl_transactions`),
      this.query(`select status, count(*)::int as count from vaults group by status`),
      this.query(`select status, count(*)::int as count from loan_brokers group by status`),
      this.query(`select status, count(*)::int as count from loans group by status`),
      this.query(`select status, count(*)::int as count from tx_outbox group by status`)
    ])
    const pack = (rows) => Object.fromEntries(rows.map((r) => [r.status, r.count]))
    return {
      counts: {
        borrowers: queries[0].rows[0].count,
        vaults: queries[1].rows[0].count,
        loanBrokers: queries[2].rows[0].count,
        loans: queries[3].rows[0].count,
        outbox: queries[4].rows[0].count,
        transactions: queries[5].rows[0].count
      },
      statuses: {
        vaults: pack(queries[6].rows),
        loanBrokers: pack(queries[7].rows),
        loans: pack(queries[8].rows),
        outbox: pack(queries[9].rows)
      },
      checkpoints: {
        ledger_indexer: await this.getCheckpoint('ledger_indexer')
      }
    }
  }

  /**
   * Reserve next sequence for an XRPL account using advisory lock.
   * @param {string} account
   * @param {function} fetchFromLedger — called with current DB seq (or null), must return seq number
   * @returns {number} reserved sequence
   */
  async reserveAccountSequence(account, fetchFromLedger) {
    const lockKey = Buffer.from(account).reduce((a, b) => ((a << 5) - a + b) | 0, 0)
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('SELECT pg_advisory_xact_lock($1)', [lockKey])

      // Clean up expired leases first (Critical #2: crash recovery)
      await client.query(
        `DELETE FROM xrpl_account_sequences WHERE account = $1 AND lease_expires_at < now()`,
        [account]
      )

      const { rows } = await client.query(
        'SELECT next_sequence FROM xrpl_account_sequences WHERE account = $1', [account]
      )
      let seq
      if (rows.length === 0) {
        seq = await fetchFromLedger(null)
        await client.query(
          `INSERT INTO xrpl_account_sequences (account, next_sequence, lease_expires_at, last_synced_at)
           VALUES ($1, $2, now() + interval '30 seconds', now())`,
          [account, seq + 1]
        )
      } else {
        seq = Number(rows[0].next_sequence)
        await client.query(
          `UPDATE xrpl_account_sequences
           SET next_sequence = $1, lease_expires_at = now() + interval '30 seconds', updated_at = now()
           WHERE account = $2`,
          [seq + 1, account]
        )
      }
      await client.query('COMMIT')
      return seq
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  }

  async forgetAccountSequence(account) {
    await this.query('DELETE FROM xrpl_account_sequences WHERE account = $1', [account])
  }
}
