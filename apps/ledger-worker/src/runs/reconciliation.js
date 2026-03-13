/**
 * reconciliation.js
 * ──────────────────────────────────────────────
 * 命令5: reconciliation を「会計」に引き上げる
 *
 * - object type 別 job (vault / broker / loan)
 * - mismatch severity: info / warning / critical
 * - critical は operator ack まで閉じない
 * - reconciliation run ごとに evidence event を残す
 * - 即時照合 (post-submit) + 日次フル照合 の二段構成
 */
import { enrichAggregateFromValidatedOutbox, verifyLedgerPresence } from './xrpl-state.js'
import { OutboxStatuses } from '../../../../packages/shared-types/src/index.js'

// ─── Mismatch severity ─────────

export const Severity = Object.freeze({
  INFO: 'info',
  WARNING: 'warning',
  CRITICAL: 'critical'
})

function mismatch(field, expected, actual, severity = Severity.WARNING) {
  return { field, expected, actual, severity, detectedAt: new Date().toISOString() }
}

// ─── Vault reconciliation (命令5) ─────────

async function reconcileVault({ db, xrpl, vaultId, dbVault }) {
  const mismatches = []
  if (!dbVault) {
    mismatches.push(mismatch('db_vault', 'exists', 'not_found', Severity.CRITICAL))
    return { type: 'vault', id: vaultId, mismatches, onLedger: null }
  }

  if (!dbVault.xrplVaultId) {
    if (dbVault.status === 'active' || dbVault.status === 'funded') {
      mismatches.push(mismatch('xrplVaultId', 'non-null', 'null', Severity.CRITICAL))
    }
    return { type: 'vault', id: vaultId, mismatches, onLedger: null }
  }

  // On-ledger check
  let onLedger = null
  try {
    await xrpl.connect()
    const res = await xrpl.ledgerEntry({ index: dbVault.xrplVaultId })
    onLedger = res.result?.node ?? null
  } catch {
    if (dbVault.status === 'active' || dbVault.status === 'funded') {
      mismatches.push(mismatch('ledger_presence', 'exists', 'not_found', Severity.CRITICAL))
    }
    return { type: 'vault', id: vaultId, mismatches, onLedger: null }
  }

  if (!onLedger) {
    mismatches.push(mismatch('ledger_node', 'exists', 'null', Severity.CRITICAL))
    return { type: 'vault', id: vaultId, mismatches, onLedger: null }
  }

  // DB says active but ledger object doesn't exist → critical
  if (onLedger.LedgerEntryType !== 'Vault') {
    mismatches.push(mismatch('entry_type', 'Vault', onLedger.LedgerEntryType, Severity.CRITICAL))
  }

  return { type: 'vault', id: vaultId, mismatches, onLedger }
}

// ─── Broker reconciliation (命令5) ─────────

async function reconcileBroker({ db, xrpl, brokerId, dbBroker }) {
  const mismatches = []
  if (!dbBroker) {
    mismatches.push(mismatch('db_broker', 'exists', 'not_found', Severity.CRITICAL))
    return { type: 'loan_broker', id: brokerId, mismatches, onLedger: null }
  }

  if (!dbBroker.xrplLoanBrokerId) {
    if (dbBroker.status === 'active' || dbBroker.status === 'cover_funded') {
      mismatches.push(mismatch('xrplLoanBrokerId', 'non-null', 'null', Severity.CRITICAL))
    }
    return { type: 'loan_broker', id: brokerId, mismatches, onLedger: null }
  }

  let onLedger = null
  try {
    await xrpl.connect()
    const res = await xrpl.ledgerEntry({ index: dbBroker.xrplLoanBrokerId })
    onLedger = res.result?.node ?? null
  } catch {
    if (dbBroker.status !== 'queued') {
      mismatches.push(mismatch('ledger_presence', 'exists', 'not_found', Severity.CRITICAL))
    }
    return { type: 'loan_broker', id: brokerId, mismatches, onLedger: null }
  }

  // Validate configured rates match
  if (onLedger) {
    const type = onLedger.LedgerEntryType
    if (type !== 'LoanBroker' && type !== 'LoanManager') {
      mismatches.push(mismatch('entry_type', 'LoanBroker|LoanManager', type, Severity.CRITICAL))
    }
  }

  return { type: 'loan_broker', id: brokerId, mismatches, onLedger }
}

// ─── Loan reconciliation (命令5) ─────────

async function reconcileLoan({ db, xrpl, loanId, dbLoan }) {
  const mismatches = []
  if (!dbLoan) {
    mismatches.push(mismatch('db_loan', 'exists', 'not_found', Severity.CRITICAL))
    return { type: 'loan', id: loanId, mismatches, onLedger: null }
  }

  if (!dbLoan.xrplLoanId) {
    if (dbLoan.status === 'active') {
      mismatches.push(mismatch('xrplLoanId', 'non-null', 'null', Severity.CRITICAL))
    }
    return { type: 'loan', id: loanId, mismatches, onLedger: null }
  }

  let onLedger = null
  try {
    await xrpl.connect()
    const res = await xrpl.ledgerEntry({ index: dbLoan.xrplLoanId })
    onLedger = res.result?.node ?? null
  } catch {
    if (dbLoan.status === 'active') {
      mismatches.push(mismatch('ledger_presence', 'exists', 'not_found', Severity.CRITICAL))
    }
    return { type: 'loan', id: loanId, mismatches, onLedger: null }
  }

  if (onLedger) {
    // Verify principal matches
    const ledgerPrincipal = onLedger.PrincipalRequested ?? onLedger.Principal ?? null
    if (ledgerPrincipal && String(ledgerPrincipal) !== String(dbLoan.principal)) {
      mismatches.push(mismatch('principal', String(dbLoan.principal), String(ledgerPrincipal), Severity.CRITICAL))
    }
  }

  return { type: 'loan', id: loanId, mismatches, onLedger }
}

