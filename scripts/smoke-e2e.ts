/**
 * End-to-end smoke test for the core PressChain path, over Tor, against the LIVE
 * Base Sepolia chain and LIVE Web3.Storage (IPFS). It exercises the real app
 * modules (encryption, IPFS, Tor transport) and reports per-step timings.
 *
 * ⚠️ This WRITES to the live testnet (registers + flags an article) and spends
 * testnet ETH for gas.
 *
 * Prerequisites (read from .env — never hardcode secrets):
 *   - DEPLOYER_PRIVATE_KEY : a funded Base Sepolia wallet key
 *   - W3UP_PROOF           : base64 w3up delegation for your space
 *   - a deployed contract  : src/main/deployment.json must have a real address
 *   - bundled Tor          : run `npm run fetch-tor` first
 *
 * Run:  npm run smoke-e2e
 */
import { app } from 'electron'
import * as dotenv from 'dotenv'
import { ethers } from 'ethers'

import { startTor, getTorStatus, stopTor } from '../src/main/tor'
import { getProxiedProvider } from '../src/main/services/torTransport'
import {
  generateArticleKey,
  encryptArticle,
  serializeEncrypted,
  deserializeEncrypted,
  decryptArticle,
  ciphertextHashMatches
} from '../src/main/services/encryption'
import { uploadToIPFS, fetchFromIPFS, initIPFS } from '../src/main/services/ipfs'
import deployment from '../src/main/deployment.json'
import abi from '../src/main/ArticleRegistry.abi.json'

dotenv.config()

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const t0 = Date.now()
const clock = (): string => `${((Date.now() - t0) / 1000).toFixed(1)}s`.padStart(6)
const log = (msg: string): void => console.log(`[${clock()}] ${msg}`)

function checkPrerequisites(): string[] {
  const problems: string[] = []
  if (!process.env.DEPLOYER_PRIVATE_KEY) {
    problems.push('DEPLOYER_PRIVATE_KEY is not set in .env (a funded Base Sepolia wallet key).')
  }
  if (!deployment.address || deployment.address === ZERO_ADDRESS) {
    problems.push(
      `Contract is not deployed — src/main/deployment.json address is "${deployment.address}". ` +
        'Deploy it first (contracts/: npm run deploy:base-sepolia).'
    )
  }
  if (!process.env.W3UP_PROOF) {
    problems.push('W3UP_PROOF is not set in .env (base64 w3up delegation for your space).')
  }
  return problems
}

async function run(): Promise<void> {
  const problems = checkPrerequisites()
  if (problems.length) {
    console.error('\n✗ Missing prerequisites — cannot run the live smoke test:\n')
    problems.forEach((p) => console.error('  • ' + p))
    console.error('\nSee .env.example and KNOWN_ISSUES.md. Nothing was sent. Aborting.\n')
    app.exit(2)
    return
  }

  const timings: Record<string, number> = {}

  // ---- 0. Tor ----
  log('Starting bundled Tor…')
  const tTor = Date.now()
  await startTor()
  if (getTorStatus().state !== 'ready') {
    throw new Error(`Tor did not reach ready (state: ${getTorStatus().state}).`)
  }
  timings.torBootstrapMs = Date.now() - tTor
  log(`Tor ready — bootstrap ${timings.torBootstrapMs} ms`)

  // ---- setup: provider (via Tor), signer, contract, IPFS ----
  const provider = getProxiedProvider()
  const wallet = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY as string, provider)
  const contract = new ethers.Contract(deployment.address, abi as ethers.InterfaceAbi, wallet)
  const iface = new ethers.Interface(abi as ethers.InterfaceAbi)
  log(`Signer ${wallet.address}`)

  await initIPFS(process.env.W3UP_PROOF as string)
  log('IPFS (w3up) client ready')

  // ---- a. encrypt -> IPFS -> on-chain register ----
  const testText = `PressChain smoke test — ${new Date().toISOString()}`
  const key = generateArticleKey()
  const encrypted = encryptArticle(testText, key)
  const serialized = serializeEncrypted(encrypted)

  let t = Date.now()
  const cid = await uploadToIPFS(serialized, `smoke-${Date.now()}.bin`)
  timings.ipfsUploadMs = Date.now() - t
  log(`IPFS upload -> ${cid}  (${timings.ipfsUploadMs} ms)`)

  t = Date.now()
  const tx = await contract.uploadArticle(
    cid,
    `0x${encrypted.ciphertextHash}`,
    'Smoke Test',
    'Automated end-to-end smoke test article.'
  )
  const receipt = await tx.wait()
  timings.registerMs = Date.now() - t

  let articleId = -1
  for (const lg of receipt.logs) {
    try {
      const parsed = iface.parseLog(lg)
      if (parsed?.name === 'ArticleUploaded') {
        articleId = Number(parsed.args.articleId)
        break
      }
    } catch {
      /* not our event */
    }
  }
  if (articleId < 0) throw new Error('Could not parse articleId from ArticleUploaded event.')
  log(`On-chain register -> articleId #${articleId}  tx ${receipt.hash}  (${timings.registerMs} ms)`)

  // ---- b. list and find it ----
  t = Date.now()
  const [ids] = await contract.getArticles(0, 1000)
  timings.listMs = Date.now() - t
  const found = (ids as bigint[]).map((n) => Number(n)).includes(articleId)
  if (!found) throw new Error(`Article #${articleId} not found in getArticles().`)
  log(`Listed articles — found #${articleId}  (${timings.listMs} ms)`)

  // ---- c. read back: fetch -> integrity check (C4) -> decrypt ----
  t = Date.now()
  const raw = await fetchFromIPFS(cid)
  timings.ipfsFetchMs = Date.now() - t
  const back = deserializeEncrypted(raw)
  const onchainHash = (await contract.articles(articleId)).ciphertextHash as string
  if (!ciphertextHashMatches(back.ciphertextHash, onchainHash)) {
    throw new Error('INTEGRITY_FAILURE — fetched ciphertext hash does not match on-chain value.')
  }
  const decrypted = decryptArticle(back, key)
  if (decrypted !== testText) throw new Error('Decrypted text does not match the original.')
  log(`IPFS fetch (${timings.ipfsFetchMs} ms) — integrity OK, decrypted matches original`)

  // ---- d. flag once, confirm flagCount increments on-chain ----
  const before = Number((await contract.articles(articleId)).flagCount)
  t = Date.now()
  const flagTx = await contract.flagArticle(articleId)
  await flagTx.wait()
  timings.flagMs = Date.now() - t
  const after = Number((await contract.articles(articleId)).flagCount)
  if (after !== before + 1) {
    throw new Error(`flagCount did not increment: ${before} -> ${after}`)
  }
  log(`Flagged #${articleId} — flagCount ${before} -> ${after}  (${timings.flagMs} ms)`)

  console.log('\n✓ SMOKE TEST PASSED — full path works end to end over Tor.\n')
  console.log('Timings (ms):')
  for (const [k, v] of Object.entries(timings)) console.log(`  ${k.padEnd(16)} ${v}`)
  console.log('\nTIMINGS_JSON ' + JSON.stringify(timings))
  app.exit(0)
}

app.disableHardwareAcceleration()
app
  .whenReady()
  .then(run)
  .catch((err) => {
    console.error('\n✗ SMOKE TEST FAILED:', err instanceof Error ? err.message : err)
    app.exit(1)
  })
  .finally(() => {
    stopTor()
  })
