/**
 * tx-executor.js — FINAL
 * ──────────────────────────────────────────────
 * Critical #1: sequence coordinator (DB advisory lock)
 * Critical #2: real XRPL tx hash (SHA512Half of signed binary)
 * Critical #3: submit → tx lookup (no submitAndWait)
 * Critical #4: network guard (amendment_blocked, fee, server_state)
 * Critical #5: complete retry matrix
 */
import { createHash } from 'node:crypto'
import { createKeyStore } from '../../../packages/keystore/src/index.js'
import { OutboxStatuses, TxKinds } from '../../../packages/shared-types/src/index.js'
import { createSequenceCoordinator } from './sequence-coordinator.js'
import { createLogger } from '../../../packages/logger/src/index.js'

const log = createLogger('tx-executor')

const MAX_SUBMIT_RETRIES = 2
const RETRY_DELAY_MS = 3000
const TX_LOOKUP_RETRIES = 5
const TX_LOOKUP_DELAY_MS = 4000
const FEE_SPIKE_THRESHOLD_DROPS = 5000

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

// ─── Fallback hash (only used when xrpl binary encoding unavailable) ──────
function fallbackTxHash(tx) {
  return 'PSEUDO_' + createHash('sha256').update(JSON.stringify(tx)).digest('hex').toUpperCase().slice(0, 56)
}

// ─── Result code matrix (Critical #5) ──────

export const RESULT_CLASSIFICATION = Object.freeze({
  tesSUCCESS: 'success', terQUEUED: 'success',
  terPRE_SEQ: 'retry', tefPAST_SEQ: 'retry', telCAN_NOT_QUEUE: 'retry',
  terINSUF_FEE_B: 'retry', telINSUF_FEE_P: 'retry',
  tecUNFUNDED: 'manual_review', tecNO_PERMISSION: 'manual_review',
  tecNO_AUTH: 'manual_review', tefNOT_ENABLED: 'manual_review',
  tecINVARIANT_FAILED: 'manual_review', tecUNFUNDED_PAYMENT: 'manual_review',
  tecPATH_DRY: 'manual_review', tecNO_LINE: 'manual_review',
  temMALFORMED: 'fail', temBAD_AMOUNT: 'fail', temBAD_FEE: 'fail',
  temINVALID: 'fail', temDISABLED: 'fail', temBAD_SEQUENCE: 'fail',
  temREDUNDANT: 'fail', temBAD_EXPIRATION: 'fail'
})

export function classifyResult(code) {
  if (!code || code === 'unknown') return 'fail'
  if (RESULT_CLASSIFICATION[code]) return RESULT_CLASSIFICATION[code]
  if (code.startsWith('tes')) return 'success'
  if (code.startsWith('ter')) return 'retry'
  if (code.startsWith('tel')) return 'retry'
  if (code.startsWith('tec')) return 'manual_review'
  if (code.startsWith('tem')) return 'fail'
  if (code.startsWith('tef')) return 'fail'
  return 'fail'
}

function isRetryableError(error) {
  const m = error.message?.toLowerCase() ?? ''
  return m.includes('timeout') || m.includes('disconnect') ||
    m.includes('websocket') || m.includes('not connected') || m.includes('connection')
}

// ─── Network guard (Critical #4) + Amendment feature guard (#7) ──────

// Known amendment names for Vault/Lending features
// These may vary across XRPL versions — the guard checks dynamically
const REQUIRED_FEATURES = [
  'SingleAssetVault',
  'Lending',
  'PermissionedDomains'
]

