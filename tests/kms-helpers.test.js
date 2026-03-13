import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeDerToLowS, KmsUnavailableError, KeyNotFoundError, SignatureInvalidError, KeyMismatchError } from '../packages/keystore/src/kms-helpers.js'

describe('kms-helpers: DER low-S normalization', () => {
  it('parses valid DER signature', () => {
    // Minimal valid DER: 30 44 02 20 <32 bytes r> 02 20 <32 bytes s>
    const r = Buffer.alloc(32, 0x01)
    const s = Buffer.alloc(32, 0x02)
    const der = Buffer.from([
      0x30, 0x44,
      0x02, 0x20, ...r,
      0x02, 0x20, ...s
    ])
    const result = normalizeDerToLowS(der)
    assert.equal(result.r.length, 64)
    assert.equal(result.s.length, 64)
  })

  it('throws on non-DER input', () => {
    assert.throws(() => normalizeDerToLowS(Buffer.from([0x00, 0x01])), /not DER/)
  })
})

describe('kms-helpers: error classes', () => {
  it('KmsUnavailableError has correct code', () => {
    const err = new KmsUnavailableError('aws-kms', 'connection failed')
    assert.equal(err.code, 'KMS_UNAVAILABLE')
    assert.equal(err.provider, 'aws-kms')
    assert.ok(err.message.includes('aws-kms'))
  })

  it('KeyNotFoundError has correct code', () => {
    const err = new KeyNotFoundError('rAddr', 'aws-kms')
    assert.equal(err.code, 'KEY_NOT_FOUND')
    assert.equal(err.keyRef, 'rAddr')
  })

  it('SignatureInvalidError has correct code', () => {
    const err = new SignatureInvalidError('bad format')
    assert.equal(err.code, 'SIGNATURE_INVALID')
  })

  it('KeyMismatchError has correct code', () => {
    const err = new KeyMismatchError('rExpected', 'rActual')
    assert.equal(err.code, 'KEY_MISMATCH')
  })
})
