import test from 'node:test'
import assert from 'node:assert/strict'
import { createToken, verifyToken, hashPassword, verifyPassword } from '../apps/control-api/src/http/auth.js'

test('password hashing and verification work', () => {
  const hash = hashPassword('secret123')
  assert.equal(verifyPassword('secret123', hash), true)
  assert.equal(verifyPassword('wrong', hash), false)
})

test('token roundtrip works', () => {
  const token = createToken({ sub: 'u1', role: 'admin' }, 'unit-secret', 3600)
  const payload = verifyToken(token, 'unit-secret')
  assert.equal(payload.sub, 'u1')
  assert.equal(payload.role, 'admin')
})