export async function checkNetworkReadiness(xrpl) {
  const info = await xrpl.serverInfo()
  const si = info.result?.info ?? {}
  const state = si.server_state ?? 'unknown'
  const amendmentBlocked = si.amendment_blocked === true
  const validatedLedger = si.validated_ledger?.seq ?? null
  const baseFee = si.validated_ledger?.base_fee_xrp ?? null
  const buildVersion = si.build_version ?? 'unknown'

  const issues = []
  if (amendmentBlocked) issues.push('amendment_blocked')
  if (!validatedLedger) issues.push('no_validated_ledger')
  if (!['full', 'proposing', 'validating'].includes(state)) issues.push(`server_state=${state}`)

  // Amendment feature guard: check if lending/vault features are enabled
  let featureStatus = {}
  try {
    const featureResult = await xrpl.request({ command: 'feature' })
    const features = featureResult.result ?? {}
    for (const name of REQUIRED_FEATURES) {
      // feature response is keyed by hash or name depending on server version
      const match = Object.entries(features).find(([k, v]) =>
        v?.name === name || k === name
      )
      if (match) {
        const enabled = match[1]?.enabled === true
        featureStatus[name] = enabled ? 'enabled' : 'not_enabled'
        if (!enabled) issues.push(`feature_not_enabled: ${name}`)
      } else {
        featureStatus[name] = 'unknown'
        // Don't block on unknown — Devnet may not report all features
      }
    }
  } catch {
    // feature command may not be available on all nodes — don't block
    featureStatus = { _error: 'feature_command_unavailable' }
  }

  return { ok: issues.length === 0, state, amendmentBlocked, validatedLedger, baseFee, buildVersion, featureStatus, issues }
}

async function checkFee(xrpl) {
  try {
    const r = await xrpl.request({ command: 'fee' })
    const drops = r.result?.drops ?? {}
    const open = Number(drops.open_ledger_fee ?? 0)
    const min = Number(drops.minimum_fee ?? 10)
    return { ok: open <= FEE_SPIKE_THRESHOLD_DROPS, openLedgerFee: open, minimumFee: min, feeSpike: open > FEE_SPIKE_THRESHOLD_DROPS }
  } catch {
    return { ok: true, openLedgerFee: 0, minimumFee: 10, feeSpike: false }
  }
}

// ─── tx lookup with validated ledger lag awareness (Critical #3) ──────

async function lookupTx(xrpl, txHash, lastLedgerSeq = null, retries = TX_LOOKUP_RETRIES) {
  for (let i = 0; i < retries; i++) {
    try {
      await xrpl.connect()

      // Check if validated ledger has passed LastLedgerSequence
      // If so, and tx is not found, it's definitively failed
      if (lastLedgerSeq) {
        try {
          const info = await xrpl.serverInfo()
          const validatedSeq = info.result?.info?.validated_ledger?.seq
          if (validatedSeq && validatedSeq > lastLedgerSeq) {
            // Ledger has passed — one final lookup
            try {
              const r = await xrpl.request({ command: 'tx', transaction: txHash })
              if (r.result?.validated) return r.result
            } catch {}
            return null // definitively not included
          }
        } catch {}
      }

      const r = await xrpl.request({ command: 'tx', transaction: txHash })
      if (r.result?.validated) return r.result
    } catch {
      // Not found yet
    }
    if (i < retries - 1) await sleep(TX_LOOKUP_DELAY_MS)
  }
  return null
}

// ─── Executor ──────

