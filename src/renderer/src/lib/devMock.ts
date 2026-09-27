/**
 * Development-only mock of `window.api`.
 *
 * It is installed ONLY when the renderer runs outside Electron (e.g. the Vite
 * dev server opened in a browser) where the preload bridge is absent. In the
 * packaged/Electron app `window.api` always exists, so this never runs there.
 * It exists purely to preview and lay out the UI without the full backend.
 */
// PressChainApi is exposed globally via the preload d.ts as Window['api'].
type Api = Window['api']

const delay = (ms = 300): Promise<void> => new Promise((r) => setTimeout(r, ms))

function createMockApi(): Api {
  const state = {
    exists: false,
    unlocked: false,
    address: '0x9F3aA1c4B2e77De0912345678abcDEF001122334',
    ipfs: false
  }

  const articles = [
    {
      id: 0,
      title: 'The Ministry Memo Nobody Was Meant to See',
      summary:
        'An internal directive shows the agency knew about the contamination months before the public was told.',
      uploader: '0x9F3aA1c4B2e77De0912345678abcDEF001122334',
      timestamp: Math.floor(Date.now() / 1000) - 3600 * 2,
      status: 0 as const,
      flagCount: 0
    },
    {
      id: 1,
      title: 'Field Notes from the Blockade',
      summary: 'First-hand reporting from inside the exclusion zone, smuggled out over three weeks.',
      uploader: '0x1234abcd5678ef901234abcd5678ef9012345678',
      timestamp: Math.floor(Date.now() / 1000) - 3600 * 26,
      status: 1 as const,
      flagCount: 7
    },
    {
      id: 2,
      title: 'Redacted',
      summary: 'Redacted',
      uploader: '0xdead00000000000000000000000000000000beef',
      timestamp: Math.floor(Date.now() / 1000) - 3600 * 96,
      status: 2 as const,
      flagCount: 12
    },
    {
      id: 3,
      title: 'The Numbers Behind the Official Story',
      summary: 'A statistical breakdown that contradicts three years of government press releases.',
      uploader: '0x1234abcd5678ef901234abcd5678ef9012345678',
      timestamp: Math.floor(Date.now() / 1000) - 3600 * 200,
      status: 0 as const,
      flagCount: 12
    }
  ]

  return {
    tor: {
      getStatus: async () => ({ state: 'ready' as const, progress: 100 }),
      newCircuit: async () => ({ success: true }),
      onProgress: () => () => undefined
    },
    wallet: {
      exists: async () => state.exists,
      getAddress: async () => (state.unlocked ? state.address : null),
      getBalance: async () => '0.04213',
      create: async ({ passphrase }) => {
        await delay()
        if (passphrase.length < 12) return { success: false, error: 'Passphrase too short.' }
        state.exists = true
        state.unlocked = true
        return {
          success: true,
          address: state.address,
          mnemonic:
            'ridge sample bounce spirit lunar oppose oxygen twelve pattern shed cabbage frame'
        }
      },
      import: async () => {
        state.exists = true
        state.unlocked = true
        return { success: true, address: state.address }
      },
      unlock: async ({ passphrase }) => {
        await delay()
        if (passphrase.length < 3) return { success: false, error: 'incorrect password' }
        state.unlocked = true
        return { success: true, address: state.address }
      },
      lock: async () => {
        state.unlocked = false
        return { success: true }
      },
      exportMnemonic: async ({ passphrase }) => {
        if (passphrase.length < 3) return { success: false, error: 'incorrect password' }
        return {
          success: true,
          mnemonic:
            'ridge sample bounce spirit lunar oppose oxygen twelve pattern shed cabbage frame'
        }
      },
      getEncryptionPublicKey: async () => ({
        success: true,
        publicKey: '11223344556677889900aabbccddeeff11223344556677889900aabbccddeeff'
      })
    },
    article: {
      upload: async ({ title }) => {
        await delay(1500)
        const id = articles.length
        articles.unshift({
          id,
          title,
          summary: 'Just published from this device.',
          uploader: state.address,
          timestamp: Math.floor(Date.now() / 1000),
          status: 0,
          flagCount: 0
        })
        return { success: true, articleId: id, cid: 'bafybeimockcidforpreview1234567890' }
      },
      list: async ({ offset = 0, limit = 20 } = {}) => {
        await delay()
        return articles.slice(offset, offset + limit)
      },
      read: async ({ articleId }) => {
        await delay()
        if (Number(articleId) === 0) {
          return {
            body:
              'The memo, dated three months before the first public advisory, is unambiguous.\n\n' +
              '"We are aware of elevated readings at sites 4 and 7," it reads. "Recommend no public statement pending legal review."\n\n' +
              'What follows is a detailed account of who knew what, and when — reconstructed from documents provided by two sources inside the agency.'
          }
        }
        return { error: 'KEY_NOT_FOUND' }
      },
      getCID: async () => ({ cid: 'bafybeimockcidforpreview1234567890' }),
      flag: async () => ({ success: true }),
      proposeRemoval: async () => ({ success: true, proposalId: 0 })
    },
    ipfs: {
      setup: async () => {
        await delay(800)
        state.ipfs = true
        return { success: true }
      },
      status: async () => ({ configured: state.ipfs })
    },
    gov: {
      getParams: async () => ({
        success: true,
        params: {
          flagStakeWei: '1000000000000000',
          voteStakeWei: '2000000000000000',
          flagStakeEth: '0.001',
          voteStakeEth: '0.002',
          flagThreshold: 10,
          minRemovalVotes: 5,
          flagCooldownSecs: 86400,
          votePeriodSecs: 259200
        }
      })
    },
    app: {
      deleteAllData: async () => {
        state.exists = false
        state.unlocked = false
        return { success: true }
      }
    }
  }
}

export function installDevMockIfNeeded(): void {
  if (typeof window === 'undefined') return
  const hasBridge = typeof (window as unknown as { api?: unknown }).api !== 'undefined'
  if (hasBridge) return
  // Only in dev builds; production Electron always has the real bridge.
  if (!import.meta.env.DEV) return
  ;(window as unknown as { api: Api }).api = createMockApi()
  // eslint-disable-next-line no-console
  console.info('[PressChain] Dev mock API installed (no Electron bridge detected).')
}
