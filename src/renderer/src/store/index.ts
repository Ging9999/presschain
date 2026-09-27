import { create } from 'zustand'
import type { TorState, ArticleMeta } from '../types'

export type Gate = 'loading' | 'onboard' | 'unlock' | 'ready'

interface AppStore {
  // Auth / routing gate
  gate: Gate
  setGate: (g: Gate) => void
  refreshGate: () => Promise<void>

  // Wallet
  walletAddress: string | null
  setWalletAddress: (a: string | null) => void

  // Mid-session "wallet locked" modal overlay
  showUnlock: boolean
  setShowUnlock: (v: boolean) => void

  // Tor
  torStatus: TorState
  torProgress: number
  setTorStatus: (s: TorState, p: number) => void

  // Articles (Browse)
  articles: ArticleMeta[]
  setArticles: (a: ArticleMeta[]) => void
}

export const useAppStore = create<AppStore>((set) => ({
  gate: 'loading',
  setGate: (gate) => set({ gate }),
  refreshGate: async () => {
    try {
      const exists = await window.api.wallet.exists()
      if (!exists) {
        set({ gate: 'onboard', walletAddress: null })
        return
      }
      const address = await window.api.wallet.getAddress()
      set({ gate: address ? 'ready' : 'unlock', walletAddress: address })
    } catch {
      // No bridge available (e.g. opened outside Electron) — start onboarding.
      set({ gate: 'onboard' })
    }
  },

  walletAddress: null,
  setWalletAddress: (walletAddress) => set({ walletAddress }),

  showUnlock: false,
  setShowUnlock: (showUnlock) => set({ showUnlock }),

  torStatus: 'starting',
  torProgress: 0,
  setTorStatus: (torStatus, torProgress) => set({ torStatus, torProgress }),

  articles: [],
  setArticles: (articles) => set({ articles })
}))
