/**
 * packages/metrics/src/index.js
 * ──────────────────────────────────────────────
 * Medium #8: Prometheus-compatible metrics
 *
 * Lightweight in-process counters/histograms.
 * Exports /metrics endpoint text in Prometheus format.
 */

class Counter {
  constructor(name, help) {
    this.name = name
    this.help = help
    this.values = new Map() // labels → count
  }

  inc(labels = {}, n = 1) {
    const key = labelKey(labels)
    this.values.set(key, (this.values.get(key) ?? 0) + n)
  }

  toPrometheus() {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`]
    for (const [key, val] of this.values) {
      lines.push(`${this.name}${key} ${val}`)
    }
    return lines.join('\n')
  }
}

class Histogram {
  constructor(name, help, buckets = [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]) {
    this.name = name
    this.help = help
    this.buckets = buckets
    this.observations = [] // { labels, value }
  }

  observe(labels = {}, value) {
    this.observations.push({ labels, value })
  }

  toPrometheus() {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`]
    // Simplified: just output sum and count per label set
    const groups = new Map()
    for (const obs of this.observations) {
      const key = labelKey(obs.labels)
      const g = groups.get(key) ?? { sum: 0, count: 0 }
      g.sum += obs.value
      g.count++
      groups.set(key, g)
    }
    for (const [key, g] of groups) {
      lines.push(`${this.name}_sum${key} ${g.sum}`)
      lines.push(`${this.name}_count${key} ${g.count}`)
    }
    return lines.join('\n')
  }
}

class Gauge {
  constructor(name, help) {
    this.name = name
    this.help = help
    this.values = new Map()
  }

  set(labels = {}, value) {
    this.values.set(labelKey(labels), value)
  }

  toPrometheus() {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} gauge`]
    for (const [key, val] of this.values) {
      lines.push(`${this.name}${key} ${val}`)
    }
    return lines.join('\n')
  }
}

function labelKey(labels) {
  const entries = Object.entries(labels)
  if (entries.length === 0) return ''
  return `{${entries.map(([k, v]) => `${k}="${v}"`).join(',')}}`
}

// ─── Singleton registry ──────

const registry = []

export function createCounter(name, help) {
  const c = new Counter(name, help)
  registry.push(c)
  return c
}

export function createHistogram(name, help, buckets) {
  const h = new Histogram(name, help, buckets)
  registry.push(h)
  return h
}

export function createGauge(name, help) {
  const g = new Gauge(name, help)
  registry.push(g)
  return g
}

export function renderMetrics() {
  return registry.map(m => m.toPrometheus()).join('\n\n') + '\n'
}

// ─── Pre-defined metrics ──────

export const txSubmitTotal = createCounter('xco_tx_submit_total', 'Total XRPL tx submissions')
export const txSubmitErrors = createCounter('xco_tx_submit_errors_total', 'Total XRPL tx submission errors')
export const txSubmitLatency = createHistogram('xco_tx_submit_duration_seconds', 'TX submit latency')
export const outboxQueueSize = createGauge('xco_outbox_queue_size', 'Current outbox pending count')
export const outboxProcessLatency = createHistogram('xco_outbox_process_duration_seconds', 'Outbox processing latency')
export const reconciliationTotal = createCounter('xco_reconciliation_total', 'Total reconciliation runs')
export const reconciliationErrors = createCounter('xco_reconciliation_errors_total', 'Reconciliation errors')
export const reconciliationMismatches = createCounter('xco_reconciliation_mismatches_total', 'Reconciliation mismatches')
export const workerTickLatency = createHistogram('xco_worker_tick_duration_seconds', 'Worker tick latency')
export const signerFailures = createCounter('xco_signer_failures_total', 'Signer failures')
export const networkAmendmentBlocked = createGauge('xco_network_amendment_blocked', 'Amendment blocked state')
export const networkFeeSpikeActive = createGauge('xco_network_fee_spike_active', 'Fee spike state')
export const evidenceAppendTotal = createCounter('xco_evidence_append_total', 'Evidence append count')
export const authFailures = createCounter('xco_auth_failures_total', 'Auth failures')
