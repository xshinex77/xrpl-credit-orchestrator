/**
 * packages/keystore/src/kms-helpers.js — FINAL
 * ──────────────────────────────────────────────
 * - computeXrplSigningDigest: tx JSON → SHA512Half digest
 * - normalizeDerToLowS: DER → low-S canonical r,s hex
 * - derEncodeSignature: r,s hex → DER hex for TxnSignature
 * - buildExternallySignedBlob: assemble signed blob + real tx hash
 * - extractCompressedPublicKeyFromSpki: SPKI DER → 33-byte compressed pubkey
 * - deriveXrplAddress: compressed pubkey hex → rAddress
 * - Error classes: KmsUnavailableError, SignatureInvalidError, KeyNotFoundError, KeyMismatchError
 */
import { createHash } from 'node:crypto'

// ─── XRPL signing digest ──────

export async function computeXrplSigningDigest(txJson) {
  const xrpl = await loadXrplOrThrow()
  const encodedHex = xrpl.encode(txJson)
  const HASH_PREFIX_SIGN = Buffer.from('53545800', 'hex')
  const txBytes = Buffer.from(encodedHex, 'hex')
  const sha512 = createHash('sha512').update(Buffer.concat([HASH_PREFIX_SIGN, txBytes])).digest()
  return { digest: sha512.subarray(0, 32), encodedHex }
}

// ─── DER parsing + low-S normalization ──────

const SECP256K1_N = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141')
const SECP256K1_HALF_N = SECP256K1_N / 2n

export function normalizeDerToLowS(derSig) {
  if (!(derSig instanceof Buffer || derSig instanceof Uint8Array)) {
    throw new SignatureInvalidError('input must be Buffer')
  }
  if (derSig[0] !== 0x30) throw new SignatureInvalidError('not DER: missing 0x30 header')

  let offset = 2
  if (derSig[1] & 0x80) offset++ // long form length

  if (derSig[offset] !== 0x02) throw new SignatureInvalidError('R: missing 0x02 tag')
  offset++
  const rLen = derSig[offset++]
  const rBytes = derSig.subarray(offset, offset + rLen)
  offset += rLen

  if (derSig[offset] !== 0x02) throw new SignatureInvalidError('S: missing 0x02 tag')
  offset++
  const sLen = derSig[offset++]
  const sBytes = derSig.subarray(offset, offset + sLen)

  let rBig = BigInt('0x' + Buffer.from(rBytes).toString('hex'))
  let sBig = BigInt('0x' + Buffer.from(sBytes).toString('hex'))

  // low-S normalization
  if (sBig > SECP256K1_HALF_N) {
    sBig = SECP256K1_N - sBig
  }

  const rHex = rBig.toString(16).padStart(64, '0')
  const sHex = sBig.toString(16).padStart(64, '0')
  return { r: rHex, s: sHex }
}

// ─── DER encoding for TxnSignature ──────

function derInt(hex) {
  let v = hex.replace(/^0+/, '')
  if (v === '' || v.length === 0) v = '00'
  if (v.length % 2 !== 0) v = '0' + v
  // Add leading 00 if high bit set (positive integer marker)
  if (parseInt(v.slice(0, 2), 16) & 0x80) v = '00' + v
  const len = (v.length / 2).toString(16).padStart(2, '0')
  return '02' + len + v
}

export function derEncodeSignature(rHex, sHex) {
  const rPart = derInt(rHex)
  const sPart = derInt(sHex)
  const body = rPart + sPart
  const len = (body.length / 2).toString(16).padStart(2, '0')
  return '30' + len + body
}

// ─── Signed blob assembly ──────

export async function buildExternallySignedBlob({ xrplModule, txJson, compressedPublicKey, txnSignatureHex }) {
  const xrpl = xrplModule ?? await loadXrplOrThrow()

  const signedTx = {
    ...txJson,
    SigningPubKey: compressedPublicKey,
    TxnSignature: txnSignatureHex  // DER-encoded hex
  }

  const signedBlob = xrpl.encode(signedTx)

  // Real XRPL tx hash: SHA-512 Half of (0x54584E00 + signed binary)
  const HASH_PREFIX_TX_ID = Buffer.from('54584E00', 'hex')
  const signedBytes = Buffer.from(signedBlob, 'hex')
  const sha512 = createHash('sha512').update(Buffer.concat([HASH_PREFIX_TX_ID, signedBytes])).digest()
  const txHash = sha512.subarray(0, 32).toString('hex').toUpperCase()

  return { signedTxBlob: signedBlob, txHash }
}

// ─── SPKI public key extraction ──────

export function extractCompressedPublicKeyFromSpki(spkiDer) {
  // SPKI for secp256k1: SEQUENCE { SEQUENCE { OID, OID }, BIT STRING { 04 <x> <y> } }
  // The uncompressed point (65 bytes) starts after the BIT STRING header
  // We need to find the 65-byte 04||x||y and compress it to 33-byte 02/03||x
  const hex = Buffer.from(spkiDer).toString('hex')
  // Find the uncompressed point (starts with 04, 65 bytes = 130 hex chars)
  const idx04 = hex.indexOf('04', 40) // skip headers
  if (idx04 < 0) throw new SignatureInvalidError('SPKI: no uncompressed point found')

  const uncompressed = hex.slice(idx04, idx04 + 130) // 04 + 32x + 32y = 65 bytes
  if (uncompressed.length !== 130) throw new SignatureInvalidError('SPKI: invalid point length')

  const xHex = uncompressed.slice(2, 66) // 32 bytes
  const yHex = uncompressed.slice(66, 130) // 32 bytes
  const yLastByte = parseInt(yHex.slice(-2), 16)
  const prefix = (yLastByte & 1) === 0 ? '02' : '03'
  return prefix + xHex
}

// ─── Address derivation ──────

export async function deriveXrplAddress(compressedPubKeyHex) {
  const xrpl = await loadXrplOrThrow()
  return xrpl.deriveAddress(compressedPubKeyHex)
}

// ─── Error classes ──────

export class KmsUnavailableError extends Error {
  constructor(provider, detail) {
    super(`kms_unavailable: ${provider} — ${detail}`)
    this.code = 'KMS_UNAVAILABLE'
    this.provider = provider
  }
}

export class SignatureInvalidError extends Error {
  constructor(detail) {
    super(`signature_invalid: ${detail}`)
    this.code = 'SIGNATURE_INVALID'
  }
}

export class KeyNotFoundError extends Error {
  constructor(keyRef, provider) {
    super(`key_not_found: ${keyRef} in ${provider}`)
    this.code = 'KEY_NOT_FOUND'
    this.keyRef = keyRef
    this.provider = provider
  }
}

export class KeyMismatchError extends Error {
  constructor(expected, actual) {
    super(`key_mismatch: expected ${expected}, got ${actual}`)
    this.code = 'KEY_MISMATCH'
  }
}

// ─── Internal ──────

async function loadXrplOrThrow() {
  try { return await import('xrpl') } catch {
    throw new Error('xrpl_dependency_missing: install xrpl to enable external signing')
  }
}