export function buildExecutor({ config, db, xrpl }) {
  const keyStore = createKeyStore({
    provider: config.signerProvider,
    seedsJson: config.seedsJson,
    filePath: config.signerSeedFile,
    vendor: config.signerKmsVendor,
    keyAlias: config.signerKmsKeyAlias,
    slot: config.signerHsmSlot,
    keyLabel: config.signerHsmKeyLabel
  })

  const seqCoord = createSequenceCoordinator({ xrpl, db })
  let lastNetworkCheck = null
  let lastFeeCheck = null

  return {
    describeSigner() { return keyStore.describe() },

    async refreshNetworkStatus() {
      try {
        await xrpl.connect()
        lastNetworkCheck = await checkNetworkReadiness(xrpl)
        lastFeeCheck = await checkFee(xrpl)
      } catch (err) {
        lastNetworkCheck = { ok: false, issues: [`check_failed: ${err.message}`] }
        lastFeeCheck = { ok: true }
      }
      return { network: lastNetworkCheck, fee: lastFeeCheck }
    },

    getNetworkStatus() { return { network: lastNetworkCheck, fee: lastFeeCheck } },

    async processPending() {
      const status = await this.refreshNetworkStatus()
      if (status.network?.amendmentBlocked) {
        log.error('amendment_blocked', { issues: status.network.issues })
        return
      }
      if (!status.network?.ok) {
        log.warn('network_issues', { issues: status.network?.issues })
      }

      const rows = await db.claimPendingOutbox(config.batchSize)
      for (const row of rows) {
        try {
          await this._processOne(row)
        } catch (error) {
          log.error('unhandled_error', { outboxId: row.id, error: error.message })
          await db.updateOutbox(row.id, {
            status: OutboxStatuses.FAILED,
            error: `unhandled: ${error.message}`
          }).catch(() => {})
        }
      }
    },

    async _processOne(row) {
      if (!config.xrplLendingEnabled) {
        return db.updateOutbox(row.id, { status: OutboxStatuses.BLOCKED, error: 'lending_disabled' })
      }

      // Dry run
      if (config.dryRun) {
        const h = fallbackTxHash(row.txJson)
        await db.updateOutbox(row.id, {
          status: OutboxStatuses.PREPARED, txHash: h,
          submittedTxJson: row.txJson,
          txResult: { dryRun: true, kind: row.kind }
        })
        await db.recordTransaction({ txHash: h, txType: row.txJson.TransactionType, account: row.txJson.Account, counterparty: row.txJson.Borrower ?? row.txJson.Counterparty ?? null, resultCode: 'DRY_RUN', rawJson: row.txJson })
        return
      }

      // Fee guard
      if (lastFeeCheck?.feeSpike) {
        return db.updateOutbox(row.id, { status: OutboxStatuses.BLOCKED, error: `fee_spike: ${lastFeeCheck.openLedgerFee}` })
      }

      await xrpl.connect()
      await db.updateOutbox(row.id, { status: OutboxStatuses.SUBMITTED })

      // Cosigned LoanSet — already fully signed blob
      if (row.kind === TxKinds.LOAN_SET && row.metadata?.counterpartySignedTxBlob) {
        return this._submitBlobAndLookup(row, row.metadata.counterpartySignedTxBlob)
      }

      // Check signer availability
      const account = row.txJson.Account
      if (!keyStore.hasKey(account)) {
        return db.updateOutbox(row.id, { status: OutboxStatuses.BLOCKED, error: `no_signer: ${account}` })
      }

      // Reserve sequence (Critical #1)
      await this._signAndSubmit(row, account, 0)
    },

    async _signAndSubmit(row, account, attempt) {
      try {
        const seq = await seqCoord.withAccountSequence(account, async (reserved) => {
          // Build tx with reserved sequence
          const tx = { ...row.txJson }
          delete tx.Fee
          delete tx.LastLedgerSequence
          delete tx.SigningPubKey
          delete tx.TxnSignature
          tx.Sequence = reserved

          // Autofill Fee + LastLedgerSequence (but NOT Sequence)
          const prepared = await xrpl.autofill({ ...tx, Sequence: reserved })
          prepared.Sequence = reserved // ensure our reserved seq wins

          // Sign via keystore (seed never leaves keystore)
          const { signedTxBlob, txHash } = await keyStore.sign(prepared, account)

          // Submit (Critical #3: submit, not submitAndWait)
          const submitResult = await xrpl.request({ command: 'submit', tx_blob: signedTxBlob })
          const engineResult = submitResult.result?.engine_result ?? 'unknown'
          const classification = classifyResult(engineResult)

          return { signedTxBlob, txHash, prepared, engineResult, classification, submitResult }
        })

        const { txHash, prepared, engineResult, classification, submitResult } = seq

        // Sequence errors → invalidate cache and retry
        if ((engineResult === 'terPRE_SEQ' || engineResult === 'tefPAST_SEQ') && attempt < MAX_SUBMIT_RETRIES) {
          seqCoord.invalidate(account)
          await sleep(RETRY_DELAY_MS)
          return this._signAndSubmit(row, account, attempt + 1)
        }

        if (classification === 'retry' && attempt < MAX_SUBMIT_RETRIES) {
          await sleep(RETRY_DELAY_MS)
          return this._signAndSubmit(row, account, attempt + 1)
        }

        // Success → lookup validated tx (Critical #3)
        if (classification === 'success') {
          const lastLedgerSeq = prepared?.LastLedgerSequence ?? null
          const validated = await lookupTx(xrpl, txHash, lastLedgerSeq)
          if (validated) {
            const finalCode = validated.meta?.TransactionResult ?? engineResult
            await db.updateOutbox(row.id, {
              status: classifyResult(finalCode) === 'success' ? OutboxStatuses.VALIDATED : OutboxStatuses.FAILED,
              txHash, submittedTxJson: prepared, txResult: validated
            })
            await db.recordTransaction({
              txHash, txType: row.txJson.TransactionType, account,
              counterparty: row.txJson.Borrower ?? row.txJson.Counterparty ?? null,
              ledgerIndex: validated.ledger_index ?? null,
              resultCode: finalCode, rawJson: validated
            })
            return
          }
          // tx not found after retries — mark as unknown
          await db.updateOutbox(row.id, {
            status: OutboxStatuses.MANUAL_REVIEW, txHash, submittedTxJson: prepared,
            txResult: submitResult.result,
            error: `submitted_but_not_validated: ${engineResult}`
          })
          return
        }

        // Manual review or fail
        const finalStatus = classification === 'manual_review' ? OutboxStatuses.MANUAL_REVIEW : OutboxStatuses.FAILED
        await db.updateOutbox(row.id, {
          status: finalStatus, txHash, submittedTxJson: prepared,
          txResult: submitResult.result,
          error: classification === 'manual_review' ? `manual_review: ${engineResult}` : engineResult
        })
        await db.recordTransaction({
          txHash, txType: row.txJson.TransactionType, account,
          counterparty: row.txJson.Borrower ?? row.txJson.Counterparty ?? null,
          resultCode: engineResult, rawJson: submitResult.result
        })
      } catch (error) {
        if (isRetryableError(error) && attempt < MAX_SUBMIT_RETRIES) {
          seqCoord.invalidate(account)
          await sleep(RETRY_DELAY_MS)
          try { await xrpl.connect() } catch {}
          return this._signAndSubmit(row, account, attempt + 1)
        }
        await db.updateOutbox(row.id, { status: OutboxStatuses.FAILED, error: `submit_error: ${error.message}` })
      }
    },

    async _submitBlobAndLookup(row, txBlob) {
      try {
        const r = await xrpl.request({ command: 'submit', tx_blob: txBlob })
        const engineResult = r.result?.engine_result ?? 'unknown'
        const txHash = r.result?.tx_json?.hash ?? null
        const lastLedgerSeq = row.txJson?.LastLedgerSequence ?? row.metadata?.lastLedgerSequence ?? null
        const classification = classifyResult(engineResult)

        if (classification === 'success' && txHash) {
          const validated = await lookupTx(xrpl, txHash, lastLedgerSeq)
          if (validated?.validated) {
            const finalCode = validated.meta?.TransactionResult ?? engineResult
            await db.updateOutbox(row.id, {
              status: classifyResult(finalCode) === 'success' ? OutboxStatuses.VALIDATED : OutboxStatuses.FAILED,
              txHash, txResult: validated,
              metadata: { ...(row.metadata ?? {}), submittedAt: new Date().toISOString(), validationSource: 'lookup' }
            })
            await db.recordTransaction({ txHash, txType: row.txJson.TransactionType, account: row.txJson.Account, counterparty: row.txJson.Borrower ?? row.txJson.Counterparty ?? null, ledgerIndex: validated.ledger_index ?? null, resultCode: finalCode, rawJson: validated })
            return
          }
          // submitted but NOT validated — indexer will resolve later
          await db.updateOutbox(row.id, {
            status: OutboxStatuses.SUBMITTED, txHash, txResult: r.result,
            metadata: { ...(row.metadata ?? {}), submittedAt: new Date().toISOString(), awaitingValidation: true, lastLedgerSequence: lastLedgerSeq }
          })
          return
        }

        // Non-success results
        const finalStatus = classification === 'manual_review' ? OutboxStatuses.MANUAL_REVIEW
          : classification === 'retry' ? OutboxStatuses.SUBMITTED
            : OutboxStatuses.FAILED
        await db.updateOutbox(row.id, { status: finalStatus, txHash, txResult: r.result })
        if (txHash) {
          await db.recordTransaction({ txHash, txType: row.txJson.TransactionType, account: row.txJson.Account, counterparty: row.txJson.Borrower ?? row.txJson.Counterparty ?? null, resultCode: engineResult, rawJson: r.result })
        }
      } catch (error) {
        await db.updateOutbox(row.id, { status: OutboxStatuses.FAILED, error: `cosign_error: ${error.message}` })
      }
    }
  }
}
