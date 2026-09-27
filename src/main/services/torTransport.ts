import { ethers } from 'ethers'
import type { SocksProxyAgent as SocksAgent } from 'socks-proxy-agent'
import { getTorStatus } from '../tor'

/**
 * Tor transport for the main process.
 *
 * The Chromium `--proxy-server` switch set in tor.ts only proxies Chromium's
 * network stack. Node's own HTTP stack — used by ethers and by node-fetch —
 * ignores it. This module forces those Node-side requests through Tor's SOCKS5
 * proxy so they cannot egress over the user's real IP.
 *
 * We use `socks5h` (not `socks5`) so DNS is resolved remotely by Tor and never
 * leaks to the local resolver.
 *
 * Both `node-fetch@3` and `socks-proxy-agent@10` are ESM-only, and the main
 * process is bundled as CommonJS, so they are loaded via dynamic import and the
 * agent is cached as a singleton.
 */

const PROXY_URL = process.env.TOR_SOCKS_PROXY || 'socks5h://127.0.0.1:19051'
const RPC_URL = process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org'
const NETWORK = { chainId: 84532, name: 'base-sepolia' }

type NodeFetch = (typeof import('node-fetch'))['default']
type FetchArgs = Parameters<NodeFetch>
type FetchResult = Awaited<ReturnType<NodeFetch>>

let _fetch: NodeFetch | null = null
let _agent: SocksAgent | null = null
let _provider: ethers.JsonRpcProvider | null = null

/**
 * Fail closed: refuse to make any Node-side request unless Tor reports ready, so
 * we never silently fall back to a direct (IP-leaking) connection.
 */
function assertTorReady(): void {
  const { state } = getTorStatus()
  if (state !== 'ready') {
    throw new Error(
      `Tor is not ready (status: ${state}). Refusing to make a network request that would ` +
        `leak your IP address. Wait for the Tor circuit to connect and try again.`
    )
  }
}

/** Lazily load the ESM deps and build the shared SOCKS agent + fetch. */
async function ensureLoaded(): Promise<{ fetch: NodeFetch; agent: SocksAgent }> {
  if (!_fetch) {
    _fetch = (await import('node-fetch')).default
  }
  if (!_agent) {
    const { SocksProxyAgent } = await import('socks-proxy-agent')
    _agent = new SocksProxyAgent(PROXY_URL)
  }
  return { fetch: _fetch, agent: _agent }
}

/** Warm up the transport (loads ESM deps + builds the agent). Optional. */
export async function initTorTransport(): Promise<void> {
  await ensureLoaded()
}

/** The shared SOCKS agent, for reuse. Throws if the transport isn't loaded yet. */
export function getTorAgent(): SocksAgent {
  if (!_agent) {
    throw new Error(
      'Tor transport not initialized. Call initTorTransport() (or use torFetch/getProxiedProvider) first.'
    )
  }
  return _agent
}

/**
 * fetch() that always egresses through the Tor SOCKS proxy. Use this instead of
 * global fetch anywhere in the main process.
 */
export async function torFetch(url: FetchArgs[0], options: FetchArgs[1] = {}): Promise<FetchResult> {
  assertTorReady()
  const { fetch, agent } = await ensureLoaded()
  return fetch(url, { ...options, agent })
}

/**
 * Same behavior as torFetch, typed as the WHATWG `globalThis.fetch` so it can be
 * handed to libraries that expect a `fetch` (e.g. the Web3.Storage upload
 * client's `options.fetch`). Backed by node-fetch + the SOCKS agent.
 */
export const torFetchGlobal = (async (input: FetchArgs[0], init?: FetchArgs[1]) => {
  return torFetch(input, init ?? {})
}) as unknown as typeof globalThis.fetch

/**
 * A single, reused ethers JsonRpcProvider whose HTTP transport goes through Tor.
 * The Tor-ready guard runs on every request (inside getUrlFunc), so a provider
 * built while Tor is down still fails closed once used.
 */
export function getProxiedProvider(): ethers.JsonRpcProvider {
  if (_provider) return _provider

  const fetchReq = new ethers.FetchRequest(RPC_URL)
  fetchReq.getUrlFunc = async (req, signal) => {
    assertTorReady()
    const { agent } = await ensureLoaded()
    return ethers.FetchRequest.createGetUrlFunc({ agent })(req, signal)
  }

  _provider = new ethers.JsonRpcProvider(fetchReq, NETWORK, { staticNetwork: true })
  return _provider
}

export { RPC_URL, NETWORK }
