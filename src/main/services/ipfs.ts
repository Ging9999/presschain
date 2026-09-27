import { File } from 'node:buffer'
import type { Client } from '@web3-storage/w3up-client'
import { torFetch, torFetchGlobal } from './torTransport'

// @web3-storage/w3up-client is ESM-only. To keep the CommonJS main-process
// bundle from eagerly loading it at startup (and to fail gracefully when it is
// unavailable), it is imported dynamically inside each function that needs it.
//
// Tor routing status of the w3up client:
//   - Gateway READS (fetchFromIPFS) go through Tor via torFetch. ✅
//   - The upload data path (uploadFile) is given a Tor-backed `fetch`. ✅
//   - TODO(tor): the ucanto SERVICE CONNECTION built in create() — used by
//     login()/createSpace()/addSpace() and capability invocations — still uses
//     w3up's default global fetch and is NOT yet routed through Tor. Proxying it
//     requires passing a custom `serviceConf` with SOCKS-backed channels to
//     create(). Tracked in KNOWN_ISSUES.md (C1 follow-up).

let _client: Client | null = null

/** Create a fresh in-memory w3up client. */
async function createClient(): Promise<Client> {
  const [{ create }, { StoreMemory }] = await Promise.all([
    import('@web3-storage/w3up-client'),
    import('@web3-storage/w3up-client/stores/memory')
  ])
  return create({ store: new StoreMemory() })
}

/** Call once at startup. Reads stored delegation from electron-store. */
export async function initIPFS(storedProof?: string): Promise<void> {
  _client = await createClient()
  if (storedProof) {
    // Re-attach the delegation proof from stored base64.
    const { parse } = await import('@web3-storage/w3up-client/proof')
    const proof = await parse(storedProof)
    await _client.addSpace(proof)
    const spaces = _client.spaces()
    if (spaces.length > 0) {
      await _client.setCurrentSpace(spaces[0].did())
    }
  } else {
    // First-run: the user must log in to web3.storage. The renderer shows a
    // setup UI in response to this error.
    throw new Error('IPFS_SETUP_REQUIRED')
  }
}

/** Whether the IPFS client is initialized with a usable space. */
export function isIPFSReady(): boolean {
  return _client !== null && _client.spaces().length > 0
}

/** Upload encrypted bytes to IPFS. Returns the CID string (e.g. "bafybei..."). */
export async function uploadToIPFS(data: Buffer, filename: string): Promise<string> {
  if (!_client) throw new Error('IPFS not initialized')
  const file = new File([data], filename, { type: 'application/octet-stream' })
  // node:buffer File satisfies w3up's BlobLike at runtime; the DOM/undici stream
  // typings differ, so cast to the expected parameter type. The Tor-backed fetch
  // routes the upload data path through the SOCKS proxy.
  const cid = await _client.uploadFile(file as unknown as Parameters<Client['uploadFile']>[0], {
    fetch: torFetchGlobal
  })
  return cid.toString()
}

/** Fetch encrypted bytes from IPFS by CID string. */
export async function fetchFromIPFS(cidStr: string): Promise<Buffer> {
  // Use the w3s.link gateway (no auth needed for reads). torFetch routes this
  // through the Tor SOCKS proxy and fails closed if Tor is not ready.
  const url = `https://w3s.link/ipfs/${cidStr}`
  const res = await torFetch(url)
  if (!res.ok) throw new Error(`IPFS fetch failed: ${res.status}`)
  const buf = await res.arrayBuffer()
  return Buffer.from(buf)
}

/** Setup helper: creates a space and returns a serialized proof to store. */
export async function setupIPFS(email: string): Promise<string> {
  if (!_client) _client = await createClient()
  const account = await _client.login(email as `${string}@${string}`)
  await account.plan.wait()
  const space = await _client.createSpace('presschain-uploads', { account })
  await _client.setCurrentSpace(space.did())
  // Delegate the upload capabilities to this agent and archive the proof so it
  // can be re-attached on the next launch (see initIPFS).
  const delegation = await _client.createDelegation(_client.agent.issuer, [
    'space/blob/add',
    'upload/add'
  ])
  const archived = await delegation.archive()
  if (archived.error) throw archived.error
  return Buffer.from(archived.ok).toString('base64')
}
