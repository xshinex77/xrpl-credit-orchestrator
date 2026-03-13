/**
 * xrpl-state.js
 * ──────────────────────────────────────────────
 * 命令4: ledger indexer を metadata 主導に再構築
 *
 * AffectedNodes を正本として:
 *   - CreatedNode / ModifiedNode / DeletedNode を全て正規化
 *   - LedgerEntryType, LedgerIndex, NewFields, FinalFields, PreviousFields を抽出
 *   - object diff を保存
 *   - tx hash + ledger index + transaction index を記録
 */
import { TxKinds } from '../../../../packages/shared-types/src/index.js'

// ─── AffectedNodes 正規化 ─────────

/**
 * Normalize ALL AffectedNodes into a flat array with action type and full fields.
 * Returns: [{ action, entryType, ledgerIndex, newFields, finalFields, previousFields }]
 */
export function normalizeAffectedNodes(meta) {
  const nodes = meta?.AffectedNodes ?? []
  return nodes.map((item) => {
    if (item.CreatedNode) {
      const n = item.CreatedNode
      return {
        action: 'created',
        entryType: n.LedgerEntryType,
        ledgerIndex: n.LedgerIndex ?? n.ledger_index ?? null,
        newFields: n.NewFields ?? {},
        finalFields: null,
        previousFields: null
      }
    }
    if (item.ModifiedNode) {
      const n = item.ModifiedNode
      return {
        action: 'modified',
        entryType: n.LedgerEntryType,
        ledgerIndex: n.LedgerIndex ?? n.ledger_index ?? null,
        newFields: null,
        finalFields: n.FinalFields ?? {},
        previousFields: n.PreviousFields ?? {}
      }
    }
    if (item.DeletedNode) {
      const n = item.DeletedNode
      return {
        action: 'deleted',
        entryType: n.LedgerEntryType,
        ledgerIndex: n.LedgerIndex ?? n.ledger_index ?? null,
        newFields: null,
        finalFields: n.FinalFields ?? {},
        previousFields: n.PreviousFields ?? null
      }
    }
    return null
  }).filter(Boolean)
}

/**
 * Extract created ledger object IDs from validated tx metadata.
 */
export function extractCreatedLedgerIds(result) {
  const nodes = normalizeAffectedNodes(result?.meta)
  const out = {
    vaultId: null,
    loanBrokerId: null,
    loanId: null,
    loanSeq: null,
    affectedTypes: nodes.map((x) => x.entryType).filter(Boolean),
    // 命令4: full normalized diff for storage
    normalizedNodes: nodes
  }

  for (const node of nodes) {
    if (node.action !== 'created') continue
    const idx = node.ledgerIndex ?? node.newFields?.index ?? null

    if (node.entryType === 'Vault' && !out.vaultId) {
      out.vaultId = idx
    }
    if ((node.entryType === 'LoanBroker' || node.entryType === 'LoanManager') && !out.loanBrokerId) {
      out.loanBrokerId = idx
    }
    if (node.entryType === 'Loan' && !out.loanId) {
      out.loanId = idx
      out.loanSeq = node.newFields?.LoanSeq ?? null
    }
  }
  return out
}

/**
 * Extract comprehensive tx metadata for storage (命令4).
 */
export function extractTxMetadata(result) {
  return {
    txHash: result?.hash ?? null,
    ledgerIndex: result?.ledger_index ?? result?.inLedger ?? null,
    transactionIndex: result?.meta?.TransactionIndex ?? null,
    resultCode: result?.meta?.TransactionResult ?? 'unknown',
    deliveredAmount: result?.meta?.delivered_amount ?? null,
    nodes: normalizeAffectedNodes(result?.meta)
  }
}

// ─── Aggregate enrichment ─────────

