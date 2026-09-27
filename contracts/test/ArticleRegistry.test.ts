import { expect } from 'chai'
import { ethers } from 'hardhat'
import { loadFixture, time } from '@nomicfoundation/hardhat-network-helpers'
import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs'

describe('ArticleRegistry', () => {
  const CID = 'bafybeigdyrexamplecidstringfortesting1234567890abcd'
  const CID2 = 'bafybeihsecondexamplecidstringfortesting0987654321'
  const CIPHER_HASH = '0x' + '11'.repeat(32)
  const TITLE = 'Leaked Ministry Memo'
  const SUMMARY = 'A one-sentence summary shown in the browse view.'

  async function deployFixture() {
    const signers = await ethers.getSigners()
    const [owner] = signers
    const Factory = await ethers.getContractFactory('ArticleRegistry')
    const registry = await Factory.deploy()
    await registry.waitForDeployment()
    const flagStake = await registry.flagStake()
    const voteStake = await registry.voteStake()
    const votePeriod = Number(await registry.votePeriod())
    const flagCooldown = Number(await registry.flagCooldown())
    return { registry, owner, signers, flagStake, voteStake, votePeriod, flagCooldown }
  }

  async function withArticle() {
    const ctx = await deployFixture()
    await ctx.registry.uploadArticle(CID, CIPHER_HASH, TITLE, SUMMARY)
    return ctx
  }

  // ---------------------------------------------------------------- uploading
  it('uploadArticle emits ArticleUploaded and stores the article', async () => {
    const { registry, owner } = await loadFixture(deployFixture)
    await expect(registry.uploadArticle(CID, CIPHER_HASH, TITLE, SUMMARY))
      .to.emit(registry, 'ArticleUploaded')
      .withArgs(0, owner.address, CID, CIPHER_HASH, TITLE, SUMMARY, anyValue)
    expect(await registry.articleCount()).to.equal(1)
    const a = await registry.articles(0)
    expect(a.uploader).to.equal(owner.address)
    expect(a.ciphertextHash).to.equal(CIPHER_HASH)
    expect(a.status).to.equal(0)
  })

  it('getContentCID returns the full CID; getArticles paginates', async () => {
    const { registry } = await loadFixture(deployFixture)
    await registry.uploadArticle(CID, CIPHER_HASH, 'T0', 'S0')
    await registry.uploadArticle(CID2, CIPHER_HASH, 'T1', 'S1')
    expect(await registry.getContentCID(0)).to.equal(CID)
    const page = await registry.getArticles(0, 1)
    expect(page.ids.map((n: bigint) => Number(n))).to.deep.equal([0])
    const page2 = await registry.getArticles(1, 10)
    expect(page2.titles).to.deep.equal(['T1'])
  })

  // ----------------------------------------------------------------- flagging
  it('flagArticle requires the flag stake and increments flagCount', async () => {
    const { registry, signers, flagStake } = await loadFixture(withArticle)

    await expect(registry.connect(signers[1]).flagArticle(0)).to.be.revertedWithCustomError(
      registry,
      'BadStake'
    ) // no stake
    await expect(registry.connect(signers[1]).flagArticle(0, { value: flagStake - 1n }))
      .to.be.revertedWithCustomError(registry, 'BadStake')

    await expect(registry.connect(signers[1]).flagArticle(0, { value: flagStake }))
      .to.emit(registry, 'ArticleFlagged')
      .withArgs(0, signers[1].address, 1)
    expect((await registry.articles(0)).flagCount).to.equal(1)
    expect(await registry.hasFlagged(0, signers[1].address)).to.equal(true)
    expect((await registry.flags(0, signers[1].address)).amount).to.equal(flagStake)
  })

  it('one flag per address is enforced (AlreadyFlagged)', async () => {
    const { registry, signers, flagStake } = await loadFixture(withArticle)
    await registry.connect(signers[1]).flagArticle(0, { value: flagStake })
    await expect(
      registry.connect(signers[1]).flagArticle(0, { value: flagStake })
    ).to.be.revertedWithCustomError(registry, 'AlreadyFlagged')
    expect((await registry.articles(0)).flagCount).to.equal(1)
  })

  it('auto-hides at the flag threshold', async () => {
    const { registry, signers, flagStake } = await loadFixture(withArticle)
    const threshold = Number(await registry.flagThreshold())
    for (let i = 0; i < threshold - 1; i++) {
      await registry.connect(signers[i]).flagArticle(0, { value: flagStake })
    }
    expect((await registry.articles(0)).status).to.equal(0) // Active
    await expect(registry.connect(signers[threshold - 1]).flagArticle(0, { value: flagStake }))
      .to.emit(registry, 'ArticleAutoHidden')
      .withArgs(0)
    expect((await registry.articles(0)).status).to.equal(1) // Flagged
  })

  it('withdrawFlag refunds after the cooldown, not before', async () => {
    const { registry, signers, flagStake, flagCooldown } = await loadFixture(withArticle)
    await registry.connect(signers[1]).flagArticle(0, { value: flagStake })

    await expect(registry.connect(signers[1]).withdrawFlag(0)).to.be.revertedWithCustomError(
      registry,
      'CooldownActive'
    )
    await time.increase(flagCooldown + 1)
    await expect(registry.connect(signers[1]).withdrawFlag(0)).to.changeEtherBalance(
      registry,
      -flagStake
    )
    expect((await registry.articles(0)).flagCount).to.equal(0)
    expect(await registry.hasFlagged(0, signers[1].address)).to.equal(false)
  })

  // ------------------------------------------------- removal: staked, 2-sided
  it('removal cannot be executed before the voting window closes (not instant)', async () => {
    const { registry, signers, voteStake } = await loadFixture(withArticle)
    await registry.connect(signers[1]).proposeRemoval(0, { value: voteStake })
    await expect(registry.executeRemoval(0)).to.be.revertedWithCustomError(
      registry,
      'ProposalNotReady'
    )
  })

  it('happy path: FOR reaches quorum + majority -> removed; winners reclaim stake + share', async () => {
    const { registry, signers, voteStake, votePeriod } = await loadFixture(withArticle)
    const quorum = Number(await registry.minRemovalVotes())

    // Proposer (FOR) + (quorum-1) more FOR votes.
    await registry.connect(signers[1]).proposeRemoval(0, { value: voteStake })
    for (let i = 2; i <= quorum; i++) {
      await registry.connect(signers[i]).voteRemoval(0, true, { value: voteStake })
    }
    // Two AGAINST voters (the losing side).
    await registry.connect(signers[quorum + 1]).voteRemoval(0, false, { value: voteStake })
    await registry.connect(signers[quorum + 2]).voteRemoval(0, false, { value: voteStake })

    await time.increase(votePeriod + 1)
    await expect(registry.executeRemoval(0)).to.emit(registry, 'RemovalExecuted').withArgs(0, 0)
    expect((await registry.articles(0)).status).to.equal(2) // Removed
    expect(await registry.getContentCID(0)).to.equal('')

    // FOR winner payout = stake + share of the AGAINST pot.
    // forTotal = quorum*stake, againstTotal = 2*stake.
    const forTotal = BigInt(quorum) * voteStake
    const againstTotal = 2n * voteStake
    const winnerPayout = voteStake + (voteStake * againstTotal) / forTotal
    await expect(registry.connect(signers[1]).claimVoteStake(0)).to.changeEtherBalance(
      registry,
      -winnerPayout
    )
    // Loser (AGAINST) forfeits — contract balance unchanged, event emitted.
    await expect(registry.connect(signers[quorum + 1]).claimVoteStake(0))
      .to.emit(registry, 'VoteStakeForfeited')
      .withArgs(0, signers[quorum + 1].address, voteStake)
  })

  it('removal fails when quorum is not met; flag stake is aligned/forfeited accordingly', async () => {
    const { registry, signers, voteStake, votePeriod, flagStake } = await loadFixture(withArticle)
    // A flag hides nothing here (below threshold) but is used to check forfeiture.
    await registry.connect(signers[9]).flagArticle(0, { value: flagStake })

    // Only the proposer votes FOR (1 < quorum of 5) -> keep.
    await registry.connect(signers[1]).proposeRemoval(0, { value: voteStake })
    await time.increase(votePeriod + 1)
    await expect(registry.executeRemoval(0)).to.emit(registry, 'RemovalRejected').withArgs(0, 0)
    expect((await registry.articles(0)).status).to.equal(0) // still Active

    // Article kept -> the flag is forfeited (epoch bumped): can't withdraw.
    await time.increase(Number(await registry.flagCooldown()) + 1)
    await expect(registry.connect(signers[9]).withdrawFlag(0)).to.be.revertedWithCustomError(
      registry,
      'Forfeited'
    )
    // Proposer (FOR) lost -> forfeits vote stake.
    await expect(registry.connect(signers[1]).claimVoteStake(0))
      .to.emit(registry, 'VoteStakeForfeited')
      .withArgs(0, signers[1].address, voteStake)
  })

  it('claimFlagStake refunds the flagger once the article is removed (aligned)', async () => {
    const { registry, signers, voteStake, votePeriod, flagStake } = await loadFixture(withArticle)
    const quorum = Number(await registry.minRemovalVotes())
    await registry.connect(signers[9]).flagArticle(0, { value: flagStake })

    await registry.connect(signers[1]).proposeRemoval(0, { value: voteStake })
    for (let i = 2; i <= quorum; i++) {
      await registry.connect(signers[i]).voteRemoval(0, true, { value: voteStake })
    }
    await time.increase(votePeriod + 1)
    await registry.executeRemoval(0)
    expect((await registry.articles(0)).status).to.equal(2)

    await expect(registry.connect(signers[9]).claimFlagStake(0)).to.changeEtherBalance(
      registry,
      -flagStake
    )
  })

  // ---------------------------------------------------- Sybil-resistance demo
  it('a single address cannot remove alone, and Sybil cost scales per identity', async () => {
    const { registry, signers, voteStake, votePeriod } = await loadFixture(withArticle)
    const quorum = Number(await registry.minRemovalVotes())

    // A single funded address cannot reach quorum alone.
    await registry.connect(signers[1]).proposeRemoval(0, { value: voteStake })
    await expect(
      registry.connect(signers[1]).voteRemoval(0, true, { value: voteStake })
    ).to.be.revertedWithCustomError(registry, 'AlreadyVoted')

    // To reach quorum, the attacker must fund `quorum` distinct addresses, each
    // staking voteStake — cost scales linearly with each identity.
    for (let i = 2; i <= quorum; i++) {
      await registry.connect(signers[i]).voteRemoval(0, true, { value: voteStake })
    }
    const p = await registry.proposals(0)
    expect(p.forVotes).to.equal(quorum)
    expect(p.forStakeTotal).to.equal(BigInt(quorum) * voteStake) // N identities => N * stake

    // Not instant: cannot execute before the window closes.
    await expect(registry.executeRemoval(0)).to.be.revertedWithCustomError(
      registry,
      'ProposalNotReady'
    )
  })

  it('defenders can defeat a Sybil takedown, forfeiting the attacker’s stake to them', async () => {
    const { registry, signers, voteStake, votePeriod } = await loadFixture(withArticle)
    const quorum = Number(await registry.minRemovalVotes())

    // Attacker: proposer + (quorum-1) sub-wallets, all FOR.
    const attackers = signers.slice(1, 1 + quorum)
    await registry.connect(attackers[0]).proposeRemoval(0, { value: voteStake })
    for (let i = 1; i < attackers.length; i++) {
      await registry.connect(attackers[i]).voteRemoval(0, true, { value: voteStake })
    }
    // Defenders: quorum+1 AGAINST votes -> againstVotes >= forVotes, so KEEP.
    const defenders = signers.slice(1 + quorum, 1 + quorum + (quorum + 1))
    for (const d of defenders) {
      await registry.connect(d).voteRemoval(0, false, { value: voteStake })
    }

    await time.increase(votePeriod + 1)
    await expect(registry.executeRemoval(0)).to.emit(registry, 'RemovalRejected')
    expect((await registry.articles(0)).status).to.equal(0) // NOT removed

    // Attacker forfeits; a defender reclaims stake + a share of the forfeited pot.
    const forTotal = BigInt(quorum) * voteStake // attacker pot (forfeited)
    const againstTotal = BigInt(defenders.length) * voteStake
    const defenderPayout = voteStake + (voteStake * forTotal) / againstTotal
    await expect(registry.connect(defenders[0]).claimVoteStake(0)).to.changeEtherBalance(
      registry,
      -defenderPayout
    )
    await expect(registry.connect(attackers[0]).claimVoteStake(0))
      .to.emit(registry, 'VoteStakeForfeited')
      .withArgs(0, attackers[0].address, voteStake)
  })

  // ------------------------------------------------------------- guardian
  it('guardian can update params; non-guardian cannot', async () => {
    const { registry, signers } = await loadFixture(deployFixture)
    await expect(
      registry.connect(signers[1]).setParams(1, 2, 3, 4, 5, 6)
    ).to.be.revertedWith('Not guardian')

    await expect(registry.setParams(5n, 7n, 3, 2, 10, 100)).to.emit(registry, 'ParamsUpdated')
    expect(await registry.flagStake()).to.equal(5n)
    expect(await registry.minRemovalVotes()).to.equal(2)
  })
})
