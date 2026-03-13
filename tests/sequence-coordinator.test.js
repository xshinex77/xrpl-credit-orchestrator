import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryDatabase } from '../apps/control-api/src/db/memory.js'

describe('sequence coordinator via MemoryDatabase', () => {
  it('reserveAccountSequence returns incrementing sequences', async () => {
    const db = new MemoryDatabase({ devAdminUsername: 'admin', devAdminPassword: 'test' })
    const seq1 = await db.reserveAccountSequence('rTest', async () => 100)
    const seq2 = await db.reserveAccountSequence('rTest', async () => 999)
    const seq3 = await db.reserveAccountSequence('rTest', async () => 999)
    assert.equal(seq1, 100)
    assert.equal(seq2, 101) // second call uses cached, ignores ledger fetch
    assert.equal(seq3, 102)
  })

  it('forgetAccountSequence resets cache', async () => {
    const db = new MemoryDatabase({ devAdminUsername: 'admin', devAdminPassword: 'test' })
    await db.reserveAccountSequence('rTest', async () => 50)
    await db.forgetAccountSequence('rTest')
    const seq = await db.reserveAccountSequence('rTest', async () => 200)
    assert.equal(seq, 200) // re-fetched from ledger
  })

  it('different accounts are independent', async () => {
    const db = new MemoryDatabase({ devAdminUsername: 'admin', devAdminPassword: 'test' })
    const s1 = await db.reserveAccountSequence('rA', async () => 10)
    const s2 = await db.reserveAccountSequence('rB', async () => 20)
    const s3 = await db.reserveAccountSequence('rA', async () => 999)
    assert.equal(s1, 10)
    assert.equal(s2, 20)
    assert.equal(s3, 11)
  })
})
