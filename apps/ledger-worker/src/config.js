import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

function loadDotEnv() {
  const candidates = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '../../.env')
  ]
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue
    const text = fs.readFileSync(file, 'utf8')
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const idx = trimmed.indexOf('=')
      if (idx === -1) continue
      const key = trimmed.slice(0, idx)
      const value = trimmed.slice(idx + 1)
      if (!(key in process.env)) process.env[key] = value
    }
  }
}
loadDotEnv()

export function getWorkerConfig() {
  const nodeEnv = process.env.NODE_ENV ?? 'development'
  return {
    databaseUrl: process.env.DATABASE_URL ?? '',
    xrplWsUrl: process.env.XRPL_WS_URL ?? 'wss://s.devnet.rippletest.net:51233',
    xrplNetwork: process.env.XRPL_NETWORK ?? 'devnet',
    xrplLendingEnabled: process.env.XRPL_LENDING_ENABLED === 'true',
    dryRun: process.env.LEDGER_WORKER_DRY_RUN !== 'false',
    pollMs: Number(process.env.LEDGER_WORKER_POLL_MS ?? 5000),
    batchSize: Number(process.env.LEDGER_WORKER_BATCH_SIZE ?? 5),
    authTokenSecret: process.env.AUTH_TOKEN_SECRET ?? (nodeEnv === 'production' ? undefined : 'dev-secret-NOT-FOR-PRODUCTION'),
    devAdminUsername: process.env.DEV_ADMIN_USERNAME ?? 'admin',
    devAdminPassword: process.env.DEV_ADMIN_PASSWORD ?? (nodeEnv === 'production' ? undefined : 'dev-only-change-me'),
    signerProvider: process.env.XRPL_SIGNER_PROVIDER ?? process.env.SIGNER_PROVIDER ?? 'env',
    seedsJson: process.env.XRPL_SEEDS_JSON ?? process.env.SEEDS_JSON ?? '{}',
    signerSeedFile: process.env.XRPL_SEED_FILE ?? process.env.SIGNER_SEED_FILE ?? '',
    signerKmsVendor: process.env.XRPL_KMS_VENDOR ?? process.env.SIGNER_KMS_VENDOR ?? '',
    signerKmsKeyAlias: process.env.XRPL_KMS_KEY_ALIAS ?? process.env.SIGNER_KMS_KEY_ALIAS ?? '',
    signerHsmSlot: process.env.XRPL_HSM_SLOT ?? process.env.SIGNER_HSM_SLOT ?? '',
    signerHsmKeyLabel: process.env.XRPL_HSM_KEY_LABEL ?? process.env.SIGNER_HSM_KEY_LABEL ?? ''
  }
}
