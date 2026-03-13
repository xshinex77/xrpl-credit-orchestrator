/**
 * loans.service.js
 * ──────────────────────────────────────────────
 * 命令2: LoanSet 二段階署名確定
 *
 * Flow:
 *   1. create() → loan approved in DB
 *   2. prepareCosignPacket() → build unsigned tx, enqueue outbox as PENDING
 *   3. signByBroker() → keystore.sign() → outbox → SIGNED_1
 *   4. signByBorrower() → borrower submits signed blob → outbox → SIGNED_2
 *   5. worker picks up SIGNED_2, submits to ledger
 *
 * Invariant: Account (broker) signs first, Counterparty (borrower) signs second.
 */
import { randomUUID } from 'node:crypto'
import { buildLoanSetTx } from '../../../../packages/xrpl-client/src/builders.js'
import { TxKinds, OutboxStatuses, SoDConstraints } from '../../../../packages/shared-types/src/index.js'

/**
 * SoD enforcement: check if actor performed a conflicting action on this aggregate.
 */
async function enforceSoD(evidence, aggregateType, aggregateId, actor, action) {
  if (!actor?.sub) return // no actor → skip (system actions)
  const constraint = SoDConstraints[action]
  if (!constraint) return

  const events = await evidence.list(aggregateType, aggregateId)
  for (const e of events) {
    if (e.payload?.actor === actor.sub) {
      const priorAction = e.payload?.action
      if (priorAction && constraint.includes(priorAction.toUpperCase())) {
        throw new Error(`sod_violation: user ${actor.sub} already performed ${priorAction}, cannot perform ${action}`)
      }
    }
  }
}

export class LoansService {
  constructor(db, evidence) {
    this.db = db
    this.evidence = evidence
  }

  quote(input) {
    const riskBand = input.riskBand ?? 'B'
    const aprByBand = { A: 0.08, B: 0.12, C: 0.18 }
    const apr = aprByBand[riskBand] ?? aprByBand.B
    const interest = Number((input.principal * apr * (input.termDays / 365)).toFixed(6))
    return {
      quoteId: randomUUID(),
      borrowerId: input.borrowerId,
      principal: input.principal,
      termDays: input.termDays,
      apr,
      estimatedInterest: interest,
      totalDue: Number((input.principal + interest).toFixed(6)),
      currency: 'XRP',
      status: 'quoted',
      generatedAt: new Date().toISOString()
    }
  }

  async create(input, actor) {
    const row = await this.db.createLoan(input)
    await this.evidence.append('loan', row.id, 'loan.approved', {
      actor: actor?.sub ?? null,
      action: 'loan_approve',
      reason: input.reason ?? 'standard_approval',
      principal: row.principal,
      interestRate: row.interestRate
    })
    return row
  }

  /**
   * 命令2 Step 2: Prepare unsigned LoanSet tx + cosign packet.
   * Does NOT sign — only builds the tx and records signing order.
   */
  async prepareCosignPacket(loanId, actor) {
    const loan = await this.db.getLoan(loanId)
    if (!loan) throw new Error('loan_not_found')

    // SoD: user who approved cannot also submit
    await enforceSoD(this.evidence, 'loan', loanId, actor, 'LOAN_SUBMIT')

    const loanBroker = await this.db.getLoanBroker(loan.loanBrokerId)
    if (!loanBroker) throw new Error('loan_broker_not_found')
    if (!loanBroker.xrplLoanBrokerId || loanBroker.xrplLoanBrokerId.startsWith('UNSET')) {
      throw new Error('loan_broker_not_ready: xrplLoanBrokerId not yet written back')
    }

    // Build unsigned tx
    const tx = buildLoanSetTx({
      account: loanBroker.ownerAddress,
      borrower: loan.borrowerAddress,
      loanBrokerId: loanBroker.xrplLoanBrokerId,
      principalRequested: loan.principal,
      interestRate: loan.interestRate,
      paymentsTotal: loan.paymentTotal,
      paymentInterval: loan.paymentInterval,
      gracePeriod: loan.gracePeriod,
      loanOriginationFee: loan.loanOriginationFee,
      loanServiceFee: loan.loanServiceFee
    })

    // Signing order invariant (XLS-66d):
    // Step 1: Account (broker/vault owner) signs
    // Step 2: Borrower signs
    const cosignPacket = {
      loanId: loan.id,
      unsignedTx: tx,
      signingOrder: [
        { step: 1, role: 'broker', account: tx.Account, status: 'pending' },
        { step: 2, role: 'borrower', account: tx.Borrower, status: 'pending' }
      ],
      createdAt: new Date().toISOString()
    }

    // Enqueue — status stays PENDING until broker signs
    const outbox = await this.db.enqueueTx({
      kind: TxKinds.LOAN_SET,
      aggregateType: 'loan',
      aggregateId: loan.id,
      dedupeKey: `loan_set_${loan.id}`,
      requestedByUser: actor?.sub ?? null,
      txJson: tx,
      metadata: {
        mode: 'cosign_two_phase',
        cosignPacket,
        brokerSignedBlob: null,
        counterpartySignedTxBlob: null
      }
    })

    await this.db.updateLoan(loan.id, {
      status: 'cosign_pending',
      cosignPacket,
      partiallySignedTxJson: null
    })

    await this.evidence.append('loan', loan.id, 'loan.cosign_packet.created', {
      actor: actor?.sub ?? null,
      action: 'prepare_cosign',
      account: tx.Account,
      borrower: tx.Borrower,
      paymentsTotal: tx.PaymentsTotal,
      outboxId: outbox.id
    })

    return { cosignPacket, outbox }
  }

