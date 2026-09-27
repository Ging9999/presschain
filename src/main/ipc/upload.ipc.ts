import { ipcMain } from 'electron'
import { getStore } from '../store'
import { generateArticleKey, encryptArticle } from '../services/encryption'
import {
  wrapKeyForRecipient,
  serializeWithEnvelope,
  type AccessEnvelope,
  type WrappedKey
} from '../services/envelope'
import { getEncryptionPublicKeyHex } from '../services/identity'
import { uploadToIPFS, setupIPFS } from '../services/ipfs'
import { storeArticleKey } from '../services/keystore'
import { registerArticle } from '../services/contract'

interface UploadInput {
  title: string
  summary: string
  body: string
  /** Optional X25519 recipient public keys (hex) to grant read access to. */
  recipients?: string[]
  /** When true, store the AES key in the clear — world-readable (irreversible). */
  makePublic?: boolean
}

/**
 * Upload IPC: encrypt locally, wrap the per-article key to recipients (envelope
 * encryption — never on-chain), pin the payload to IPFS, register on-chain, then
 * keep the key in the local keystore for the author. Keystore/wallet are unlocked
 * together via the wallet IPC handlers.
 */
export function registerUploadIpc(): void {
  ipcMain.handle('article:upload', async (_e, data: UploadInput) => {
    try {
      const { title, summary, body, recipients = [], makePublic = false } = data ?? ({} as UploadInput)

      // 1. Fresh AES key + encrypt.
      const key = generateArticleKey()
      const encrypted = encryptArticle(body, key)

      // 2. Build the access envelope (wrapped keys — NEVER on-chain).
      const wrapped: WrappedKey[] = []
      // Always wrap to the author so they can read on any device with their wallet.
      const authorPub = getEncryptionPublicKeyHex()
      const recipientSet = new Set<string>([authorPub, ...recipients.map((r) => r.trim()).filter(Boolean)])
      for (const pub of recipientSet) {
        wrapped.push(wrapKeyForRecipient(pub, key))
      }
      const env: AccessEnvelope = {
        v: 1,
        public: makePublic,
        ...(makePublic ? { publicKey: key.toString('hex') } : {}),
        recipients: wrapped
      }
      const serialized = serializeWithEnvelope(env, encrypted)

      // 3. Upload to IPFS.
      const cid = await uploadToIPFS(serialized, `article-${Date.now()}.bin`)
      // 4. Register on-chain (only cid + ciphertextHash + title + summary — no key).
      const articleId = await registerArticle(cid, encrypted.ciphertextHash, title, summary)
      // 5. Keep the key locally for the author's fast access.
      storeArticleKey(String(articleId), key)

      return { success: true, articleId, cid, recipientCount: recipientSet.size, isPublic: makePublic }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('ipfs:status', () => {
    return { configured: getStore().get('ipfsProof') != null }
  })

  ipcMain.handle('ipfs:setup', async (_e, data: { email: string }) => {
    try {
      const email = data?.email
      if (!email || !email.includes('@')) {
        return { success: false, error: 'A valid email address is required.' }
      }
      const proof = await setupIPFS(email)
      getStore().set('ipfsProof', proof)
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}
