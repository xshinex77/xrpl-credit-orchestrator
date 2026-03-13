import { createLogger } from '../../../../packages/logger/src/index.js'
const log = createLogger('ledger-indexer')
/**
 * ledger-indexer.js — FINAL
 * ──────────────────────────────────────────────
 * Critical #1: Full AffectedNodes (Created + Modified + Deleted)
 * XRPL特有 #4: ledger gap detection
 * High #5: account_objects pagination
 */
import { enrichAggregateFromValidatedOutbox, extractTxMetadata } from './xrpl-state.js'
import { OutboxStatuses } from '../../../../packages/shared-types/src/index.js'

export async function runLedgerIndexer({ config, db, xrpl }) {
  if (config.dryRun || !config.xrplLendingEnabled) return

  try {
    await xrpl.connect()
    const current = await xrpl.ledgerCurrent()
    const currentIndex = current.result.ledger_current_index
    const checkpoint = await db.getCheckpoint('ledger_indexer')
    const lastIndex = checkpoint?.lastValidatedLedger ?? null

    // ── XRPL特有 #4: ledger gap detection ──
    if (lastIndex !== null && currentIndex > lastIndex + 1) {
      const gap = currentIndex - lastIndex - 1
      if (gap > 100) {
        log.warn('ledger_gap', { from: lastIndex, to: currentIndex, gap })
      }
    }

    if (lastIndex === currentIndex) return

    const candidates = await db.listOutboxNeedingIndex(20)
    for (const row of candidates) {
      try {
        let txResult = row.txResult

        // If we have txResult but no meta, try to re-fetch
        if (txResult && !txResult.meta && row.txHash && !row.txHash.startsWith('PSEUDO_')) {
          try {
            const tx = await xrpl.tx(row.txHash)
            if (tx.result?.validated) {
              txResult = tx.result
              await db.updateOutbox(row.id, { txResult })
            }
          } catch {
            // tx lookup failed, use what we have
          }
        }

        // No txResult and we have a real hash — lookup
        if (!txResult && row.txHash && !row.txHash.startsWith('PSEUDO_')) {
          try {
            const tx = await xrpl.tx(row.txHash)
            if (tx.result?.validated) {
              txResult = tx.result
              await db.updateOutbox(row.id, { txResult })
            }
          } catch {
            continue // skip for now, will retry next tick
          }
        }

        if (!txResult) continue

        // Full metadata extraction (Critical #1: all node types)
        const txMeta = extractTxMetadata(txResult)

        const indexed = await enrichAggregateFromValidatedOutbox({
          db, outboxRow: { ...row, txResult }, xrpl
        })

        await db.updateOutbox(row.id, {
          status: OutboxStatuses.INDEXED,
          metadata: {
            ...(row.metadata ?? {}),
            indexedAt: new Date().toISOString(),
            indexed,
            txMeta, // store full normalized metadata
            ledgerIndex: txMeta.ledgerIndex,
            transactionIndex: txMeta.transactionIndex
          }
        })
      } catch (error) {
        log.warn('index_error', { outboxId: row.id, error: error.message })
        await db.saveReconciliationRun({
          jobName: 'ledger_indexer',
          targetType: row.aggregateType,
          targetId: row.aggregateId,
          outcome: 'error',
          detail: { error: error.message, txHash: row.txHash ?? null }
        })
      }
    }

    await db.saveCheckpoint('ledger_indexer', currentIndex)
  } catch (error) {
    log.warn('skipped', { error: error.message })
  }
}

/**
 * High #5: Paginated account_objects fetch.
 * XRPL returns max ~200 objects per request.
 */
export async function fetchAllAccountObjects(xrpl, account, type = null) {
  const allObjects = []
  let marker = undefined

  do {
    await xrpl.connect()
    const params = {
      command: 'account_objects',
      account,
      ledger_index: 'validated',
      limit: 200
    }
    if (type) params.type = type
    if (marker) params.marker = marker

    const res = await xrpl.request(params)
    const objects = res.result?.account_objects ?? []
    allObjects.push(...objects)
    marker = res.result?.marker ?? undefined
  } while (marker)

  return allObjects
}
