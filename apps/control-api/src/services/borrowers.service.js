export class BorrowersService {
  constructor(db, evidence) {
    this.db = db
    this.evidence = evidence
  }

  async create(input, actor) {
    const borrower = await this.db.createBorrower({
      ...input,
      authUserId: input.authUserId ?? null
    })
    await this.evidence.append('borrower', borrower.id, 'borrower.created', {
      actor: actor?.sub ?? null,
      action: 'borrower_create',
      legalName: borrower.legalName,
      countryCode: borrower.countryCode,
      xrplAddress: borrower.xrplAddress,
      authUserId: borrower.authUserId ?? null
    })
    return borrower
  }

  /**
   * Link an auth_user to an existing borrower party.
   * This creates the auth_user_id ↔ party_id ↔ xrpl_address chain.
   */
  async linkAuthUser(borrowerId, authUserId, actor) {
    const borrower = await this.db.getBorrower?.(borrowerId)
      ?? (await this.db.listBorrowers()).find(b => b.id === borrowerId)
    if (!borrower) throw new Error('borrower_not_found')

    // Update party with auth user link
    if (typeof this.db.updateParty === 'function') {
      await this.db.updateParty(borrowerId, { authUserId })
    } else {
      // Memory fallback: direct mutation
      borrower.authUserId = authUserId
    }

    await this.evidence.append('borrower', borrowerId, 'borrower.auth_linked', {
      actor: actor?.sub ?? null,
      action: 'link_auth_user',
      authUserId,
      borrowerId
    })
    return borrower
  }

  list() {
    return this.db.listBorrowers()
  }
}
