const buckets = new Map()
const CLEANUP_INTERVAL_MS = 60_000
const MAX_BUCKETS = 100_000 // hard cap to prevent memory abuse

function nowMs() { return Date.now() }

// Periodic cleanup of expired entries
let lastCleanup = nowMs()

function cleanup(windowMs) {
  const now = nowMs()
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return
  lastCleanup = now
  for (const [key, entry] of buckets) {
    if (now - entry.windowStart >= windowMs * 2) {
      buckets.delete(key)
    }
  }
}

export function createRateLimiter({ windowMs = 60_000, max = 120 } = {}) {
  return {
    check(key) {
      cleanup(windowMs)
      const current = nowMs()

      // Hard cap: if too many unique keys, reject (DoS protection)
      if (buckets.size >= MAX_BUCKETS && !buckets.has(key)) {
        return { allowed: false, remaining: 0, resetAt: current + windowMs }
      }

      const entry = buckets.get(key)
      if (!entry || current - entry.windowStart >= windowMs) {
        const next = { count: 1, windowStart: current }
        buckets.set(key, next)
        return { allowed: true, remaining: max - 1, resetAt: next.windowStart + windowMs }
      }
      if (entry.count >= max) {
        return { allowed: false, remaining: 0, resetAt: entry.windowStart + windowMs }
      }
      entry.count += 1
      return { allowed: true, remaining: Math.max(0, max - entry.count), resetAt: entry.windowStart + windowMs }
    }
  }
}
