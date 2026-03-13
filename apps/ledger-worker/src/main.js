import { getWorkerConfig } from './config.js'
import { createDatabase } from '../../control-api/src/db/index.js'
import { XrplClient } from '../../../packages/xrpl-client/src/index.js'
import { buildExecutor } from './tx-executor.js'
import { runLedgerIndexer } from './runs/ledger-indexer.js'
import { runReconciliation } from './runs/reconciliation.js'
import { createLogger } from '../../../packages/logger/src/index.js'
import { workerTickLatency, outboxQueueSize, networkAmendmentBlocked, networkFeeSpikeActive } from '../../../packages/metrics/src/index.js'

const config = getWorkerConfig()
const log = createLogger('ledger-worker')
const db = await createDatabase(config)
const xrpl = new XrplClient(config.xrplWsUrl)
const executor = buildExecutor({ config, db, xrpl })

log.info('starting', { dryRun: config.dryRun, network: config.xrplNetwork, lending: config.xrplLendingEnabled })
log.info('signer', executor.describeSigner())

let tickCount = 0
let consecutiveErrors = 0
let tickRunning = false
const MAX_CONSECUTIVE_ERRORS = 10

async function tick() {
  if (tickRunning) return
  tickRunning = true
  tickCount++
  const t0 = Date.now()
  try {
    await executor.processPending()
    await runLedgerIndexer({ config, db, xrpl })
    await runReconciliation({ config, db, xrpl })
    consecutiveErrors = 0

    const elapsed = (Date.now() - t0) / 1000
    workerTickLatency.observe({}, elapsed)
    try {
      const pending = await db.listOutbox('pending')
      outboxQueueSize.set({}, pending.length)
    } catch {}
    const ns = executor.getNetworkStatus()
    networkAmendmentBlocked.set({}, ns?.network?.amendmentBlocked ? 1 : 0)
    networkFeeSpikeActive.set({}, ns?.fee?.feeSpike ? 1 : 0)

    if (tickCount % 60 === 0) {
      log.info('tick', { tick: tickCount, elapsedMs: Date.now() - t0 })
    }
  } catch (error) {
    consecutiveErrors++
    log.error('tick_failed', { tick: tickCount, consecutive: consecutiveErrors, error: error.message })
    if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
      try {
        await xrpl.reconnect()
        log.info('reconnected')
        consecutiveErrors = 0
      } catch (reconnErr) {
        log.error('reconnect_failed', { error: reconnErr.message })
      }
    }
  } finally {
    tickRunning = false
  }
}

await tick()
const interval = setInterval(tick, config.pollMs)

async function shutdown(signal) {
  log.info('shutdown', { signal })
  clearInterval(interval)
  try { await xrpl.disconnect() } catch {}
  process.exit(0)
}
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
