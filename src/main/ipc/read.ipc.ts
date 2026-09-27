import { ipcMain } from 'electron'
import { fetchFromIPFS } from '../services/ipfs'
import { decryptArticle, ciphertextHashMatches } from '../services/encryption'
import { deserializeWithEnvelope, unwrapKey } from '../services/envelope'
import { getArticleKey } from '../services/keystore'
import { getEncryptionKeyPair } from '../services/identity'
import { getArticleCID, getCiphertextHash } from '../services/contract'

interface ReadInput {
  articleId: string | number
  cid: string
}

/**
 * Read IPC. Fetches the payload from IPFS and resolves the AES key from, in order:
 *   1. the clear key, if the article was published publicly;
 *   2. the local keystore (we're the uploader);
 *   3. an envelope entry wrapped to our wallet's X25519 key (we're a recipient).
 * Then runs the C4 integrity check and decrypts. If we can't get the key, the
 * error distinguishes "not a recipient" from "no key at all".
 */
export function registerReadIpc(): void {
  ipcMain.handle('article:read', async (_event, data: ReadInput) => {
    try {
      const { articleId, cid } = data ?? ({} as ReadInput)
      if (!cid) {
        return { error: 'READ_FAILED', message: 'Missing IPFS CID.' }
      }

      // Fetch + split the envelope from the ciphertext.
      const raw = await fetchFromIPFS(cid)
      const { env, encrypted } = deserializeWithEnvelope(raw)

      // Resolve the AES key.
      let key: Buffer | null = null

      // 1. Public article — key in the clear.
      if (env.public && env.publicKey) {
        key = Buffer.from(env.publicKey, 'hex')
      }

      // 2. We're the uploader — key held locally.
      if (!key) {
        try {
          key = getArticleKey(String(articleId))
        } catch {
          return { error: 'KEYSTORE_LOCKED', message: 'Unlock your keystore first.' }
        }
      }

      // 3. We're a recipient — unwrap with our X25519 secret key.
      if (!key && env.recipients.length > 0) {
        let secretKey: Uint8Array
        try {
          secretKey = getEncryptionKeyPair().secretKey
        } catch {
          return { error: 'KEYSTORE_LOCKED', message: 'Unlock your wallet first.' }
        }
        for (const wrapped of env.recipients) {
          const unwrapped = unwrapKey(wrapped, secretKey)
          if (unwrapped) {
            key = unwrapped
            break
          }
        }
      }

      // No key — distinguish "not a recipient" from "not shared with anyone".
      if (!key) {
        if (env.recipients.length > 0) {
          return {
            error: 'KEY_NOT_FOUND',
            reason: 'not_a_recipient',
            message:
              'This article is shared with specific readers and you are not one of them. Only the ' +
              'listed recipients (or the uploader) can decrypt it. Ask the author to add your public key.'
          }
        }
        return {
          error: 'KEY_NOT_FOUND',
          reason: 'no_key',
          message:
            'You did not upload this article and it was not shared with you. Only the uploader holds the ' +
            'decryption key.'
        }
      }

      // Integrity check BEFORE decrypting: SHA-256 of the fetched ciphertext vs
      // the on-chain value (a hostile gateway could serve altered bytes).
      const onchainHash = await getCiphertextHash(Number(articleId))
      if (!ciphertextHashMatches(encrypted.ciphertextHash, onchainHash)) {
        return {
          error: 'INTEGRITY_FAILURE',
          message:
            'This article failed its integrity check and may have been tampered with. It was not decrypted.'
        }
      }

      const body = decryptArticle(encrypted, key)
      return { body }
    } catch (err) {
      return { error: 'READ_FAILED', message: err instanceof Error ? err.message : String(err) }
    }
  })

  // Resolve an article's on-chain IPFS CID (Browse -> Read navigation).
  ipcMain.handle('article:getCID', async (_event, { articleId }) => {
    try {
      const cid = await getArticleCID(articleId)
      return { cid }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })
}
