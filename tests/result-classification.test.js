import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { classifyResult, RESULT_CLASSIFICATION } from '../apps/ledger-worker/src/tx-executor.js'

describe('命令6: XRPL result code classification', () => {
  it('tesSUCCESS → success', () => assert.equal(classifyResult('tesSUCCESS'), 'success'))
  it('terQUEUED → success', () => assert.equal(classifyResult('terQUEUED'), 'success'))

  it('terPRE_SEQ → retry', () => assert.equal(classifyResult('terPRE_SEQ'), 'retry'))
  it('tefPAST_SEQ → retry', () => assert.equal(classifyResult('tefPAST_SEQ'), 'retry'))
  it('telCAN_NOT_QUEUE → retry', () => assert.equal(classifyResult('telCAN_NOT_QUEUE'), 'retry'))
  it('terINSUF_FEE_B → retry', () => assert.equal(classifyResult('terINSUF_FEE_B'), 'retry'))

  it('tecUNFUNDED → manual_review', () => assert.equal(classifyResult('tecUNFUNDED'), 'manual_review'))
  it('tecNO_PERMISSION → manual_review', () => assert.equal(classifyResult('tecNO_PERMISSION'), 'manual_review'))
  it('tefNOT_ENABLED → manual_review', () => assert.equal(classifyResult('tefNOT_ENABLED'), 'manual_review'))

  it('temMALFORMED → fail', () => assert.equal(classifyResult('temMALFORMED'), 'fail'))
  it('temBAD_AMOUNT → fail', () => assert.equal(classifyResult('temBAD_AMOUNT'), 'fail'))

  it('null → fail', () => assert.equal(classifyResult(null), 'fail'))
  it('unknown → fail', () => assert.equal(classifyResult('unknown'), 'fail'))

  it('unknown tes* → success (pattern)', () => assert.equal(classifyResult('tesNEW_CODE'), 'success'))
  it('unknown ter* → retry (pattern)', () => assert.equal(classifyResult('terNEW_CODE'), 'retry'))
  it('unknown tec* → manual_review (pattern)', () => assert.equal(classifyResult('tecNEW_CODE'), 'manual_review'))
  it('unknown tem* → fail (pattern)', () => assert.equal(classifyResult('temNEW_CODE'), 'fail'))

  it('RESULT_CLASSIFICATION has all expected codes', () => {
    assert.ok(Object.keys(RESULT_CLASSIFICATION).length >= 15)
    assert.equal(RESULT_CLASSIFICATION.tesSUCCESS, 'success')
    assert.equal(RESULT_CLASSIFICATION.temMALFORMED, 'fail')
  })
})
