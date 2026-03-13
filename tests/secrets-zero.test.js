import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createKeyStore, DevEnvKeyStore, AwsKmsKeyStore, HsmKeyStore } from '../packages/keystore/src/index.js'
import { redactObject, REDACT_KEYS } from '../packages/logger/src/index.js'

describe('命令1: keystore sign() only interface', () => {
  it('DevEnvKeyStore has no getSeed method', () => {
    const store = new DevEnvKeyStore('{"rTest":"sTest"}')
    assert.equal(typeof store.getSeed, 'undefined')
    assert.equal(typeof store.sign, 'function')
    assert.equal(typeof store.hasKey, 'function')
  })

  it('DevEnvKeyStore.hasKey works', () => {
    const store = new DevEnvKeyStore('{"rAddr1":"sSeed1","rAddr2":"sSeed2"}')
    assert.equal(store.hasKey('rAddr1'), true)
    assert.equal(store.hasKey('rAddr2'), true)
    assert.equal(store.hasKey('rNope'), false)
  })

  it('DevEnvKeyStore.describe shows DEV_ONLY', () => {
    const store = new DevEnvKeyStore('{"rAddr1":"sSeed1"}')
    const desc = store.describe()
    assert.equal(desc.mode, 'DEV_ONLY')
    assert.equal(desc.loadedAddresses, 1)
  })

  it('AwsKmsKeyStore.describe shows PRODUCTION', () => {
    const store = new AwsKmsKeyStore({ keyAlias: 'test-key', addressMap: { rAddr: 'arn:aws:kms:...' } })
    assert.equal(store.describe().mode, 'PRODUCTION')
    assert.equal(store.describe().configuredAddresses, 1)
    assert.equal(store.hasKey('rAddr'), true)
  })

  it('AwsKmsKeyStore.sign throws requiring real integration', async () => {
    const store = new AwsKmsKeyStore({ addressMap: { rAddr: 'arn:...' } })
    await assert.rejects(() => store.sign({}, 'rAddr'), /kms_unavailable|KMS_UNAVAILABLE/)
  })

  it('HsmKeyStore.sign throws requiring real integration', async () => {
    const store = new HsmKeyStore({ addressMap: { rAddr: 'slot:1' } })
    await assert.rejects(() => store.sign({}, 'rAddr'), /kms_unavailable|KMS_UNAVAILABLE/)
  })

  it('createKeyStore factory handles all providers', () => {
    assert.ok(createKeyStore({ provider: 'env', seedsJson: '{}' }))
    assert.ok(createKeyStore({ provider: 'aws-kms' }))
    assert.ok(createKeyStore({ provider: 'gcp-kms' }))
    assert.ok(createKeyStore({ provider: 'hsm' }))
    assert.ok(createKeyStore({ provider: 'kms-stub' })) // legacy compat
    assert.throws(() => createKeyStore({ provider: 'invalid' }))
  })
})

describe('命令1: redaction logger', () => {
  it('redacts seed values', () => {
    const result = redactObject({ seed: 'sEdABCD1234567890' })
    assert.ok(result.seed.includes('[REDACTED]'))
    assert.ok(!result.seed.includes('1234567890'))
  })

  it('redacts XRPL_SEEDS_JSON', () => {
    const result = redactObject({ XRPL_SEEDS_JSON: '{"rAddr":"sSeed"}' })
    assert.ok(result.XRPL_SEEDS_JSON.includes('[REDACTED]'))
  })

  it('redacts TxnSignature', () => {
    const result = redactObject({ TxnSignature: 'AABBCCDD...' })
    assert.ok(result.TxnSignature.includes('[REDACTED]'))
  })

  it('redacts nested objects', () => {
    const result = redactObject({ outer: { inner: { password: 'secret123' } } })
    assert.ok(result.outer.inner.password.includes('[REDACTED]'))
  })

  it('does not redact safe keys', () => {
    const result = redactObject({ status: 'ok', count: 42 })
    assert.equal(result.status, 'ok')
    assert.equal(result.count, 42)
  })

  it('redacts XRPL seed patterns in strings', () => {
    const result = redactObject('Found seed sEdABCD123456789012345678901234')
    assert.ok(result.includes('[REDACTED]'))
  })
})
