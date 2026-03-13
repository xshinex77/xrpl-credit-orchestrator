#!/usr/bin/env node
/**
 * devnet-e2e.js
 * ──────────────────────────────────────────────
 * Devnet live submit E2E: Vault → Deposit → Broker → Cover → Loan → Cosign
 * control-api が起動済みであること前提。
 *
 * Usage:
 *   node scripts/devnet-e2e.js
 *   node scripts/devnet-e2e.js --api-url http://localhost:3000
 *   node scripts/devnet-e2e.js --wait-worker 30  # worker tick 待機秒数
 */
import fs from 'node:fs'
import path from 'node:path'

// ─── CLI args ───
const args = process.argv.slice(2)
function argVal(flag, def) {
  const idx = args.indexOf(flag)
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : def
}
const API_URL = argVal('--api-url', 'http://localhost:3000')
const WORKER_WAIT = Number(argVal('--wait-worker', '20')) * 1000
const POLL_INTERVAL = 2000

// ─── .env loader ───
function loadDotEnv() {
  const file = path.resolve(process.cwd(), '.env')
  if (!fs.existsSync(file)) return {}
  const env = {}
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i === -1) continue
    env[t.slice(0, i)] = t.slice(i + 1)
  }
  return env
}

const dotenv = loadDotEnv()
const ADMIN_USER = dotenv.DEV_ADMIN_USERNAME ?? 'admin'
const ADMIN_PASS = dotenv.DEV_ADMIN_PASSWORD ?? 'change-me'

// ─── accounts from .devnet-accounts.json or .env ───
function loadAccounts() {
  const jsonPath = path.resolve(process.cwd(), '.devnet-accounts.json')
  if (fs.existsSync(jsonPath)) {
    const accounts = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
    return {
      vaultOwner: accounts.find((a) => a.role === 'vault_owner')?.address,
      lender: accounts.find((a) => a.role === 'lender')?.address,
      borrower: accounts.find((a) => a.role === 'borrower')?.address
    }
  }
  // fallback: parse SEEDS_JSON
  const raw = dotenv.XRPL_SEEDS_JSON ?? dotenv.SEEDS_JSON ?? '{}'
  const map = JSON.parse(raw)
  const addrs = Object.keys(map)
  if (addrs.length < 3) {
    throw new Error(`Need 3 addresses in SEEDS_JSON, found ${addrs.length}`)
  }
  return { vaultOwner: addrs[0], lender: addrs[1], borrower: addrs[2] }
}

// ─── HTTP helpers ───
let token = null

async function api(method, endpoint, body = null) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const opts = { method, headers }
  if (body) opts.body = JSON.stringify(body)
  const res = await fetch(`${API_URL}${endpoint}`, opts)
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const detail = data?.error ?? data?.detail ?? res.statusText
    throw new Error(`API ${method} ${endpoint} → ${res.status}: ${detail}`)
  }
  return data
}

async function login() {
  const data = await api('POST', '/v1/auth/login', {
    username: ADMIN_USER,
    password: ADMIN_PASS
  })
  token = data.accessToken
  console.log(`  ✓ logged in as ${data.username} (${data.role})`)
  return data
}

// ─── Wait for outbox item to reach target status ───
async function waitOutbox(outboxId, targetStatuses, timeoutMs = WORKER_WAIT) {
  const start = Date.now()
  const targets = Array.isArray(targetStatuses) ? targetStatuses : [targetStatuses]
  while (Date.now() - start < timeoutMs) {
    const items = await api('GET', '/v1/outbox')
    const item = items.find((x) => x.id === outboxId)
    if (!item) throw new Error(`outbox ${outboxId} not found`)
    if (targets.includes(item.status)) return item
    if (item.status === 'failed' || item.status === 'blocked') {
      return item // return for inspection
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL))
  }
  throw new Error(`outbox ${outboxId} did not reach ${targets.join('/')} within ${timeoutMs}ms`)
}

// ─── Wait for vault to get xrplVaultId written back ───
async function waitVaultId(vaultId, timeoutMs = WORKER_WAIT) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const vaults = await api('GET', '/v1/vaults')
    const v = vaults.find((x) => x.id === vaultId)
    if (v?.xrplVaultId && !v.xrplVaultId.startsWith('UNSET')) return v
    await new Promise((r) => setTimeout(r, POLL_INTERVAL))
  }
  throw new Error(`vault ${vaultId} xrplVaultId not written back within ${timeoutMs}ms`)
}