  /**
   * 命令2 Step 3: Record broker's signed blob.
   * Called after keystore.sign() is performed externally or by worker.
   */
  async recordBrokerSignature(loanId, signedTxBlob, txHash, actor) {
    const loan = await this.db.getLoan(loanId)
    if (!loan) throw new Error('loan_not_found')
    if (loan.status !== 'cosign_pending') {
      throw new Error(`invalid_state: expected cosign_pending, got ${loan.status}`)
    }

    // SoD: user who approved cannot sign
    await enforceSoD(this.evidence, 'loan', loanId, actor, 'LOAN_SUBMIT')

    // Find outbox item
    const outboxItems = await this.db.listOutboxByAggregate('loan', loanId)
    const outboxItem = outboxItems.find(o =>
      o.kind === TxKinds.LOAN_SET &&
      (o.status === OutboxStatuses.PENDING || o.status === OutboxStatuses.PROCESSING)
    )
    if (!outboxItem) throw new Error('no_pending_outbox_for_loan')

    // Update outbox with broker signature
    await this.db.updateOutbox(outboxItem.id, {
      status: OutboxStatuses.SIGNED_1,
      txHash,
      metadata: {
        ...(outboxItem.metadata ?? {}),
        brokerSignedBlob: signedTxBlob,
        brokerSignedAt: new Date().toISOString(),
        brokerSignedHash: txHash
      }
    })

    await this.evidence.append('loan', loanId, 'loan.broker_signed', {
      actor: actor?.sub ?? null,
      action: 'broker_sign',
      txHash,
      outboxId: outboxItem.id
    })

    return { loanId, outboxId: outboxItem.id, status: 'signed_1' }
  }

  /**
   * 命令2 Step 4: Record borrower's counter-signature.
   * After this, outbox moves to SIGNED_2 and worker can submit.
   */
  async recordBorrowerSignature(loanId, counterpartySignedTxBlob, actor) {
    const loan = await this.db.getLoan(loanId)
    if (!loan) throw new Error('loan_not_found')

    // Borrower identity: actor.sub (auth_user.id) must link to loan's borrower party
    if (actor?.sub) {
      let authorized = false
      // Direct match: actor is the borrower party
      if (loan.borrowerPartyId === actor.sub) authorized = true
      // Linked match: auth_user.id → party.auth_user_id
      if (!authorized && typeof this.db.findPartyByAuthUserId === 'function') {
        const party = await this.db.findPartyByAuthUserId(actor.sub)
        if (party && party.id === loan.borrowerPartyId) authorized = true
      }
      if (!authorized) {
        throw new Error('borrower_identity_mismatch: actor is not the assigned borrower for this loan')
      }
    }

    const outboxItems = await this.db.listOutboxByAggregate('loan', loanId)
    const outboxItem = outboxItems.find(o =>
      o.kind === TxKinds.LOAN_SET && o.status === OutboxStatuses.SIGNED_1
    )
    if (!outboxItem) throw new Error('no_broker_signed_outbox: broker must sign first')

    // Update outbox — now fully signed, ready for submit
    await this.db.updateOutbox(outboxItem.id, {
      status: OutboxStatuses.SIGNED_2,
      metadata: {
        ...(outboxItem.metadata ?? {}),
        counterpartySignedTxBlob,
        counterpartySignedAt: new Date().toISOString()
      }
    })

    await this.evidence.append('loan', loanId, 'loan.borrower_signed', {
      actor: actor?.sub ?? null,
      action: 'borrower_sign',
      outboxId: outboxItem.id
    })

    return { loanId, outboxId: outboxItem.id, status: 'signed_2' }
  }

  list() { return this.db.listLoans() }
}
