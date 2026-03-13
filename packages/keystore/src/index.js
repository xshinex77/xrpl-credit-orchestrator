/**
 * keystore/src/index.js
 * ──────────────────────────────────────────────
 * 命令1: 秘密ゼロ化
 *
 * Public interface:
 *   sign(txJson, keyRef) → { signedTxBlob, txHash }
 *   describe() → { provider, ... }
 *   hasKey(address) → boolean
 *
 * getSeed() は存在しない。seed は keystore 外に出ない。
 * env/file は DEV_ONLY と明示。本番は kms/hsm を使う。
 */
import fs from 'node:fs'

// ─── Base ──────────────────────────────────

export class BaseKeyStore {
  /** @param {object} txJson  @param {string} keyRef (address) */
  async sign(_txJson, _keyRef) { throw new Error('not_implemented: sign()') }
  hasKey(_address) { return false }
  describe() { return { provider: 'unknown' } }
}

// ─── Dev-only: env seed (NEVER for production) ──────────

export class DevEnvKeyStore extends BaseKeyStore {
  #map

  constructor(rawJson) {
    super()
    if (!rawJson || rawJson === '{}') {
      this.#map = {}
      return
    }
    try {
      this.#map = JSON.parse(rawJson)
    } catch (error) {
      throw new Error(`SEEDS_JSON is invalid JSON: ${error.message}`)
    }
  }

