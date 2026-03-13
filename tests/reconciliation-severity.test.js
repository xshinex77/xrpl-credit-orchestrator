import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Severity } from '../apps/ledger-worker/src/runs/reconciliation.js'

describe('命令5: reconciliation severity', () => {
  it('Severity enum has info/warning/critical', () => {
    assert.equal(Severity.INFO, 'info')
    assert.equal(Severity.WARNING, 'warning')
    assert.equal(Severity.CRITICAL, 'critical')
  })
})
