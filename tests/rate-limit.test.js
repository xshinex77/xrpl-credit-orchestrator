import test from 'node:test'
import assert from 'node:assert/strict'
import { createRateLimiter } from '../apps/control-api/src/http/rate-limit.js'

test('rate limiter blocks after threshold', () => {
  const limiter = createRateLimiter({ windowMs: 1000, max: 2 })
  assert.equal(limiter.check('ip').allowed, true)
  assert.equal(limiter.check('ip').allowed, true)
  assert.equal(limiter.check('ip').allowed, false)
})
