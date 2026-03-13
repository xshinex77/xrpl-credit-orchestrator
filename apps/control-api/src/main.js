import { createServer } from 'node:http'
import * as crypto from 'node:crypto'
if (!globalThis.crypto) globalThis.crypto = crypto.webcrypto

import { getConfig } from './config.js'
import { createContext } from './context.js'
import { Router, AuthRoles } from './http/router.js'
import { json, text } from './http/json.js'
import { createToken, verifyPassword, assertAuthMode } from './http/auth.js'
import { verifyChain } from '../../../packages/evidence-sdk/src/index.js'
import { renderMetrics, authFailures } from '../../../packages/metrics/src/index.js'

// Block dev auth in production
assertAuthMode()

const config = getConfig()
const context = await createContext(config)
const router = new Router(context)

router.register('GET', '/health', async ({ res, context }) => {
  const db = await context.db.health()
  return json(res, 200, {
    status: 'ok',
    service: 'control-api',
    database: db,
    lendingEnabled: context.config.xrplLendingEnabled,
    network: context.config.xrplNetwork
  })
}, { auth: false })

router.register('POST', '/v1/auth/login', async ({ body, res, context }) => {
  const user = await context.db.findUserByUsername(body.username)
  if (!user || !user.isActive) return json(res, 401, { error: 'invalid_credentials' })
  if (!verifyPassword(body.password ?? '', user.passwordHash)) {
    return json(res, 401, { error: 'invalid_credentials' })
  }
  const token = createToken({ sub: user.id, username: user.username, role: user.role }, context.config.authTokenSecret, 8 * 60 * 60)
  return json(res, 200, { accessToken: token, role: user.role, username: user.username })
}, { auth: false })

router.register('GET', '/v1/dashboard', async ({ res, context }) => {
  return json(res, 200, await context.db.getDashboardSummary())
}, { roles: [AuthRoles.ADMIN, AuthRoles.OPERATOR, AuthRoles.LENDER] })

router.register('GET', '/v1/metrics', async ({ res, context }) => {
  const dashboard = await context.db.getDashboardSummary()
  return json(res, 200, {
    service: 'control-api',
    now: new Date().toISOString(),
    counts: dashboard.counts,
    statuses: dashboard.statuses,
    checkpoints: dashboard.checkpoints
  })
}, { roles: [AuthRoles.ADMIN, AuthRoles.OPERATOR] })

router.register('GET', '/v1/audit/export/:aggregateType/:aggregateId', async ({ params, res, context }) => {
  return json(res, 200, await context.services.audit.exportAggregateBundle(params.aggregateType, params.aggregateId))
}, { roles: [AuthRoles.ADMIN, AuthRoles.OPERATOR] })

router.register('GET', '/v1/borrowers', async ({ res, context }) => {
  return json(res, 200, await context.services.borrowers.list())
}, { roles: [AuthRoles.ADMIN, AuthRoles.OPERATOR, AuthRoles.LENDER] })

router.register('POST', '/v1/borrowers', async ({ body, res, auth, context }) => {
  const row = await context.services.borrowers.create(body, auth)
  return json(res, 201, row)
}, { roles: [AuthRoles.ADMIN, AuthRoles.OPERATOR] })

router.register('POST', '/v1/borrowers/:id/link-auth', async ({ body, params, res, auth, context }) => {
  const result = await context.services.borrowers.linkAuthUser(params.id, body.authUserId, auth)
  return json(res, 200, result)
}, { roles: [AuthRoles.ADMIN, AuthRoles.OPERATOR] })

router.register('GET', '/v1/vaults', async ({ res, context }) => {
  return json(res, 200, await context.services.vaults.listVaults())
}, { roles: [AuthRoles.ADMIN, AuthRoles.OPERATOR, AuthRoles.LENDER] })