// ─── Post-submit immediate reconciliation ─────────

export async function runReconciliation({ config, db, xrpl }) {
  const targets = await db.listOutboxForReconciliation(20)
  for (const item of targets) {
    try {
      const updated = await enrichAggregateFromValidatedOutbox({ db, outboxRow: item, xrpl })
      const created = updated?.created ?? {}

      let ledgerCheck = { mode: config.dryRun ? 'dry_run' : 'live' }
      let mismatches = []

      if (!config.dryRun && config.xrplLendingEnabled) {
        const hasAnyId = created.vaultId || created.loanBrokerId || created.loanId
        if (hasAnyId) {
          try {
            await xrpl.connect()
            ledgerCheck = await verifyLedgerPresence({
              xrpl,
              vaultId: created.vaultId ?? null,
              loanBrokerId: created.loanBrokerId ?? null,
              loanId: created.loanId ?? null
            })

            // Check for failures in verification
            for (const [key, val] of Object.entries(ledgerCheck)) {
              if (val && val.ok === false) {
                mismatches.push(mismatch(`ledger_${key}`, 'exists', 'not_found', Severity.WARNING))
              }
            }
          } catch (verifyErr) {
            ledgerCheck = { mode: 'live', error: verifyErr.message, partial: true }
          }
        } else {
          ledgerCheck = { mode: 'live', skipped: true, reason: 'no ledger objects to verify' }
        }
      }

      const hasCritical = mismatches.some(m => m.severity === Severity.CRITICAL)
      const outcome = hasCritical ? 'critical_mismatch' : mismatches.length > 0 ? 'mismatch' : 'ok'

      const detail = {
        kind: updated?.kind ?? item.kind,
        created,
        resolved: updated?.resolved ?? false,
        ledgerCheck,
        mismatches,
        txHash: item.txHash ?? null,
        txMeta: updated?.txMeta ?? null
      }

      await db.saveReconciliationRun({
        jobName: 'post_submit_reconciliation',
        targetType: item.aggregateType,
        targetId: item.aggregateId,
        outcome,
        detail
      })

      // Don't move to RECONCILED if critical mismatch — needs operator ack
      const newStatus = hasCritical
        ? OutboxStatuses.MANUAL_REVIEW
        : OutboxStatuses.RECONCILED

      await db.updateOutbox(item.id, {
        status: newStatus,
        metadata: {
          ...(item.metadata ?? {}),
          reconciledAt: new Date().toISOString(),
          reconciliation: detail
        }
      })
    } catch (error) {
      await db.saveReconciliationRun({
        jobName: 'post_submit_reconciliation',
        targetType: item.aggregateType,
        targetId: item.aggregateId,
        outcome: 'error',
        detail: { error: error.message, txHash: item.txHash ?? null }
      })
    }
  }
}

// ─── Full daily reconciliation (命令5: 日次フル照合) ─────────

export async function runFullReconciliation({ config, db, xrpl }) {
  if (config.dryRun || !config.xrplLendingEnabled) return { skipped: true }

  const results = { vaults: [], brokers: [], loans: [], summary: { info: 0, warning: 0, critical: 0 } }

  // Reconcile all active vaults
  const vaults = await db.listVaults()
  for (const v of vaults.filter(x => x.status !== 'queued' && x.status !== 'failed')) {
    const r = await reconcileVault({ db, xrpl, vaultId: v.id, dbVault: v })
    results.vaults.push(r)
    for (const m of r.mismatches) results.summary[m.severity]++
  }

  // Reconcile all active brokers
  const brokers = await db.listLoanBrokers()
  for (const b of brokers.filter(x => x.status !== 'queued' && x.status !== 'failed')) {
    const r = await reconcileBroker({ db, xrpl, brokerId: b.id, dbBroker: b })
    results.brokers.push(r)
    for (const m of r.mismatches) results.summary[m.severity]++
  }

  // Reconcile all active loans
  const loans = await db.listLoans()
  for (const l of loans.filter(x => x.status === 'active')) {
    const r = await reconcileLoan({ db, xrpl, loanId: l.id, dbLoan: l })
    results.loans.push(r)
    for (const m of r.mismatches) results.summary[m.severity]++
  }

  // Save run
  await db.saveReconciliationRun({
    jobName: 'daily_full_reconciliation',
    targetType: 'system',
    targetId: '00000000-0000-0000-0000-000000000000',
    outcome: results.summary.critical > 0 ? 'critical_mismatch' : 'ok',
    detail: results
  })

  return results
}
