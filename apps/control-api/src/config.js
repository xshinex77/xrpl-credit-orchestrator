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

function requireEnv(name) {
  const v = process.env[name]
  if (!v) throw new Error(`MISSING_ENV: ${name} is required. Set it in .env or environment.`)
  return v
}

export function getConfig() {
  const nodeEnv = process.env.NODE_ENV ?? 'development'
  return {
    port: Number(process.env.PORT ?? 3000),
    nodeEnv,
    databaseUrl: process.env.DATABASE_URL ?? '',
    authTokenSecret: nodeEnv === 'production' ? requireEnv('AUTH_TOKEN_SECRET') : (process.env.AUTH_TOKEN_SECRET || 'dev-secret-NOT-FOR-PRODUCTION'),
    devAdminUsername: process.env.DEV_ADMIN_USERNAME ?? 'admin',
    devAdminPassword: nodeEnv === 'production' ? requireEnv('DEV_ADMIN_PASSWORD') : (process.env.DEV_ADMIN_PASSWORD || 'dev-only-change-me'),
    xrplWsUrl: process.env.XRPL_WS_URL ?? 'wss://s.devnet.rippletest.net:51233',
    xrplNetwork: process.env.XRPL_NETWORK ?? 'devnet',
    xrplLendingEnabled: process.env.XRPL_LENDING_ENABLED === 'true',
    rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60000),
    rateLimitMax: Number(process.env.RATE_LIMIT_MAX ?? 120),
  }
}