export async function enrichAggregateFromValidatedOutbox({ db, outboxRow, xrpl }) {
  const result = outboxRow.txResult ?? null
  const created = extractCreatedLedgerIds(result)
  const txMeta = extractTxMetadata(result)

  if (outboxRow.kind === TxKinds.VAULT_CREATE) {
    if (created.vaultId) {
      await db.updateVault(outboxRow.aggregateId, { xrplVaultId: created.vaultId, status: 'active' })
    }
    return { kind: outboxRow.kind, created, txMeta, resolved: Boolean(created.vaultId) }
  }

  if (outboxRow.kind === TxKinds.VAULT_DEPOSIT) {
    // 命令4: extract shares/balance from ModifiedNode
    const vaultModified = txMeta.nodes.find(n =>
      n.action === 'modified' && n.entryType === 'Vault')
    const sharesInfo = vaultModified ? {
      finalAsset: vaultModified.finalFields?.Asset ?? null,
      finalShares: vaultModified.finalFields?.TotalShares ?? null,
      previousShares: vaultModified.previousFields?.TotalShares ?? null
    } : null

    await db.updateVault(outboxRow.aggregateId, { status: 'funded' })
    return { kind: outboxRow.kind, created, txMeta, sharesInfo, resolved: true }
  }

  if (outboxRow.kind === TxKinds.LOAN_BROKER_SET) {
    if (created.loanBrokerId) {
      await db.updateLoanBroker(outboxRow.aggregateId, {
        xrplLoanBrokerId: created.loanBrokerId, status: 'active'
      })
    }
    return { kind: outboxRow.kind, created, txMeta, resolved: Boolean(created.loanBrokerId) }
  }

  if (outboxRow.kind === TxKinds.LOAN_BROKER_COLLATERAL_DEPOSIT) {
    // 命令4: extract cover balance change
    const brokerModified = txMeta.nodes.find(n =>
      n.action === 'modified' && (n.entryType === 'LoanBroker' || n.entryType === 'LoanManager'))
    const coverInfo = brokerModified ? {
      finalCover: brokerModified.finalFields?.CoverBalance ?? null,
      previousCover: brokerModified.previousFields?.CoverBalance ?? null
    } : null

    await db.updateLoanBroker(outboxRow.aggregateId, { status: 'cover_funded' })
    return { kind: outboxRow.kind, created, txMeta, coverInfo, resolved: true }
  }

  if (outboxRow.kind === TxKinds.LOAN_SET) {
    if (created.loanId || created.loanSeq) {
      // 命令4: extract full loan terms from NewFields
      const loanCreated = txMeta.nodes.find(n =>
        n.action === 'created' && n.entryType === 'Loan')
      const loanTerms = loanCreated?.newFields ?? {}

      await db.updateLoan(outboxRow.aggregateId, {
        xrplLoanId: created.loanId,
        xrplLoanSeq: created.loanSeq,
        status: 'active'
      })
      return { kind: outboxRow.kind, created, txMeta, loanTerms, resolved: Boolean(created.loanId || created.loanSeq) }
    }
    return { kind: outboxRow.kind, created, txMeta, resolved: false }
  }

  return { kind: outboxRow.kind, created, txMeta, resolved: false }
}

// ─── Ledger verification ─────────

export async function verifyLedgerPresence({ xrpl, vaultId, loanBrokerId, loanId }) {
  const detail = {}

  if (vaultId) {
    try {
      const res = await xrpl.vaultInfo({ vault_id: vaultId, ledger_index: 'validated' })
      const entry = res.result?.ledger_entry ?? res.result?.node ?? res.result?.vault ?? null
      detail.vault = { ok: true, index: entry?.index ?? entry?.LedgerIndex ?? vaultId, entryType: entry?.LedgerEntryType ?? null }
    } catch (error) {
      try {
        const fallback = await xrpl.ledgerEntry({ index: vaultId })
        detail.vault = { ok: true, index: vaultId, entryType: fallback.result?.node?.LedgerEntryType ?? null, via: 'ledger_entry' }
      } catch (inner) {
        detail.vault = { ok: false, error: error.message }
      }
    }
  }

  if (loanBrokerId) {
    try {
      const res = await xrpl.ledgerEntry({ index: loanBrokerId })
      detail.loanBroker = { ok: true, type: res.result?.node?.LedgerEntryType ?? null }
    } catch (error) {
      detail.loanBroker = { ok: false, error: error.message }
    }
  }

  if (loanId) {
    try {
      const res = await xrpl.ledgerEntry({ index: loanId })
      detail.loan = { ok: true, type: res.result?.node?.LedgerEntryType ?? null }
    } catch (error) {
      detail.loan = { ok: false, error: error.message }
    }
  }

  return detail
}
