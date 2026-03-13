/**
 * packages/logger/src/index.js
 * ──────────────────────────────────────────────
 * 命令1: ログから秘密情報を完全排除
 *
 * 使い方:
 *   import { createLogger } from '../../../packages/logger/src/index.js'
 *   const log = createLogger('control-api')
 *   log.info('started', { port: 3000 })
 *   log.error('fail', { seed: 'sXXX...' }) // → seed は [REDACTED] になる
 */

const REDACT_KEYS = new Set([
  'seed', 'secret', 'mnemonic', 'private_key', 'privateKey',
  'password', 'passwordHash', 'password_hash',
  'TxnSignature', 'tx_blob', 'signedTxBlob', 'SigningPubKey',
  'accessToken', 'token', 'authorization',
  'XRPL_SEEDS_JSON', 'SEEDS_JSON', 'AUTH_TOKEN_SECRET'
])

const REDACT_PATTERNS = [
  /s[A-Za-z0-9]{28,}/g,      // XRPL seed pattern
  /secret["\s:=]+[^\s,"}{]+/gi // generic secret in logs
]

function redactValue(key, value) {
  if (typeof value === 'string' && REDACT_KEYS.has(key)) {
    if (value.length <= 4) return '[REDACTED]'
    return value.slice(0, 3) + '...[REDACTED]'
  }
  return value
}

function redactObject(obj, depth = 0) {
  if (depth > 10) return '[MAX_DEPTH]'
  if (obj === null || obj === undefined) return obj
  if (typeof obj === 'string') {
    let s = obj
    for (const pattern of REDACT_PATTERNS) {
      s = s.replace(pattern, '[REDACTED]')
    }
    return s
  }
  if (Array.isArray(obj)) return obj.map(v => redactObject(v, depth + 1))
  if (typeof obj === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(obj)) {
      out[k] = REDACT_KEYS.has(k)
        ? redactValue(k, v)
        : redactObject(v, depth + 1)
    }
    return out
  }
  return obj
}

function formatLog(level, service, msg, data, traceId) {
  return JSON.stringify({
    ts: new Date().toISOString(),
    level,
    service,
    msg,
    ...(traceId ? { traceId } : {}),
    ...(data ? { data: redactObject(data) } : {})
  })
}

export function createLogger(service, options = {}) {
  const isDev = options.env === 'development' || process.env.NODE_ENV === 'development'
  let currentTraceId = null

  return {
    setTraceId(id) { currentTraceId = id },
    getTraceId() { return currentTraceId },

    info(msg, data) {
      const line = formatLog('info', service, msg, data, currentTraceId)
      if (isDev) console.log(line)
      else process.stdout.write(line + '\n')
    },
    warn(msg, data) {
      const line = formatLog('warn', service, msg, data, currentTraceId)
      if (isDev) console.warn(line)
      else process.stderr.write(line + '\n')
    },
    error(msg, data) {
      const line = formatLog('error', service, msg, data, currentTraceId)
      if (isDev) console.error(line)
      else process.stderr.write(line + '\n')
    },
    audit(msg, data) {
      // Audit logs always go to stderr and are never suppressed
      const line = formatLog('audit', service, msg, data, currentTraceId)
      process.stderr.write(line + '\n')
    }
  }
}

export { redactObject, REDACT_KEYS }
