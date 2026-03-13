import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createCounter, createHistogram, createGauge, renderMetrics } from '../packages/metrics/src/index.js'

describe('Prometheus metrics', () => {
  it('counter increments', () => {
    const c = createCounter('test_counter_1', 'test')
    c.inc({ method: 'POST' })
    c.inc({ method: 'POST' })
    c.inc({ method: 'GET' })
    const text = c.toPrometheus()
    assert.ok(text.includes('test_counter_1{method="POST"} 2'))
    assert.ok(text.includes('test_counter_1{method="GET"} 1'))
  })

  it('histogram observes', () => {
    const h = createHistogram('test_hist_1', 'test')
    h.observe({}, 0.5)
    h.observe({}, 1.2)
    const text = h.toPrometheus()
    assert.ok(text.includes('test_hist_1_count'))
    assert.ok(text.includes('test_hist_1_sum'))
  })

  it('gauge sets', () => {
    const g = createGauge('test_gauge_1', 'test')
    g.set({ node: 'a' }, 42)
    const text = g.toPrometheus()
    assert.ok(text.includes('test_gauge_1{node="a"} 42'))
  })

  it('renderMetrics outputs all registered metrics', () => {
    const output = renderMetrics()
    assert.ok(output.includes('xco_tx_submit_total'))
    assert.ok(output.includes('xco_worker_tick_duration_seconds'))
    assert.ok(output.includes('xco_reconciliation_total'))
  })
})
