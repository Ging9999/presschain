import Store from 'electron-store'
import { createHash, randomBytes, scryptSync, createCipheriv, createDecipheriv } from 'crypto'

// Keys stored as: { [articleId]: hex-encoded encrypted key bundle }
// Bundle format: [16 bytes salt][12 bytes iv][16 bytes authTag][32 bytes encrypted key]
interface KeystoreSchema {
  keys: Record<string, string>
  passHash: string
}

// scrypt with N=131072 needs ~128 MiB, which exceeds the default 32 MiB maxmem
// cap — raise it so key derivation doesn't throw.
const SCRYPT_MAXMEM = 256 * 1024 * 1024

// electron-store reads app.getPath('userData'), only valid after app is ready,
// so the instance is created lazily on first use rather than at import time.
let _store: Store<KeystoreSchema> | null = null
function store(): Store<KeystoreSchema> {
  if (!_store) {
    _store = new Store<KeystoreSchema>({
      name: 'keystore',
      encryptionKey: 'presschain-keystore-v1' // electron-store's own encryption (Electron safeStorage)
    })
  }
  return _store
}

let _passphrase: string | null = null

function deriveKEK(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, 32, { N: 131072, r: 8, p: 1, maxmem: SCRYPT_MAXMEM })
}

/** Set the passphrase for this session. Call at startup after user enters it. */
export function unlockKeystore(passphrase: string): boolean {
  const storedHash = store().get('passHash')
  const hash = createHash('sha256').update(passphrase).digest('hex')
  if (storedHash && storedHash !== hash) return false
  if (!storedHash) {
    store().set('passHash', hash) // first run, store hash
  }
  _passphrase = passphrase
  return true
}

/** Whether a passphrase has been set for this session. */
export function isUnlocked(): boolean {
  return _passphrase !== null
}

/** Store an article key. Encrypts it under the user's passphrase. */
export function storeArticleKey(articleId: string, key: Buffer): void {
  if (!_passphrase) throw new Error('Keystore locked')
  const salt = randomBytes(16)
  const kek = deriveKEK(_passphrase, salt)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', kek, iv)
  const encrypted = Buffer.concat([cipher.update(key), cipher.final()])
  const authTag = cipher.getAuthTag()
  const bundle = Buffer.concat([salt, iv, authTag, encrypted])
  const keys = store().get('keys', {})
  keys[articleId] = bundle.toString('hex')
  store().set('keys', keys)
}

/** Retrieve an article key. Returns null if not held locally (not uploader). */
export function getArticleKey(articleId: string): Buffer | null {
  if (!_passphrase) throw new Error('Keystore locked')
  const keys = store().get('keys', {})
  const bundleHex = keys[articleId]
  if (!bundleHex) return null
  const bundle = Buffer.from(bundleHex, 'hex')
  const salt = bundle.subarray(0, 16)
  const iv = bundle.subarray(16, 28)
  const authTag = bundle.subarray(28, 44)
  const encrypted = bundle.subarray(44)
  const kek = deriveKEK(_passphrase, salt)
  const decipher = createDecipheriv('aes-256-gcm', kek, iv)
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(encrypted), decipher.final()])
}

/** Crypto-shred: delete the local key, making our copy of the article unreadable. */
export function deleteArticleKey(articleId: string): void {
  const keys = store().get('keys', {})
  delete keys[articleId]
  store().set('keys', keys)
}

/** List article IDs for which we hold a key */
export function listOwnedArticleIds(): string[] {
  return Object.keys(store().get('keys', {}))
}

/** Clear the in-session passphrase (locks the keystore). */
export function lockKeystore(): void {
  _passphrase = null
}

/** Wipe all stored keys and the passphrase hash (used by "Delete all local data"). */
export function clearKeystore(): void {
  _passphrase = null
  store().clear()
}

/** Re-key a temporary article id to its final on-chain id (used in Prompt 4). */
export function rekeyArticle(tempId: string, finalId: string): void {
  const keys = store().get('keys', {})
  if (keys[tempId] === undefined) return
  keys[finalId] = keys[tempId]
  delete keys[tempId]
  store().set('keys', keys)
}
