import { createHmac, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'
import { Roles } from '../../../../packages/shared-types/src/index.js'

const DEV_SALT = 'xco-static-dev-salt'

/**
 * PRODUCTION GUARD: This auth module is dev-only.
 * Call assertAuthMode() at startup to block production use.
 */
export function assertAuthMode() {
  const env = process.env.NODE_ENV ?? 'development'
  if (env === 'production') {
    throw new Error(
      'FATAL: dev-only auth module cannot run in production. ' +
      'Replace with OIDC/OAuth2 provider, per-user salted hashing, and proper token management. ' +
      'See docs/SECURITY.md'
    )
  }
}

function base64urlEncode(input) {
  return Buffer.from(input).toString('base64url')
}
function base64urlDecode(input) {
  return Buffer.from(input, 'base64url').toString('utf8')
}

export function hashPassword(password, salt = DEV_SALT) {
  return scryptSync(password, salt, 64).toString('hex')
}

export function verifyPassword(password, expectedHash) {
  const actual = hashPassword(password)
  return timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expectedHash, 'hex'))
}

export function createToken(payload, secret, expiresInSeconds = 3600) {
  const header = base64urlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = base64urlEncode(JSON.stringify({
    ...payload,
    jti: randomUUID(),
    exp: Math.floor(Date.now() / 1000) + expiresInSeconds
  }))
  const signature = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url')
  return `${header}.${body}.${signature}`
}

export function verifyToken(token, secret) {
  const [header, body, signature] = String(token || '').split('.')
  if (!header || !body || !signature) throw new Error('invalid token format')
  const expected = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url')
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    throw new Error('invalid token signature')
  }
  const payload = JSON.parse(base64urlDecode(body))
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('token expired')
  }
  return payload
}

export function extractBearer(req) {
  const header = req.headers.authorization || ''
  if (!header.startsWith('Bearer ')) return null
  return header.slice('Bearer '.length)
}

export function isRoleAllowed(actualRole, allowedRoles) {
  if (allowedRoles.includes(actualRole)) return true
  // Legacy compat: old role names still accepted
  const legacyMap = { admin: 'platform_admin', operator: 'risk_operator' }
  const normalized = legacyMap[actualRole] ?? actualRole
  return allowedRoles.includes(normalized)
}

export const DefaultUsers = Object.freeze([
  { username: 'admin', role: Roles.ADMIN },
  { username: 'risk_ops', role: Roles.RISK_OPERATOR },
  { username: 'ledger_ops', role: Roles.LEDGER_OPERATOR },
  { username: 'auditor', role: Roles.AUDITOR },
  { username: 'lender', role: Roles.LENDER },
  { username: 'borrower', role: Roles.BORROWER }
])
