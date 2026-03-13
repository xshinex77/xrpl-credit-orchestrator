import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { XrplClient } from '../packages/xrpl-client/src/index.js'

function loadDotEnv() {
  const file = path.resolve(process.cwd(), '.env')
  if (!fs.existsSync(file)) return
  const text = fs.readFileSync(file, 'utf8')
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const idx = trimmed.indexOf('=')
    if (idx == -1) continue
    const key = trimmed.slice(0, idx)
    const value = trimmed.slice(idx + 1)
    if (!(key in process.env)) process.env[key] = value
  }
}
loadDotEnv()

const url = process.env.XRPL_WS_URL ?? 'wss://s.devnet.rippletest.net:51233'
const client = new XrplClient(url)

try {
  // 1. Server info
  const info = await client.serverInfo()
  const status = info.result.info.server_state ?? info.result.info.server?.server_state
  const serverResult = {
    ok: true,
    xrplWsUrl: url,
    validatedLedger: info.result.info.validated_ledger?.seq ?? null,
    serverState: status
  }
  console.log('=== server info ===')
  console.log(JSON.stringify(serverResult, null, 2))

  // 2. Account balance check (if SEEDS_JSON configured)
  const seedsRaw = process.env.XRPL_SEEDS_JSON || process.env.SEEDS_JSON || '{}'
  try {
    const seeds = JSON.parse(seedsRaw)
    const addresses = Object.keys(seeds)
    if (addresses.length > 0) {
      console.log('\n=== account balances ===')
      for (const addr of addresses) {
        try {
          const acct = await client.request({
            command: 'account_info',
            account: addr,
            ledger_index: 'validated'
          })
          const balance = acct.result.account_data.Balance
          const xrp = (Number(balance) / 1_000_000).toFixed(6)
          const reserve = 10 // base reserve on Devnet
          const available = Math.max(0, Number(xrp) - reserve)
          console.log(JSON.stringify({
            address: addr,
            balanceDrops: balance,
            balanceXRP: xrp,
            availableXRP: available.toFixed(6),
            funded: Number(xrp) >= 200 ? 'ok' : 'low'
          }))
        } catch (e) {
          console.log(JSON.stringify({
            address: addr,
            error: e.message ?? 'unknown',
            funded: 'NOT_FOUND'
          }))
        }
      }
    }
  } catch (_) {
    // SEEDS_JSON not valid JSON, skip balance check
  }

  // 3. Amendment check for Lending/Vault features
  console.log('\n=== amendment check ===')
  try {
    const features = await client.request({ command: 'feature' })
    const featureMap = features.result.features ?? {}
    const lendingKeywords = ['vault', 'lending', 'loan', 'mpt']
    const relevant = {}
    for (const [hash, detail] of Object.entries(featureMap)) {
      const name = detail.name ?? ''
      if (lendingKeywords.some(kw => name.toLowerCase().includes(kw))) {
        relevant[name || hash] = { enabled: detail.enabled, supported: detail.supported }
      }
    }
    if (Object.keys(relevant).length > 0) {
      console.log(JSON.stringify(relevant, null, 2))
    } else {
      console.log('no vault/lending/loan/mpt amendments found in feature list')
    }
  } catch (e) {
    console.log(`amendment check skipped: ${e.message}`)
  }

} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    xrplWsUrl: url,
    error: error.message
  }, null, 2))
  process.exitCode = 1
} finally {
  await client.disconnect().catch(() => {})
}
