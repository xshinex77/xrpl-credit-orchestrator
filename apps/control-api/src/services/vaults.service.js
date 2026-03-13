import {
  buildVaultCreateTx,
  buildVaultDepositTx,
  buildLoanBrokerSetTx,
  buildLoanBrokerCollateralDepositTx
} from '../../../../packages/xrpl-client/src/builders.js'
import { TxKinds } from '../../../../packages/shared-types/src/index.js'

export class VaultsService {
  constructor(db, evidence) {
    this.db = db
    this.evidence = evidence
  }

  async createVault(input, actor) {
    const vault = await this.db.createVault(input)
    const asset = input.assetType === 'MPT'
      ? { mpt_issuance_id: input.assetMptIssuanceId }
      : input.assetType === 'XRP'
        ? { currency: 'XRP' }
        : { currency: input.assetCode, issuer: input.issuerAddress }

    const tx = buildVaultCreateTx({
      account: input.ownerAddress,
      asset,
      domainId: input.permissionedDomainId ?? undefined,
      data: input.data ?? { name: input.displayName ?? 'Vault', website: input.website ?? null },
      assetsMaximum: input.assetsMaximum ?? '0',
      withdrawalPolicy: input.withdrawalPolicy ?? 0
    })

    const outbox = await this.db.enqueueTx({
      kind: TxKinds.VAULT_CREATE,
      aggregateType: 'vault',
      aggregateId: vault.id,
      dedupeKey: `vault_create_${vault.id}`,
      requestedByUser: actor?.sub ?? null,
      txJson: tx,
      metadata: { ownerAddress: input.ownerAddress, assetType: input.assetType }
    })

    await this.evidence.append('vault', vault.id, 'vault.queued', {
      actor: actor?.sub ?? null,
      txKind: outbox.kind,
      ownerAddress: input.ownerAddress,
      assetType: input.assetType
    })

    return { vault, outbox, txPreview: tx }
  }

  async deposit(vaultId, input, actor) {
    const vault = await this.db.getVault(vaultId)
    if (!vault) throw new Error('vault_not_found')
    if (!vault.xrplVaultId || vault.xrplVaultId.startsWith('UNSET')) {
      throw new Error('vault_not_ready: xrplVaultId not yet written back from ledger. Wait for VaultCreate to be validated and indexed.')
    }
    const amount = vault.assetType === 'MPT'
      ? { mpt_issuance_id: vault.assetMptIssuanceId, value: String(input.amount) }
      : vault.assetType === 'XRP'
        ? String(input.amount)
        : { currency: vault.assetCode, issuer: vault.issuerAddress, value: String(input.amount) }

    const tx = buildVaultDepositTx({
      account: input.account,
      vaultId: vault.xrplVaultId,
      amount
    })
    const outbox = await this.db.enqueueTx({
      kind: TxKinds.VAULT_DEPOSIT,
      aggregateType: 'vault',
      aggregateId: vault.id,
      dedupeKey: `vault_deposit_${vault.id}_${input.account}`,
      requestedByUser: actor?.sub ?? null,
      txJson: tx,
      metadata: { account: input.account, amount }
    })

    await this.db.upsertVaultPosition({
      vaultId,
      lenderAddress: input.account,
      lenderPartyId: input.lenderPartyId ?? null,
      depositedAmount: String(input.amount),
      sharesNumeric: input.sharesNumeric ?? '0',
      withdrawnAmount: '0'
    })

    await this.evidence.append('vault', vault.id, 'vault.deposit.queued', {
      actor: actor?.sub ?? null,
      account: input.account,
      amount
    })
    return { outbox, txPreview: tx }
  }

  async createLoanBroker(input, actor) {
    const vault = await this.db.getVault(input.vaultId)
    if (!vault) throw new Error('vault_not_found')
    if (!vault.xrplVaultId || vault.xrplVaultId.startsWith('UNSET')) {
      throw new Error('vault_not_ready: xrplVaultId not yet written back.')
    }
    // XLS-66d: Vault owner and Loan Broker must be same account
    if (vault.ownerAddress !== input.ownerAddress) {
      throw new Error('owner_mismatch: loan broker owner must match vault owner per XLS-66d')
    }
    const broker = await this.db.createLoanBroker(input)

    const tx = buildLoanBrokerSetTx({
      account: input.ownerAddress,
      vaultId: vault.xrplVaultId,
      managementFeeRate: input.managementFeeRate ?? 0,
      debtMaximum: input.debtMaximum ?? '0',
      collateralRateMinimum: input.collateralRateMinimum ?? input.coverRateMinimum ?? 0,
      collateralRateLiquidation: input.collateralRateLiquidation ?? input.coverRateLiquidation ?? 0,
      data: input.data ?? { displayName: input.displayName ?? 'Loan Broker' }
    })

    const outbox = await this.db.enqueueTx({
      kind: TxKinds.LOAN_BROKER_SET,
      aggregateType: 'loan_broker',
      aggregateId: broker.id,
      dedupeKey: `broker_set_${broker.id}`,
      requestedByUser: actor?.sub ?? null,
      txJson: tx,
      metadata: { vaultId: input.vaultId }
    })
    await this.evidence.append('loan_broker', broker.id, 'loan_broker.queued', {
      actor: actor?.sub ?? null,
      vaultId: input.vaultId,
      managementFeeRate: input.managementFeeRate ?? 0
    })
    return { loanBroker: broker, outbox, txPreview: tx }
  }

  async depositCollateral(loanBrokerId, input, actor) {
    const broker = await this.db.getLoanBroker(loanBrokerId)
    if (!broker) throw new Error('loan_broker_not_found')
    if (!broker.xrplLoanBrokerId || broker.xrplLoanBrokerId.startsWith('UNSET')) {
      throw new Error('loan_broker_not_ready: xrplLoanBrokerId not yet written back.')
    }
    const amount = input.amountObject ?? String(input.amount)
    const tx = buildLoanBrokerCollateralDepositTx({
      account: broker.ownerAddress,
      loanBrokerId: broker.xrplLoanBrokerId,
      amount
    })
    const outbox = await this.db.enqueueTx({
      kind: TxKinds.LOAN_BROKER_COLLATERAL_DEPOSIT,
      aggregateType: 'loan_broker',
      aggregateId: broker.id,
      dedupeKey: `broker_collateral_${broker.id}_${Date.now()}`,
      requestedByUser: actor?.sub ?? null,
      txJson: tx,
      metadata: { amount }
    })
    await this.db.appendCoverLedger({
      loanBrokerId,
      entryType: 'collateral_deposit',
      amount: typeof amount === 'string' ? amount : amount.value,
      assetRef: typeof amount === 'string' ? 'XRP' : JSON.stringify(amount),
      xrplTxHash: null
    })
    await this.evidence.append('loan_broker', broker.id, 'loan_broker.collateral.queued', {
      actor: actor?.sub ?? null,
      action: 'collateral_deposit',
      amount
    })
    return { outbox, txPreview: tx }
  }

  // Legacy alias
  depositCover(loanBrokerId, input, actor) {
    return this.depositCollateral(loanBrokerId, input, actor)
  }

  listVaults() { return this.db.listVaults() }
  listLoanBrokers() { return this.db.listLoanBrokers() }
}
