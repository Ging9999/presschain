import Store from 'electron-store'

/**
 * Shape of the persisted local vault. Wallet/article persistence is wired up in
 * later prompts — for now we only define the schema and provide the instance.
 */
export interface WalletRecord {
  address: string
  secret: string
}

export interface StoredArticle {
  id: string
  title: string
  author: string
  summary: string
  body?: string
  timestamp: number
  flagged?: boolean
}

export interface PressChainSchema {
  wallet: WalletRecord | null
  articles: StoredArticle[]
  /** Base64-encoded Web3.Storage (w3up) delegation proof, set after IPFS setup. */
  ipfsProof: string | null
}

let instance: Store<PressChainSchema> | null = null

/**
 * Lazily construct the electron-store instance. electron-store reads
 * app.getPath('userData'), which is only valid after the app is ready, so we
 * defer creation until first use rather than at import time.
 */
export function getStore(): Store<PressChainSchema> {
  if (!instance) {
    instance = new Store<PressChainSchema>({
      name: 'presschain',
      // At-rest obfuscation for the local vault. Real key management arrives
      // with the wallet/encryption work in a later prompt.
      encryptionKey: 'presschain-local-vault',
      defaults: {
        wallet: null,
        articles: [],
        ipfsProof: null
      }
    })
  }
  return instance
}
