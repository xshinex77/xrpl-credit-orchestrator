import { MemoryDatabase } from './memory.js'
import { PgDatabase } from './pg.js'
import { createLogger } from '../../../../packages/logger/src/index.js'

const log = createLogger('db')

export async function createDatabase(config) {
  const isProduction = (config.nodeEnv ?? process.env.NODE_ENV) === 'production'

  if (config.databaseUrl) {
    try {
      return await PgDatabase.create(config)
    } catch (error) {
      if (isProduction) {
        // NEVER fall back to MemoryDatabase in production — fail closed
        log.error('pg_connect_fatal', { error: error.message })
        throw new Error(`FATAL: PostgreSQL connection failed in production. Refusing to start with in-memory database. Error: ${error.message}`)
      }
      log.warn('pg_fallback_dev', { error: error.message })
    }
  } else if (isProduction) {
    throw new Error('FATAL: DATABASE_URL is required in production.')
  }

  log.warn('using_memory_db', { reason: 'development mode — data is volatile and will not persist' })
  return new MemoryDatabase(config)
}
