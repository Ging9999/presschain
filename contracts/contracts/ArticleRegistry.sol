// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * ArticleRegistry
 *
 * Censorship-resistant article pointer registry with a lightweight,
 * Schelling-style economic moderation layer (an MVP mitigation — NOT full
 * Kleros / proof-of-personhood).
 *
 * Sybil resistance:
 *  - Flagging and removal voting each require a refundable ETH stake, so
 *    identities are no longer free. Cost scales linearly with each address used.
 *  - Removal is a TWO-SIDED, time-boxed vote. Winners reclaim their stake plus a
 *    pro-rata share of the losing side's forfeited stake; losers forfeit theirs.
 *    This removes the old "free, instant takedown" (5 free votes) hole: an
 *    attacker must fund every sub-wallet AND risks losing it all if the
 *    community defends the article.
 *  - Removal cannot execute until the full voting window elapses, so a rush of
 *    sub-wallets can't finalize before defenders respond.
 *
 * On-chain account-age / activity checks are NOT implemented: Solidity has no
 * opcode to read an EOA's creation time or nonce, so a cheap age check isn't
 * practical on-chain. We rely on the economic stake instead (documented here and
 * in KNOWN_ISSUES.md).
 *
 * Thresholds and stakes are configurable by a `guardian` (a placeholder for a
 * future guardian multisig — see H2), rather than hardcoded tiny constants.
 */