async function waitBrokerId(brokerId, timeoutMs = WORKER_WAIT) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const brokers = await api('GET', '/v1/loan-brokers')
    const b = brokers.find((x) => x.id === brokerId)
    if (b?.xrplLoanBrokerId && !b.xrplLoanBrokerId.startsWith('UNSET')) return b
    await new Promise((r) => setTimeout(r, POLL_INTERVAL))
  }
  throw new Error(`broker ${brokerId} xrplLoanBrokerId not written back within ${timeoutMs}ms`)
}

// ─── Result tracking ───
const results = []
function step(name, status, detail = '') {
  const icon = status === 'pass' ? '✓' : status === 'fail' ? '✗' : '⚠'
  results.push({ name, status, detail })
  console.log(`  ${icon} ${name}${detail ? ': ' + detail : ''}`)
}

// ─── Main ───
async function main() {
  console.log('═══════════════════════════════════════════')
  console.log(' XRPL Credit Orchestrator — Devnet E2E')
  console.log('═══════════════════════════════════════════')
  console.log(`API: ${API_URL}  Worker wait: ${WORKER_WAIT / 1000}s\n`)

  // ── 0. Health check ──
  console.log('[0] Health check')
  const health = await api('GET', '/health')
  if (!health.lendingEnabled) {
    throw new Error('XRPL_LENDING_ENABLED is false — cannot proceed')
  }
  step('health', 'pass', `db=${health.database?.mode} lending=${health.lendingEnabled}`)

  // ── 1. Login ──
  console.log('\n[1] Auth')
  await login()

  // ── 2. Load accounts ──
  const accounts = loadAccounts()
  console.log(`\n[2] Accounts`)
  console.log(`  vault_owner: ${accounts.vaultOwner}`)
  console.log(`  lender:      ${accounts.lender}`)
  console.log(`  borrower:    ${accounts.borrower}`)

  // ── 3. Create Borrower ──
  console.log('\n[3] Create Borrower')
  const borrower = await api('POST', '/v1/borrowers', {
    legalName: 'E2E Test Borrower K.K.',
    countryCode: 'JP',
    xrplAddress: accounts.borrower
  })
  step('borrower.create', 'pass', `id=${borrower.id}`)

  // ── 4. Create Vault ──
  console.log('\n[4] Create Vault (VaultCreate → submit → writeback)')
  const vaultRes = await api('POST', '/v1/vaults', {
    ownerAddress: accounts.vaultOwner,
    assetType: 'XRP',
    isPrivate: false,
    displayName: 'E2E Devnet Pool',
    assetsMaximum: '100000000000',
    withdrawalPolicy: 0
  })
  step('vault.create', 'pass', `vaultId=${vaultRes.vault.id} outboxId=${vaultRes.outbox.id}`)

  console.log('  … waiting for worker to submit VaultCreate …')
  const vaultOutbox = await waitOutbox(vaultRes.outbox.id, ['validated', 'indexed', 'reconciled'])
  if (vaultOutbox.status === 'failed' || vaultOutbox.status === 'blocked') {
    step('vault.submit', 'fail', `status=${vaultOutbox.status} error=${vaultOutbox.error ?? 'unknown'}`)
    const resultCode = vaultOutbox.txResult?.meta?.TransactionResult ?? vaultOutbox.txResult?.engine_result ?? null
    if (resultCode) step('vault.resultCode', 'warn', resultCode)
    console.log('\n⚠ VaultCreate failed. This likely means Vault/Lending amendments are not active on Devnet.')
    console.log('  Check: https://xrpl.org/resources/known-amendments')
    printSummary()
    return
  }
  const txResult = vaultOutbox.txResult?.meta?.TransactionResult ??
    vaultOutbox.txResult?.engine_result ?? 'unknown'
  step('vault.submit', txResult === 'tesSUCCESS' ? 'pass' : 'fail', `resultCode=${txResult}`)

  if (txResult !== 'tesSUCCESS') {
    console.log('\n⚠ VaultCreate did not succeed. Aborting remaining steps.')
    printSummary()
    return
  }

  // Wait for xrplVaultId writeback
  console.log('  … waiting for xrplVaultId writeback …')
  let vaultWithId
  try {
    vaultWithId = await waitVaultId(vaultRes.vault.id)
    step('vault.writeback', 'pass', `xrplVaultId=${vaultWithId.xrplVaultId}`)
  } catch (err) {
    step('vault.writeback', 'fail', err.message)
    console.log('\n⚠ xrplVaultId not written back. Indexer may need adjustment.')
    console.log('  Check AffectedNodes structure in outbox txResult.')
    printSummary()
    return
  }

  // ── 5. Vault Deposit ──
  console.log('\n[5] Vault Deposit (Lender funds)')
  const depositRes = await api('POST', `/v1/vaults/${vaultRes.vault.id}/deposits`, {
    account: accounts.lender,
    amount: '10000000'
  })
  step('vault.deposit.enqueue', 'pass', `outboxId=${depositRes.outbox.id}`)

  console.log('  … waiting for VaultDeposit submit …')
  const depositOutbox = await waitOutbox(depositRes.outbox.id, ['validated', 'indexed', 'reconciled'])
  const depositResult = depositOutbox.txResult?.meta?.TransactionResult ??
    depositOutbox.txResult?.engine_result ?? depositOutbox.status
  step('vault.deposit', depositResult === 'tesSUCCESS' ? 'pass' : 'warn', `result=${depositResult}`)

  // ── 6. LoanBroker ──
  console.log('\n[6] Create LoanBroker (LoanBrokerSet → submit)')
  const brokerRes = await api('POST', '/v1/loan-brokers', {
    vaultId: vaultRes.vault.id,
    ownerAddress: accounts.vaultOwner,
    managementFeeRate: 10000,
    debtMaximum: '50000000000',
    coverRateMinimum: 100000,
    coverRateLiquidation: 50000,
    displayName: 'E2E Devnet Broker'
  })
  step('broker.create', 'pass', `brokerId=${brokerRes.loanBroker.id}`)

  console.log('  … waiting for LoanBrokerSet submit …')
  const brokerOutbox = await waitOutbox(brokerRes.outbox.id, ['validated', 'indexed', 'reconciled'])
  const brokerResult = brokerOutbox.txResult?.meta?.TransactionResult ??
    brokerOutbox.txResult?.engine_result ?? brokerOutbox.status
  step('broker.submit', brokerResult === 'tesSUCCESS' ? 'pass' : 'warn', `result=${brokerResult}`)

  // Wait for xrplLoanBrokerId writeback
  if (brokerResult === 'tesSUCCESS') {
    console.log('  … waiting for xrplLoanBrokerId writeback …')
    try {
      const brokerWithId = await waitBrokerId(brokerRes.loanBroker.id)
      step('broker.writeback', 'pass', `xrplLoanBrokerId=${brokerWithId.xrplLoanBrokerId}`)
    } catch (err) {
      step('broker.writeback', 'warn', err.message)
    }
  }

  // ── 7. Cover Deposit ──
  console.log('\n[7] First Loss Cover Deposit')
  const coverRes = await api('POST', `/v1/loan-brokers/${brokerRes.loanBroker.id}/cover/deposits`, {
    amount: '5000000'
  })
  step('cover.enqueue', 'pass', `outboxId=${coverRes.outbox.id}`)

  console.log('  … waiting for CoverDeposit submit …')
  const coverOutbox = await waitOutbox(coverRes.outbox.id, ['validated', 'indexed', 'reconciled'])
  const coverResult = coverOutbox.txResult?.meta?.TransactionResult ??
    coverOutbox.txResult?.engine_result ?? coverOutbox.status
  step('cover.submit', coverResult === 'tesSUCCESS' ? 'pass' : 'warn', `result=${coverResult}`)

  // ── 8. Loan ──
  console.log('\n[8] Create Loan + Cosign Packet')
  const loanRes = await api('POST', '/v1/loans', {
    loanBrokerId: brokerRes.loanBroker.id,
    borrowerAddress: accounts.borrower,
    borrowerPartyId: borrower.id,
    principal: 1000000,
    interestRate: 120000,
    paymentTotal: 12,
    paymentInterval: 2592000,
    gracePeriod: 604800,
    loanOriginationFee: 10000,
    loanServiceFee: 5000
  })
  step('loan.create', 'pass', `loanId=${loanRes.id}`)

  const cosignRes = await api('POST', `/v1/loans/${loanRes.id}/cosign-packet`)
  step('loan.cosign_packet', 'pass', `signers=${cosignRes.signingOrder?.length ?? 0}`)

  // Wait for LoanSet attempt
  console.log('  … waiting for LoanSet submit attempt …')
  const outboxItems = await api('GET', '/v1/outbox')
  const loanOutboxItem = outboxItems.find((x) =>
    x.kind === 'loan_set' && x.aggregateId === loanRes.id
  )
  if (loanOutboxItem) {
    const loanOutboxResult = await waitOutbox(loanOutboxItem.id, ['validated', 'indexed', 'reconciled', 'failed', 'blocked'])
    const loanResult = loanOutboxResult.txResult?.meta?.TransactionResult ??
      loanOutboxResult.txResult?.engine_result ?? loanOutboxResult.status
    step('loan.submit', loanResult === 'tesSUCCESS' ? 'pass' : 'warn',
      `result=${loanResult} status=${loanOutboxResult.status}`)
    if (loanOutboxResult.error) {
      step('loan.error_detail', 'warn', loanOutboxResult.error)
    }
  } else {
    step('loan.submit', 'warn', 'outbox item not found (may still be pending)')
  }

  // ── 9. Evidence chain verification ──
  console.log('\n[9] Evidence chain verification')
  const evidence = await api('GET', `/v1/evidence/vault/${vaultRes.vault.id}`)
  step('evidence.chain', evidence.verify?.valid ? 'pass' : 'warn',
    `events=${evidence.events?.length ?? 0} valid=${evidence.verify?.valid ?? false}`)

  // ── 10. Reconciliation status ──
  console.log('\n[10] Reconciliation')
  const recons = await api('GET', '/v1/reconciliation-runs?limit=20')
  const okCount = recons.filter((r) => r.outcome === 'ok').length
  const errCount = recons.filter((r) => r.outcome === 'error').length
  step('reconciliation', errCount === 0 ? 'pass' : 'warn',
    `ok=${okCount} error=${errCount} total=${recons.length}`)

  // ── 11. Transaction log ──
  console.log('\n[11] Transaction log')
  const txs = await api('GET', '/v1/transactions?limit=20')
  for (const tx of txs.slice(0, 10)) {
    console.log(`  ${tx.txType.padEnd(24)} ${tx.resultCode.padEnd(12)} ${tx.txHash?.slice(0, 16) ?? 'N/A'}...`)
  }
  step('transactions', 'pass', `recorded=${txs.length}`)

  // ── 12. Dashboard ──
  console.log('\n[12] Dashboard')
  const dash = await api('GET', '/v1/dashboard')
  console.log(`  counts: ${JSON.stringify(dash.counts)}`)
  console.log(`  outbox: ${JSON.stringify(dash.statuses?.outbox ?? {})}`)

  printSummary()
}

function printSummary() {
  console.log('\n═══════════════════════════════════════════')
  console.log(' Summary')
  console.log('═══════════════════════════════════════════')
  const pass = results.filter((r) => r.status === 'pass').length
  const fail = results.filter((r) => r.status === 'fail').length
  const warn = results.filter((r) => r.status === 'warn').length
  console.log(` ✓ pass: ${pass}  ✗ fail: ${fail}  ⚠ warn: ${warn}`)
  if (fail > 0) {
    console.log('\n Failed steps:')
    for (const r of results.filter((r) => r.status === 'fail')) {
      console.log(`   ✗ ${r.name}: ${r.detail}`)
    }
  }
  if (warn > 0) {
    console.log('\n Warnings:')
    for (const r of results.filter((r) => r.status === 'warn')) {
      console.log(`   ⚠ ${r.name}: ${r.detail}`)
    }
  }
  process.exitCode = fail > 0 ? 1 : 0
}

main().catch((err) => {
  console.error('\nFATAL:', err.message)
  printSummary()
  process.exitCode = 1
})
