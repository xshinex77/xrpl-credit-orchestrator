import { loadXrpl } from './network.js'
export * from './builders.js'

export class XrplClient {
  constructor(serverUrl, options = {}) {
    this.serverUrl = serverUrl
    this.xrpl = null
    this.client = null
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? 5
    this.reconnectDelayMs = options.reconnectDelayMs ?? 2000
  }

  async connect() {
    if (this.client?.isConnected?.()) return
    if (!this.xrpl) this.xrpl = await loadXrpl()
    // Create fresh client on each connect attempt
    if (this.client) {
      try { await this.client.disconnect() } catch {}
    }
    this.client = new this.xrpl.Client(this.serverUrl)
    await this.client.connect()
  }

  async disconnect() {
    if (this.client?.isConnected?.()) {
      await this.client.disconnect()
    }
  }

  async reconnect() {
    for (let i = 0; i < this.maxReconnectAttempts; i++) {
      try {
        if (this.client) { try { await this.client.disconnect() } catch {} }
        this.client = new this.xrpl.Client(this.serverUrl)
        await this.client.connect()
        return
      } catch (err) {
        if (i === this.maxReconnectAttempts - 1) throw err
        await new Promise(r => setTimeout(r, this.reconnectDelayMs * (i + 1)))
      }
    }
  }

  async request(payload) {
    try {
      await this.connect()
      return await this.client.request(payload)
    } catch (err) {
      // Auto-reconnect on connection errors
      const m = err.message?.toLowerCase() ?? ''
      if (m.includes('not connected') || m.includes('websocket') || m.includes('disconnect')) {
        await this.reconnect()
        return this.client.request(payload)
      }
      throw err
    }
  }

  async serverInfo() {
    return this.request({ command: 'server_info' })
  }

  async ledgerCurrent() {
    return this.request({ command: 'ledger_current' })
  }

  async tx(hash) {
    return this.request({ command: 'tx', transaction: hash })
  }

  async vaultInfo(params) {
    return this.request({ command: 'vault_info', ledger_index: 'validated', ...params })
  }

  async ledgerEntry(params) {
    return this.request({ command: 'ledger_entry', ledger_index: 'validated', ...params })
  }

  async autofill(tx) {
    await this.connect()
    return this.client.autofill(tx)
  }

  async submitAndWait(tx, options = {}) {
    await this.connect()
    // Only accepts pre-signed tx or tx_blob — no wallet signing path
    return this.client.submitAndWait(tx, options)
  }

  async submit(txBlob) {
    await this.connect()
    return this.client.request({ command: 'submit', tx_blob: txBlob })
  }

  async decode(txBlob) {
    await this.connect()
    return this.xrpl.decode(txBlob)
  }

  // walletFromSeed: REMOVED (命令1 — seed must never leave keystore)
  // signLoanSetByCounterparty: REMOVED (signing is done via keystore.sign)
}
