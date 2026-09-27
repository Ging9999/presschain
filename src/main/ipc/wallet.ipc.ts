import { ipcMain } from 'electron'
import {
  createWallet,
  importWallet,
  unlockWallet,
  getAddress,
  walletExists,
  getBalance,
  exportMnemonic,
  lockWallet,
  clearWallet
} from '../services/wallet'
import { unlockKeystore, lockKeystore, clearKeystore } from '../services/keystore'
import {
  listArticles,
  flagArticle,
  proposeRemoval,
  getGovernanceParams
} from '../services/contract'
import { getEncryptionPublicKeyHex } from '../services/identity'
import { getStore } from '../store'

/**
 * Wallet + contract-write + app-level IPC (Prompts 4–5).
 *
 * The passphrase used for the wallet also unlocks the article keystore, so a
 * single unlock at session start enables both signing and key storage/retrieval.
 */
export function registerWalletIpc(): void {
  ipcMain.handle('wallet:exists', () => walletExists())
  ipcMain.handle('wallet:getAddress', () => getAddress())
  ipcMain.handle('wallet:getBalance', () => getBalance())

  ipcMain.handle('wallet:create', async (_e, { passphrase }) => {
    try {
      const result = await createWallet(passphrase)
      unlockKeystore(passphrase)
      return { success: true, ...result }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('wallet:import', async (_e, { mnemonic, passphrase }) => {
    try {
      const address = await importWallet(mnemonic, passphrase)
      unlockKeystore(passphrase)
      return { success: true, address }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('wallet:unlock', async (_e, { passphrase }) => {
    try {
      const address = await unlockWallet(passphrase)
      unlockKeystore(passphrase)
      return { success: true, address }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('wallet:exportMnemonic', async (_e, { passphrase }) => {
    try {
      const mnemonic = await exportMnemonic(passphrase)
      return { success: true, mnemonic }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('wallet:lock', () => {
    lockWallet()
    lockKeystore()
    return { success: true }
  })

  // The wallet's X25519 encryption public key — share it so authors can grant
  // you read access (envelope encryption).
  ipcMain.handle('wallet:getEncryptionPublicKey', () => {
    try {
      return { success: true, publicKey: getEncryptionPublicKeyHex() }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('article:list', async (_e, { offset = 0, limit = 20 } = {}) => {
    return listArticles(offset, limit)
  })

  ipcMain.handle('article:flag', async (_e, { articleId }) => {
    try {
      await flagArticle(articleId)
      return { success: true }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('article:proposeRemoval', async (_e, { articleId }) => {
    try {
      const proposalId = await proposeRemoval(articleId)
      return { success: true, proposalId }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('gov:getParams', async () => {
    try {
      return { success: true, params: await getGovernanceParams() }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  // Danger zone: wipe all local stores (wallet, keystore, app settings).
  ipcMain.handle('app:deleteAllData', () => {
    try {
      clearWallet()
      clearKeystore()
      getStore().clear()
      return { success: true }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
}
