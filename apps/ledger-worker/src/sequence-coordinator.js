/**
 * sequence-coordinator.js — FINAL
 * ──────────────────────────────────────────────
 * Critical #2: lease_expires_at で worker crash 時の reservation 残留を解決
 *
 * PG: pg_advisory_xact_lock + lease_expires_at
 * Memory: per-account promise chain + TTL
 */

const LEASE_TTL_MS = 30_000 // 30 seconds — if worker crashes, lease expires

// ─── Memory coordinator ──────

const localCache = new Map() // account → { seq, expiresAt }
const localLocks = new Map()

function createMemoryCoordinator({ xrpl }) {
  return {
    async withAccountSequence(account, fn) {
      const prev = localLocks.get(account) ?? Promise.resolve()
      const current = prev.then(async () => {
        const cached = localCache.get(account)
        let seq

        // If cached AND not expired, use it
        if (cached && cached.expiresAt > Date.now()) {
          seq = cached.seq
        } else {
          // Fetch fresh from ledger
          await xrpl.connect()
          const acct = await xrpl.request({
            command: 'account_info', account, ledger_index: 'current'
          })
          seq = acct.result?.account_data?.Sequence
          if (typeof seq !== 'number') throw new Error(`sequence_unavailable: ${account}`)
        }

        // Reserve with TTL
        localCache.set(account, { seq: seq + 1, expiresAt: Date.now() + LEASE_TTL_MS })
        return fn(seq)
      }).catch(err => { throw err })

      localLocks.set(account, current.catch(() => {}))
      return current
    },

    invalidate(account) { localCache.delete(account) },
    invalidateAll() { localCache.clear() }
  }
}

// ─── PG coordinator ──────

function createPgCoordinator({ xrpl, db }) {
  return {
    async withAccountSequence(account, fn) {
      if (typeof db.reserveAccountSequence === 'function') {
        const reserved = await db.reserveAccountSequence(account, async (chainSeq) => {
          if (chainSeq === null) {
            await xrpl.connect()
            const acct = await xrpl.request({
              command: 'account_info', account, ledger_index: 'current'
            })
            const seq = acct.result?.account_data?.Sequence
            if (typeof seq !== 'number') throw new Error(`sequence_unavailable: ${account}`)
            return seq
          }
          return chainSeq
        })
        return fn(reserved)
      }
      return createMemoryCoordinator({ xrpl }).withAccountSequence(account, fn)
    },

    invalidate(account) {
      if (typeof db.forgetAccountSequence === 'function') {
        db.forgetAccountSequence(account).catch(() => {})
      }
      localCache.delete(account)
    },

    invalidateAll() { localCache.clear() }
  }
}

export function createSequenceCoordinator({ xrpl, db }) {
  if (typeof db?.reserveAccountSequence === 'function') {
    return createPgCoordinator({ xrpl, db })
  }
  return createMemoryCoordinator({ xrpl })
}
