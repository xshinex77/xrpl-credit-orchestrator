#!/usr/bin/env node
/**
 * env-check.js
 * ──────────────────────────────────────────────
 * .env の live submit 準備状態を包括的にチェック。
 * worker config.js 系（XRPL_*）と旧系（SIGNER_*）の
 * 二重定義も検出して警告する。
 */
import fs from 'node:fs'
import path from 'node:path'

const envPath = path.resolve(process.cwd(), '.env')
if (!fs.existsSync(envPath)) {
  console.error('✗ missing .env file')
  process.exit(1)
}

const text = fs.readFileSync(envPath, 'utf8')
const env = {}
for (const line of text.split(/\r?\n/)) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) continue
  const idx = trimmed.indexOf('=')
  if (idx === -1) continue
  env[trimmed.slice(0, idx)] = trimmed.slice(idx + 1)
}

let hasError = false
let hasWarning = false

function fail(msg) { console.error(`✗ ${msg}`); hasError = true }
function warn(msg) { console.warn(`⚠ ${msg}`); hasWarning = true }
function ok(msg) { console.log(`✓ ${msg}`) }

// ── 1. Required keys ──
const required = [
  'XRPL_WS_URL',
  'XRPL_LENDING_ENABLED',
  'LEDGER_WORKER_DRY_RUN'
]
for (const key of required) {
  if (!env[key]) fail(`missing required: ${key}`)
}

// ── 2. Signer provider (normalize both naming conventions) ──
const signerProvider = env.XRPL_SIGNER_PROVIDER ?? env.SIGNER_PROVIDER ?? null
if (!signerProvider) {
  fail('missing signer provider (set XRPL_SIGNER_PROVIDER or SIGNER_PROVIDER)')
} else {
  ok(`signer provider: ${signerProvider}`)
}

// ── 3. Check dual-key consistency ──
const dualKeys = [
  ['XRPL_SIGNER_PROVIDER', 'SIGNER_PROVIDER'],
  ['XRPL_SEEDS_JSON', 'SEEDS_JSON'],
  ['XRPL_SEED_FILE', 'SIGNER_SEED_FILE']
]
for (const [a, b] of dualKeys) {
  if (env[a] && env[b] && env[a] !== env[b]) {
    warn(`${a} and ${b} have different values — worker and env-check may disagree`)
  }
  if (env[a] && !env[b]) {
    warn(`${a} is set but ${b} is not — env-check may not see signer material`)
  }
  if (!env[a] && env[b]) {
    warn(`${b} is set but ${a} is not — worker may not see signer material`)
  }
}

// ── 4. Live submit checks ──
const isLive = env.LEDGER_WORKER_DRY_RUN === 'false'
const isLendingEnabled = env.XRPL_LENDING_ENABLED === 'true'

if (isLive) {
  ok('LEDGER_WORKER_DRY_RUN=false (live mode)')

  const seedsJson = env.XRPL_SEEDS_JSON ?? env.SEEDS_JSON ?? '{}'
  const seedFile = env.XRPL_SEED_FILE ?? env.SIGNER_SEED_FILE ?? ''
  const kmsVendor = env.XRPL_KMS_VENDOR ?? env.SIGNER_KMS_VENDOR ?? ''
  const hsmSlot = env.XRPL_HSM_SLOT ?? env.SIGNER_HSM_SLOT ?? ''

  let signerOk = false
  if (signerProvider === 'env') {
    try {
      const parsed = JSON.parse(seedsJson)
      const count = Object.keys(parsed).length
      if (count > 0) {
        ok(`env signer (DEV ONLY): ${count} address(es) loaded`)
        signerOk = true
      } else {
        fail('SEEDS_JSON is empty object — no signing keys')
      }
    } catch (e) {
      fail(`SEEDS_JSON is invalid JSON: ${e.message}`)
    }
  } else if (signerProvider === 'file') {
    if (seedFile && fs.existsSync(seedFile)) {
      ok(`file signer (DEV ONLY): ${seedFile}`)
      signerOk = true
    } else {
      fail(`SEED_FILE not found: ${seedFile || '(empty)'}`)
    }
  } else if (['aws-kms', 'gcp-kms', 'kms', 'kms-stub'].includes(signerProvider)) {
    ok(`KMS signer: provider=${signerProvider}`)
    signerOk = true
  } else if (['hsm', 'hsm-stub'].includes(signerProvider)) {
    ok(`HSM signer: provider=${signerProvider}`)
    signerOk = true
  }

  if (!signerOk) fail('live submit requested but no valid signer material configured')
} else {
  ok('LEDGER_WORKER_DRY_RUN=true (dry run mode)')
}

if (isLendingEnabled) {
  ok('XRPL_LENDING_ENABLED=true')
} else {
  warn('XRPL_LENDING_ENABLED is not true — all tx will be BLOCKED')
}

// ── 5. Auth ──
if (env.AUTH_TOKEN_SECRET === 'replace-me' || env.AUTH_TOKEN_SECRET === 'dev-secret') {
  warn('AUTH_TOKEN_SECRET is default value — change for any non-local deployment')
}

// ── 6. Database ──
if (env.DATABASE_URL) {
  ok(`database: ${env.DATABASE_URL.replace(/:[^@]+@/, ':***@')}`)
} else {
  warn('DATABASE_URL not set — will fallback to in-memory database')
}

// ── Summary ──
console.log('')
if (hasError) {
  console.error('env check FAILED — fix errors above before proceeding')
  process.exit(2)
} else if (hasWarning) {
  console.log('env check passed with warnings')
} else {
  console.log('env check passed — all clear')
}
