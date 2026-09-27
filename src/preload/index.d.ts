import { ElectronAPI } from '@electron-toolkit/preload'

export type TorState = 'starting' | 'ready' | 'error'

export interface TorStatus {
  state: TorState
  progress: number
}

/** On-chain article metadata as returned by the contract listing. */
export interface ArticleMeta {
  id: number
  title: string
  summary: string
  uploader: string
  timestamp: number
  status: 0 | 1 | 2 // Active | Flagged | Removed
  flagCount: number
  cid?: string
}

export interface UploadPayload {
  title: string
  summary: string
  body: string
  /** X25519 recipient public keys (hex) to grant read access to. */
  recipients?: string[]
  /** Publish the AES key in the clear — world-readable, irreversible. */
  makePublic?: boolean
}

export interface UploadResult {
  success: boolean
  articleId?: number
  cid?: string
  recipientCount?: number
  isPublic?: boolean
  error?: string
}

export interface ReadResult {
  body?: string
  error?: string
  /** For KEY_NOT_FOUND: distinguishes not-a-recipient from no-key-at-all. */
  reason?: 'not_a_recipient' | 'no_key'
  message?: string
}

export interface WalletResult {
  success: boolean
  address?: string
  mnemonic?: string
  error?: string
}

export interface OkResult {
  success: boolean
  error?: string
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

export interface PressChainApi {
  tor: {
    getStatus: () => Promise<TorStatus>
    newCircuit: () => Promise<OkResult>
    /** Subscribe to live bootstrap progress; returns an unsubscribe function. */
    onProgress: (cb: (progress: number) => void) => () => void
  }
  wallet: {
    create: (data: { passphrase: string }) => Promise<WalletResult>
    import: (data: { mnemonic: string; passphrase: string }) => Promise<WalletResult>
    unlock: (data: { passphrase: string }) => Promise<WalletResult>
    lock: () => Promise<OkResult>
    exportMnemonic: (data: { passphrase: string }) => Promise<WalletResult>
    getAddress: () => Promise<string | null>
    getBalance: () => Promise<string>
    getEncryptionPublicKey: () => Promise<{ success: boolean; publicKey?: string; error?: string }>
    exists: () => Promise<boolean>
  }
  article: {
    upload: (data: UploadPayload) => Promise<UploadResult>
    list: (params?: { offset?: number; limit?: number }) => Promise<ArticleMeta[]>
    read: (data: { articleId: string | number; cid: string }) => Promise<ReadResult>
    getCID: (data: { articleId: number }) => Promise<{ cid?: string; error?: string }>
    flag: (data: { articleId: number }) => Promise<OkResult>
    proposeRemoval: (data: { articleId: number }) => Promise<OkResult & { proposalId?: number }>
  }
  ipfs: {
    setup: (data: { email: string }) => Promise<OkResult>
    status: () => Promise<{ configured: boolean }>
  }
  gov: {
    getParams: () => Promise<{ success: boolean; params?: GovernanceParams; error?: string }>
  }
  app: {
    deleteAllData: () => Promise<OkResult>
  }
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: PressChainApi
  }
}