contract ArticleRegistry {
    // ----------------------------------------------------------------- config
    address public guardian; // future: a multisig
    uint256 public flagStake; // wei required to flag
    uint256 public voteStake; // wei required to vote on a removal
    uint256 public flagThreshold; // flags needed to auto-hide
    uint256 public minRemovalVotes; // FOR-vote quorum to remove
    uint256 public flagCooldown; // min hold before a flag stake can be withdrawn
    uint256 public votePeriod; // removal voting window

    enum Status {
        Active,
        Flagged,
        Removed
    }

    struct Article {
        bytes32 contentCID; // keccak of the IPFS CID (string emitted in event)
        bytes32 ciphertextHash; // SHA-256 of the AES ciphertext
        address uploader;
        uint256 timestamp;
        uint256 flagCount;
        Status status;
        uint256 flagEpoch; // bumped when a removal is REJECTED (forfeits current flags)
        string title;
        string summary;
    }

    struct Flag {
        uint256 amount; // staked wei (snapshot of flagStake)
        uint256 epoch; // article.flagEpoch at flag time
        uint256 flaggedAt;
        bool active;
    }

    struct Vote {
        bool hasVoted;
        bool support; // true = FOR removal
        uint256 stake;
        bool claimed;
    }

    struct RemovalProposal {
        uint256 articleId;
        uint256 deadline;
        uint256 stakeAmount; // snapshot of voteStake at creation
        uint256 forVotes;
        uint256 againstVotes;
        uint256 forStakeTotal;
        uint256 againstStakeTotal;
        bool executed;
        bool removed; // outcome
        mapping(address => Vote) votes;
    }

    uint256 public articleCount;
    mapping(uint256 => Article) public articles;
    mapping(uint256 => string) private _contentCIDStrings;
    mapping(uint256 => mapping(address => Flag)) public flags;
    mapping(uint256 => mapping(address => bool)) public hasFlagged; // one flag per address

    uint256 public proposalCount;
    mapping(uint256 => RemovalProposal) public proposals;

    // reentrancy guard
    bool private _entered;
    modifier nonReentrant() {
        require(!_entered, "Reentrant");
        _entered = true;
        _;
        _entered = false;
    }

    modifier onlyGuardian() {
        require(msg.sender == guardian, "Not guardian");
        _;
    }

    // --------------------------------------------------------------- events
    event ArticleUploaded(
        uint256 indexed articleId,
        address indexed uploader,
        string contentCID,
        bytes32 ciphertextHash,
        string title,
        string summary,
        uint256 timestamp
    );
    event ArticleFlagged(uint256 indexed articleId, address indexed flagger, uint256 newFlagCount);
    event ArticleAutoHidden(uint256 indexed articleId);
    event FlagWithdrawn(uint256 indexed articleId, address indexed flagger, uint256 amount);
    event FlagStakeClaimed(uint256 indexed articleId, address indexed flagger, uint256 amount);
    event RemovalProposed(uint256 indexed proposalId, uint256 indexed articleId, address indexed proposer);
    event RemovalVoted(uint256 indexed proposalId, address indexed voter, bool support);
    event RemovalExecuted(uint256 indexed proposalId, uint256 indexed articleId);
    event RemovalRejected(uint256 indexed proposalId, uint256 indexed articleId);
    event VoteStakeClaimed(uint256 indexed proposalId, address indexed voter, uint256 payout);
    event VoteStakeForfeited(uint256 indexed proposalId, address indexed voter, uint256 amount);
    event ParamsUpdated();
    event GuardianChanged(address indexed previous, address indexed next);

    // --------------------------------------------------------------- errors
    error AlreadyFlagged();
    error ArticleNotActive();
    error NoSuchArticle();
    error BadStake();
    error ProposalExpired();
    error AlreadyVoted();
    error ProposalNotReady();
    error ProposalAlreadyExecuted();
    error Forfeited();
    error CooldownActive();
    error NothingToClaim();
    error TransferFailed();

    constructor() {
        guardian = msg.sender;
        flagStake = 0.001 ether;
        voteStake = 0.002 ether;
        flagThreshold = 10;
        minRemovalVotes = 5;
        flagCooldown = 1 days;
        votePeriod = 3 days;
    }

    // --------------------------------------------------------- guardian admin
    function setGuardian(address next) external onlyGuardian {
        emit GuardianChanged(guardian, next);
        guardian = next;
    }

    /// @notice Update moderation parameters. Intended for the guardian multisig.
    function setParams(
        uint256 _flagStake,
        uint256 _voteStake,
        uint256 _flagThreshold,
        uint256 _minRemovalVotes,
        uint256 _flagCooldown,
        uint256 _votePeriod
    ) external onlyGuardian {
        require(_flagThreshold > 0 && _minRemovalVotes > 0 && _votePeriod > 0, "Bad params");
        flagStake = _flagStake;
        voteStake = _voteStake;
        flagThreshold = _flagThreshold;
        minRemovalVotes = _minRemovalVotes;
        flagCooldown = _flagCooldown;
        votePeriod = _votePeriod;
        emit ParamsUpdated();
    }

    // ------------------------------------------------------------- uploading
    /// @notice Upload an encrypted article (AES-256-GCM ciphertext on IPFS).
    function uploadArticle(
        string calldata contentCID,
        bytes32 ciphertextHash,
        string calldata title,
        string calldata summary
    ) external returns (uint256 articleId) {
        require(bytes(contentCID).length > 0, "Empty CID");
        require(bytes(title).length <= 200, "Title too long");
        require(bytes(summary).length <= 500, "Summary too long");

        articleId = articleCount++;
        Article storage a = articles[articleId];
        a.contentCID = keccak256(bytes(contentCID));
        a.ciphertextHash = ciphertextHash;
        a.uploader = msg.sender;
        a.timestamp = block.timestamp;
        a.status = Status.Active;
        a.title = title;
        a.summary = summary;
        _contentCIDStrings[articleId] = contentCID;

        emit ArticleUploaded(articleId, msg.sender, contentCID, ciphertextHash, title, summary, block.timestamp);
    }

    function getContentCID(uint256 articleId) external view returns (string memory) {
        return _contentCIDStrings[articleId];
    }

    // -------------------------------------------------------------- flagging
    /// @notice Flag an article. Requires a refundable `flagStake`. One per address.
    function flagArticle(uint256 articleId) external payable {
        if (articleId >= articleCount) revert NoSuchArticle();
        Article storage a = articles[articleId];
        if (a.status == Status.Removed) revert ArticleNotActive();
        if (hasFlagged[articleId][msg.sender]) revert AlreadyFlagged();
        if (msg.value != flagStake) revert BadStake();

        hasFlagged[articleId][msg.sender] = true;
        flags[articleId][msg.sender] = Flag({
            amount: msg.value,
            epoch: a.flagEpoch,
            flaggedAt: block.timestamp,
            active: true
        });
        a.flagCount++;
        emit ArticleFlagged(articleId, msg.sender, a.flagCount);

        if (a.flagCount >= flagThreshold && a.status == Status.Active) {
            a.status = Status.Flagged;
            emit ArticleAutoHidden(articleId);
        }
    }

    /// @notice Withdraw your flag after the cooldown and reclaim the stake, as
    /// long as the flag hasn't been forfeited by a rejected removal.
    function withdrawFlag(uint256 articleId) external nonReentrant {
        Article storage a = articles[articleId];
        Flag storage f = flags[articleId][msg.sender];
        if (!f.active) revert NothingToClaim();
        if (a.status == Status.Removed) revert ArticleNotActive(); // use claimFlagStake
        if (f.epoch != a.flagEpoch) revert Forfeited();
        if (block.timestamp < f.flaggedAt + flagCooldown) revert CooldownActive();

        f.active = false;
        hasFlagged[articleId][msg.sender] = false;
        if (a.flagCount > 0) a.flagCount--;
        if (a.status == Status.Flagged && a.flagCount < flagThreshold) a.status = Status.Active;

        uint256 amount = f.amount;
        f.amount = 0;
        emit FlagWithdrawn(articleId, msg.sender, amount);
        _pay(msg.sender, amount);
    }

    /// @notice After an article is removed, flaggers were aligned — reclaim stake.
    function claimFlagStake(uint256 articleId) external nonReentrant {
        Article storage a = articles[articleId];
        Flag storage f = flags[articleId][msg.sender];
        if (!f.active) revert NothingToClaim();
        if (a.status != Status.Removed) revert ProposalNotReady();

        f.active = false;
        uint256 amount = f.amount;
        f.amount = 0;
        emit FlagStakeClaimed(articleId, msg.sender, amount);
        _pay(msg.sender, amount);
    }

    // ---------------------------------------------------- removal (2-sided)
    /// @notice Propose removal; opens a voting window. Proposer votes FOR and stakes.
    function proposeRemoval(uint256 articleId) external payable returns (uint256 proposalId) {
        if (articleId >= articleCount) revert NoSuchArticle();
        if (articles[articleId].status == Status.Removed) revert ArticleNotActive();
        if (msg.value != voteStake) revert BadStake();

        proposalId = proposalCount++;
        RemovalProposal storage p = proposals[proposalId];
        p.articleId = articleId;
        p.deadline = block.timestamp + votePeriod;
        p.stakeAmount = voteStake;
        p.votes[msg.sender] = Vote({ hasVoted: true, support: true, stake: msg.value, claimed: false });
        p.forVotes = 1;
        p.forStakeTotal = msg.value;

        emit RemovalProposed(proposalId, articleId, msg.sender);
        emit RemovalVoted(proposalId, msg.sender, true);
    }

    /// @notice Vote FOR (remove) or AGAINST (keep). Requires the proposal's stake.
    function voteRemoval(uint256 proposalId, bool support) external payable {
        RemovalProposal storage p = proposals[proposalId];
        if (p.deadline == 0) revert NoSuchArticle();
        if (block.timestamp > p.deadline) revert ProposalExpired();
        if (p.executed) revert ProposalAlreadyExecuted();
        if (p.votes[msg.sender].hasVoted) revert AlreadyVoted();
        if (msg.value != p.stakeAmount) revert BadStake();

        p.votes[msg.sender] = Vote({ hasVoted: true, support: support, stake: msg.value, claimed: false });
        if (support) {
            p.forVotes++;
            p.forStakeTotal += msg.value;
        } else {
            p.againstVotes++;
            p.againstStakeTotal += msg.value;
        }
        emit RemovalVoted(proposalId, msg.sender, support);
    }

    /// @notice After the voting window closes, finalize the outcome. Removal
    /// requires a FOR quorum AND a FOR majority; otherwise the article is kept and
    /// the flags that hid it are forfeited (epoch bump).
    function executeRemoval(uint256 proposalId) external {
        RemovalProposal storage p = proposals[proposalId];
        if (p.deadline == 0) revert NoSuchArticle();
        if (p.executed) revert ProposalAlreadyExecuted();
        if (block.timestamp <= p.deadline) revert ProposalNotReady(); // must wait full window

        p.executed = true;
        bool remove = (p.forVotes >= minRemovalVotes) && (p.forVotes > p.againstVotes);
        p.removed = remove;

        Article storage a = articles[p.articleId];
        if (remove) {
            a.status = Status.Removed;
            delete _contentCIDStrings[p.articleId];
            emit RemovalExecuted(proposalId, p.articleId);
        } else {
            // Article kept: forfeit the flags that hid it and un-hide.
            a.flagEpoch++;
            a.flagCount = 0;
            if (a.status == Status.Flagged) a.status = Status.Active;
            emit RemovalRejected(proposalId, p.articleId);
        }
    }

    /// @notice Winners reclaim their stake plus a pro-rata share of the losing
    /// side's forfeited stake. Losers forfeit their stake.
    function claimVoteStake(uint256 proposalId) external nonReentrant {
        RemovalProposal storage p = proposals[proposalId];
        if (!p.executed) revert ProposalNotReady();
        Vote storage v = p.votes[msg.sender];
        if (!v.hasVoted || v.claimed) revert NothingToClaim();

        v.claimed = true;
        bool winner = (v.support == p.removed);
        if (!winner) {
            emit VoteStakeForfeited(proposalId, msg.sender, v.stake);
            return; // stake stays in the contract, redistributed to winners
        }

        uint256 winTotal = p.removed ? p.forStakeTotal : p.againstStakeTotal;
        uint256 loseTotal = p.removed ? p.againstStakeTotal : p.forStakeTotal;
        // own stake + share of the losing pot proportional to own stake
        uint256 payout = v.stake + (winTotal == 0 ? 0 : (v.stake * loseTotal) / winTotal);
        emit VoteStakeClaimed(proposalId, msg.sender, payout);
        _pay(msg.sender, payout);
    }

    function _pay(address to, uint256 amount) private {
        if (amount == 0) return;
        (bool ok, ) = payable(to).call{ value: amount }("");
        if (!ok) revert TransferFailed();
    }

    // ------------------------------------------------------------- views
    /// @notice Governance parameters, for the client to display stakes/rules.
    function getGovernanceParams()
        external
        view
        returns (
            uint256 _flagStake,
            uint256 _voteStake,
            uint256 _flagThreshold,
            uint256 _minRemovalVotes,
            uint256 _flagCooldown,
            uint256 _votePeriod
        )
    {
        return (flagStake, voteStake, flagThreshold, minRemovalVotes, flagCooldown, votePeriod);
    }

    /// @notice Paginated browse list (active + flagged + removed).
    function getArticles(uint256 offset, uint256 limit)
        external
        view
        returns (
            uint256[] memory ids,
            string[] memory titles,
            string[] memory summaries,
            address[] memory uploaders,
            uint256[] memory timestamps,
            uint8[] memory statuses,
            uint256[] memory flagCounts
        )
    {
        uint256 end = offset + limit > articleCount ? articleCount : offset + limit;
        uint256 count = end > offset ? end - offset : 0;
        ids = new uint256[](count);
        titles = new string[](count);
        summaries = new string[](count);
        uploaders = new address[](count);
        timestamps = new uint256[](count);
        statuses = new uint8[](count);
        flagCounts = new uint256[](count);

        for (uint256 i = 0; i < count; i++) {
            uint256 id = offset + i;
            Article storage a = articles[id];
            ids[i] = id;
            titles[i] = a.title;
            summaries[i] = a.summary;
            uploaders[i] = a.uploader;
            timestamps[i] = a.timestamp;
            statuses[i] = uint8(a.status);
            flagCounts[i] = a.flagCount;
        }
    }
}