router.register('POST', '/v1/vaults', async ({ body, res, auth, context }) => {
  const result = await context.services.vaults.createVault(body, auth)
  return json(res, 201, result)
}, { roles: [AuthRoles.ADMIN, AuthRoles.OPERATOR] })

router.register('POST', '/v1/vaults/:id/deposits', async ({ body, params, res, auth, context }) => {
  const result = await context.services.vaults.deposit(params.id, body, auth)
  return json(res, 202, result)
}, { roles: [AuthRoles.ADMIN, AuthRoles.OPERATOR, AuthRoles.LENDER] })

router.register('GET', '/v1/loan-brokers', async ({ res, context }) => {
  return json(res, 200, await context.services.vaults.listLoanBrokers())
}, { roles: [AuthRoles.ADMIN, AuthRoles.OPERATOR, AuthRoles.LENDER] })

router.register('POST', '/v1/loan-brokers', async ({ body, res, auth, context }) => {
  const result = await context.services.vaults.createLoanBroker(body, auth)
  return json(res, 201, result)
}, { roles: [AuthRoles.ADMIN, AuthRoles.OPERATOR] })

router.register('POST', '/v1/loan-brokers/:id/collateral/deposits', async ({ body, params, res, auth, context }) => {
  const result = await context.services.vaults.depositCollateral(params.id, body, auth)
  return json(res, 202, result)
}, { roles: [AuthRoles.ADMIN, AuthRoles.OPERATOR] })

// Legacy alias
router.register('POST', '/v1/loan-brokers/:id/cover/deposits', async ({ body, params, res, auth, context }) => {
  const result = await context.services.vaults.depositCollateral(params.id, body, auth)
  return json(res, 202, result)
}, { roles: [AuthRoles.ADMIN, AuthRoles.OPERATOR] })

router.register('POST', '/v1/loans/quote', async ({ body, res, context }) => {
  return json(res, 200, context.services.loans.quote(body))
}, { roles: [AuthRoles.ADMIN, AuthRoles.OPERATOR, AuthRoles.BORROWER, AuthRoles.LENDER] })

router.register('GET', '/v1/loans', async ({ res, auth, context }) => {
  const role = auth?.role
  const all = await context.services.loans.list()

  if (role === 'borrower') {
    // Resolve auth_user → party via explicit link
    const party = await context.db.findPartyByAuthUserId(auth.sub)
    const partyId = party?.id ?? null
    // Filter: loan's borrowerPartyId must match resolved party OR direct auth.sub
    const filtered = all.filter(l =>
      (partyId && l.borrowerPartyId === partyId) ||
      l.borrowerPartyId === auth.sub
    )
    return json(res, 200, filtered)
  }

  if (role === 'lender') {
    // Resolve lender's party for vault position matching
    const lenderParty = await context.db.findPartyByAuthUserId(auth.sub)
    const lenderPartyId = lenderParty?.id ?? null
    const vaults = await context.db.listVaults()
    const positions = await context.db.listVaultPositions()
    // Find vaults where this lender has a position
    const lenderVaultIds = new Set()
    for (const v of vaults) {
      // Check if lender has a position in this vault
      const pos = positions.find(p => p.vaultId === v.id &&
        (p.lenderAddress === auth.username || p.lenderPartyId === auth.sub || (lenderPartyId && p.lenderPartyId === lenderPartyId)))
      if (pos) lenderVaultIds.add(v.id)
    }
    if (lenderVaultIds.size === 0) return json(res, 200, [])
    // Find brokers attached to those vaults
    const brokers = await context.db.listLoanBrokers()
    const lenderBrokerIds = new Set(
      brokers.filter(b => lenderVaultIds.has(b.vaultId)).map(b => b.id)
    )
    const filtered = all.filter(l => lenderBrokerIds.has(l.loanBrokerId))
    return json(res, 200, filtered)
  }

  // admin, operator, auditor: full access
  return json(res, 200, all)
}, { roles: [AuthRoles.ADMIN, AuthRoles.OPERATOR, AuthRoles.LENDER, AuthRoles.BORROWER] })