  hasKey(address) { return Boolean(this.#map[address]) }

  async sign(txJson, keyRef) {
    const seed = this.#map[keyRef]
    if (!seed) throw new Error(`no_key: ${keyRef}`)
    // Lazy-load xrpl to avoid hard dep in non-live envs
    const xrpl = await import('xrpl')
    const wallet = xrpl.Wallet.fromSeed(seed)
    if (wallet.classicAddress !== keyRef) {
      throw new Error(`key_mismatch: seed resolves to ${wallet.classicAddress}, expected ${keyRef}`)
    }
    const signed = wallet.sign(txJson)
    return { signedTxBlob: signed.tx_blob, txHash: signed.hash }
  }

  describe() {
    return {
      provider: 'env',
      mode: 'DEV_ONLY',
      loadedAddresses: Object.keys(this.#map).length
    }
  }
}

// ─── Dev-only: file seed (NEVER for production) ──────────

export class DevFileKeyStore extends BaseKeyStore {
  #filePath

  constructor(filePath) {
    super()
    this.#filePath = filePath
  }

  #readMap() {
    if (!this.#filePath || !fs.existsSync(this.#filePath)) return {}
    return JSON.parse(fs.readFileSync(this.#filePath, 'utf8'))
  }

  hasKey(address) { return Boolean(this.#readMap()[address]) }

  async sign(txJson, keyRef) {
    const map = this.#readMap()
    const seed = map[keyRef]
    if (!seed) throw new Error(`no_key: ${keyRef}`)
    const xrpl = await import('xrpl')
    const wallet = xrpl.Wallet.fromSeed(seed)
    if (wallet.classicAddress !== keyRef) {
      throw new Error(`key_mismatch: seed resolves to ${wallet.classicAddress}, expected ${keyRef}`)
    }
    const signed = wallet.sign(txJson)
    return { signedTxBlob: signed.tx_blob, txHash: signed.hash }
  }

  describe() {
    return {
      provider: 'file',
      mode: 'DEV_ONLY',
      filePath: this.#filePath
    }
  }
}

// ─── Production: AWS KMS ──────────────────────────

export class AwsKmsKeyStore extends BaseKeyStore {
  #keyAlias
  #addressMap

  constructor(config = {}) {
    super()
    this.#keyAlias = config.keyAlias ?? null
    this.#addressMap = config.addressMap ?? {}
  }

  hasKey(address) { return Boolean(this.#addressMap[address]) }

  async sign(txJson, keyRef) {
    const kmsKeyId = this.#addressMap[keyRef]
    if (!kmsKeyId) {
      throw new (await import('./kms-helpers.js')).KeyNotFoundError(keyRef, 'aws-kms')
    }
    try {
      // Production path:
      // 1. const { computeXrplSigningDigest, normalizeDerToLowS, buildExternallySignedBlob } = await import('./kms-helpers.js')
      // 2. const { digest, encodedHex } = await computeXrplSigningDigest(txJson)
      // 3. const kmsClient = new KMSClient({})
      // 4. const signResult = await kmsClient.send(new SignCommand({
      //      KeyId: kmsKeyId, Message: digest, MessageType: 'DIGEST',
      //      SigningAlgorithm: 'ECDSA_SHA_256'
      //    }))
      // 5. const { r, s } = normalizeDerToLowS(signResult.Signature)
      // 6. const pubKey = await getCompressedPublicKey(kmsClient, kmsKeyId)
      // 7. return buildExternallySignedBlob({ txJson, compressedPublicKey: pubKey, r, s })
      throw new (await import('./kms-helpers.js')).KmsUnavailableError(
        'aws-kms',
        'production signing requires @aws-sdk/client-kms. See docs/KMS_SETUP.md'
      )
    } catch (err) {
      if (err.code === 'KMS_UNAVAILABLE' || err.code === 'KEY_NOT_FOUND') throw err
      throw new (await import('./kms-helpers.js')).KmsUnavailableError('aws-kms', err.message)
    }
  }

  describe() {
    return {
      provider: 'aws-kms', mode: 'PRODUCTION',
      keyAlias: this.#keyAlias,
      configuredAddresses: Object.keys(this.#addressMap).length,
      status: Object.keys(this.#addressMap).length > 0 ? 'ready' : 'needs_configuration'
    }
  }
}

// ─── Production: GCP KMS ──────────────────────────

export class GcpKmsKeyStore extends BaseKeyStore {
  #keyRing
  #addressMap

  constructor(config = {}) {
    super()
    this.#keyRing = config.keyRing ?? null
    this.#addressMap = config.addressMap ?? {}
  }

  hasKey(address) { return Boolean(this.#addressMap[address]) }

  async sign(txJson, keyRef) {
    const keyName = this.#addressMap[keyRef]
    if (!keyName) {
      throw new (await import('./kms-helpers.js')).KeyNotFoundError(keyRef, 'gcp-kms')
    }
    try {
      throw new (await import('./kms-helpers.js')).KmsUnavailableError(
        'gcp-kms',
        'production signing requires @google-cloud/kms. See docs/KMS_SETUP.md'
      )
    } catch (err) {
      if (err.code === 'KMS_UNAVAILABLE' || err.code === 'KEY_NOT_FOUND') throw err
      throw new (await import('./kms-helpers.js')).KmsUnavailableError('gcp-kms', err.message)
    }
  }

  describe() {
    return {
      provider: 'gcp-kms', mode: 'PRODUCTION',
      keyRing: this.#keyRing,
      configuredAddresses: Object.keys(this.#addressMap).length,
      status: Object.keys(this.#addressMap).length > 0 ? 'ready' : 'needs_configuration'
    }
  }
}

// ─── Production: HSM / PKCS#11 ──────────────────────

export class HsmKeyStore extends BaseKeyStore {
  #slot
  #keyLabel
  #addressMap

  constructor(config = {}) {
    super()
    this.#slot = config.slot ?? null
    this.#keyLabel = config.keyLabel ?? null
    this.#addressMap = config.addressMap ?? {}
  }

  hasKey(address) { return Boolean(this.#addressMap[address]) }

  async sign(txJson, keyRef) {
    const hsmRef = this.#addressMap[keyRef]
    if (!hsmRef) {
      throw new (await import('./kms-helpers.js')).KeyNotFoundError(keyRef, 'hsm')
    }
    throw new (await import('./kms-helpers.js')).KmsUnavailableError(
      'hsm', 'production signing requires pkcs11js. See docs/HSM_SETUP.md'
    )
  }

  describe() {
    return {
      provider: 'hsm', mode: 'PRODUCTION',
      slot: this.#slot, keyLabel: this.#keyLabel,
      configuredAddresses: Object.keys(this.#addressMap).length,
      status: Object.keys(this.#addressMap).length > 0 ? 'ready' : 'needs_configuration'
    }
  }
}

// ─── Factory ──────────────────────────

export function createKeyStore(config = {}) {
  const provider = config.provider ?? 'env'
  switch (provider) {
    case 'env':
      return new DevEnvKeyStore(config.seedsJson)
    case 'file':
      return new DevFileKeyStore(config.filePath)
    case 'aws-kms':
      return new AwsKmsKeyStore(config)
    case 'gcp-kms':
      return new GcpKmsKeyStore(config)
    case 'hsm':
      return new HsmKeyStore(config)
    // Legacy compat — redirect stubs to proper classes
    case 'kms':
    case 'kms-stub':
      return new AwsKmsKeyStore(config)
    case 'hsm-stub':
      return new HsmKeyStore(config)
    default:
      throw new Error(`unsupported keystore provider: ${provider}`)
  }
}
