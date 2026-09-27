import { ethers } from 'ethers'
import { getWallet } from './wallet'
import { getProxiedProvider } from './torTransport'
import deployment from '../deployment.json'
import abi from '../ArticleRegistry.abi.json'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

/** Whether a real contract address is configured (deploy has been run). */
export function isContractDeployed(): boolean {
  return typeof deployment.address === 'string' && deployment.address !== ZERO_ADDRESS
}

/**
 * Guard: fail with a clear, actionable error instead of letting ethers make
 * cryptic calls against the zero address when the contract hasn't been deployed.
 */
function assertDeployed(): void {
  if (!isContractDeployed()) {
    throw new Error(
      'Contract not deployed — run the deploy script (in contracts/: `npm run deploy:base-sepolia`), ' +
        'which writes the real address into src/main/deployment.json.'
    )
  }
}

// Uses the single Tor-proxied provider from torTransport (all RPC egresses
// through Tor and fails closed if Tor is not ready).
function getContract(withSigner = false): ethers.Contract {
  assertDeployed()
  const provider = getProxiedProvider()
  if (withSigner) {
    const wallet = getWallet().connect(provider)
    return new ethers.Contract(deployment.address, abi as ethers.InterfaceAbi, wallet)
  }
  return new ethers.Contract(deployment.address, abi as ethers.InterfaceAbi, provider)
}

export interface ArticleMeta {
  id: number
  title: string
  summary: string
  uploader: string
  timestamp: number
  status: 0 | 1 | 2 // Active | Flagged | Removed
  flagCount: number
  cid?: string // populated separately if needed
}

/** Register an uploaded article on-chain. Returns the articleId assigned by the contract. */
export async function registerArticle(
  contentCID: string,
  ciphertextHashHex: string,
  title: string,
  summary: string
): Promise<number> {
  const contract = getContract(true)
  const ciphertextHash = `0x${ciphertextHashHex}`
  const tx = await contract.uploadArticle(contentCID, ciphertextHash, title, summary)
  const receipt = await tx.wait()

  // Parse ArticleUploaded event to get the assigned articleId
  const iface = new ethers.Interface(abi as ethers.InterfaceAbi)
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog(log)
      if (parsed?.name === 'ArticleUploaded') {
        return Number(parsed.args.articleId)
      }
    } catch {
      /* not the event we're after */
    }
  }
  throw new Error('Could not parse articleId from receipt')
}

/** List articles paginated. offset=0, limit=20 for first page. */
export async function listArticles(offset = 0, limit = 20): Promise<ArticleMeta[]> {
  const contract = getContract()
  const [ids, titles, summaries, uploaders, timestamps, statuses, flagCounts] =
    await contract.getArticles(offset, limit)
  return ids.map((_: unknown, i: number) => ({
    id: Number(ids[i]),
    title: titles[i],
    summary: summaries[i],
    uploader: uploaders[i],
    timestamp: Number(timestamps[i]),
    status: Number(statuses[i]) as 0 | 1 | 2,
    flagCount: Number(flagCounts[i])
  }))
}

/** Get the IPFS CID for a specific article. */
export async function getArticleCID(articleId: number): Promise<string> {
  const contract = getContract()
  return contract.getContentCID(articleId)
}

/**
 * Get the on-chain SHA-256 hash of the ciphertext for an article (a bytes32
 * returned as a "0x…" hex string), used to verify IPFS content integrity on read.
 */
export async function getCiphertextHash(articleId: number): Promise<string> {
  const contract = getContract()
  const article = await contract.articles(articleId)
  return article.ciphertextHash as string
}

export interface GovernanceParams {
  flagStakeWei: string
  voteStakeWei: string
  flagStakeEth: string
  voteStakeEth: string
  flagThreshold: number
  minRemovalVotes: number
  flagCooldownSecs: number
  votePeriodSecs: number
}

/** Read the on-chain moderation parameters (stakes, thresholds) for the UI. */
export async function getGovernanceParams(): Promise<GovernanceParams> {
  const contract = getContract()
  const p = await contract.getGovernanceParams()
  return {
    flagStakeWei: p._flagStake.toString(),
    voteStakeWei: p._voteStake.toString(),
    flagStakeEth: ethers.formatEther(p._flagStake),
    voteStakeEth: ethers.formatEther(p._voteStake),
    flagThreshold: Number(p._flagThreshold),
    minRemovalVotes: Number(p._minRemovalVotes),
    flagCooldownSecs: Number(p._flagCooldown),
    votePeriodSecs: Number(p._votePeriod)
  }
}

/** Flag an article. Sends the required refundable flag stake. */
export async function flagArticle(articleId: number): Promise<void> {
  const contract = getContract(true)
  const stake = await contract.flagStake()
  const tx = await contract.flagArticle(articleId, { value: stake })
  await tx.wait()
}

/** Propose removal (proposer votes FOR). Sends the required vote stake. */
export async function proposeRemoval(articleId: number): Promise<number> {
  const contract = getContract(true)
  const stake = await contract.voteStake()
  const tx = await contract.proposeRemoval(articleId, { value: stake })
  const receipt = await tx.wait()
  const iface = new ethers.Interface(abi as ethers.InterfaceAbi)
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog(log)
      if (parsed?.name === 'RemovalProposed') return Number(parsed.args.proposalId)
    } catch {
      /* not the event we're after */
    }
  }
  throw new Error('Could not parse proposalId')
}

/** Vote on an existing removal proposal (support = true means FOR removal). */
export async function voteRemoval(proposalId: number, support: boolean): Promise<void> {
  const contract = getContract(true)
  const proposal = await contract.proposals(proposalId)
  const tx = await contract.voteRemoval(proposalId, support, { value: proposal.stakeAmount })
  await tx.wait()
}