router.register('POST', '/v1/loans', async ({ body, res, auth, context }) => {
  const row = await context.services.loans.create(body, auth)
  return json(res, 201, row)
}, { roles: [AuthRoles.ADMIN, AuthRoles.OPERATOR] })

router.register('POST', '/v1/loans/:id/cosign-packet', async ({ params, res, auth, context }) => {
  const packet = await context.services.loans.prepareCosignPacket(params.id, auth)
  return json(res, 201, packet)
}, { roles: [AuthRoles.ADMIN, AuthRoles.OPERATOR] })

router.register('POST', '/v1/loans/:id/sign/broker', async ({ body, params, res, auth, context }) => {
  const result = await context.services.loans.recordBrokerSignature(
    params.id, body.signedTxBlob, body.txHash, auth
  )
  return json(res, 200, result)
}, { roles: [AuthRoles.ADMIN, AuthRoles.OPERATOR] })

router.register('POST', '/v1/loans/:id/sign/borrower', async ({ body, params, res, auth, context }) => {
  const result = await context.services.loans.recordBorrowerSignature(
    params.id, body.counterpartySignedTxBlob, auth
  )
  return json(res, 200, result)
}, { roles: [AuthRoles.ADMIN, AuthRoles.OPERATOR, AuthRoles.BORROWER] })


router.register('GET', '/v1/outbox', async ({ req, res, context }) => {
  const url = new URL(req.url, 'http://localhost')
  const status = url.searchParams.get('status')
  const rows = await context.db.listOutbox(status)
  // Whitelist: return ONLY safe fields. Never signed blobs, txJson, or cosign material.
  const safe = rows.map(r => ({
    id: r.id,
    kind: r.kind,
    status: r.status,
    aggregateType: r.aggregateType,
    aggregateId: r.aggregateId,
    txHash: r.txHash,
    error: r.error,
    attempts: r.attempts,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt
  }))
  return json(res, 200, safe)
}, { roles: [AuthRoles.ADMIN, AuthRoles.OPERATOR] })

router.register('GET', '/v1/transactions', async ({ req, res, context }) => {
  const url = new URL(req.url, 'http://localhost')
  const limit = Number(url.searchParams.get('limit') ?? 50)
  return json(res, 200, await context.db.listTransactions(limit))
}, { roles: [AuthRoles.ADMIN, AuthRoles.OPERATOR] })

router.register('GET', '/v1/reconciliation-runs', async ({ req, res, context }) => {
  const url = new URL(req.url, 'http://localhost')
  const limit = Number(url.searchParams.get('limit') ?? 50)
  return json(res, 200, await context.db.listReconciliationRuns(limit))
}, { roles: [AuthRoles.ADMIN, AuthRoles.OPERATOR] })

router.register('GET', '/v1/evidence/:aggregateType/:aggregateId', async ({ params, res, context }) => {
  const rows = await context.evidence.list(params.aggregateType, params.aggregateId)
  return json(res, 200, { events: rows, verify: verifyChain(rows) })
}, { roles: [AuthRoles.ADMIN, AuthRoles.OPERATOR] })

router.register('GET', '/', async ({ res }) => text(res, 200, 'XRPL Credit Orchestrator control-api'), { auth: false })

router.register('GET', '/metrics/prometheus', async ({ res }) => {
  res.setHeader('Content-Type', 'text/plain; version=0.0.4')
  text(res, 200, renderMetrics())
}, { roles: [AuthRoles.ADMIN, AuthRoles.OPERATOR] })

import { createLogger } from '../../../packages/logger/src/index.js'
const apiLog = createLogger('control-api')

const server = createServer((req, res) => router.handle(req, res))
server.listen(config.port, () => {
  apiLog.info('listening', { port: config.port, network: config.xrplNetwork })
})
