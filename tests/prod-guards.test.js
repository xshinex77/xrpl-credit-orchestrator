import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { assertAuthMode } from '../apps/control-api/src/http/auth.js'

describe('production auth guard', () => {
  it('assertAuthMode throws in production', () => {
    const prev = process.env.NODE_ENV
    try {
      process.env.NODE_ENV = 'production'
      assert.throws(() => assertAuthMode(), /FATAL.*dev-only/)
    } finally {
      process.env.NODE_ENV = prev
    }
  })

  it('assertAuthMode does not throw in development', () => {
    const prev = process.env.NODE_ENV
    try {
      process.env.NODE_ENV = 'development'
      assert.doesNotThrow(() => assertAuthMode())
    } finally {
      process.env.NODE_ENV = prev
    }
  })
})

describe('DB fail-closed in production', () => {
  it('createDatabase throws in production without DATABASE_URL', async () => {
    const prev = process.env.NODE_ENV
    try {
      process.env.NODE_ENV = 'production'
      const { createDatabase } = await import('../apps/control-api/src/db/index.js')
      await assert.rejects(
        () => createDatabase({ nodeEnv: 'production' }),
        /FATAL.*DATABASE_URL.*required/
      )
    } finally {
      process.env.NODE_ENV = prev
    }
  })
})
