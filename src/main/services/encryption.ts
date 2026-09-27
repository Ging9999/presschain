import { randomBytes, createCipheriv, createDecipheriv, createHash, timingSafeEqual } from 'crypto'

export interface EncryptedArticle {
  ciphertext: Buffer // the encrypted content
  iv: Buffer // 12 bytes for GCM
  authTag: Buffer // 16 bytes GCM auth tag
  ciphertextHash: string // hex-encoded SHA-256 of ciphertext (for on-chain integrity)
}

/** Generate a fresh 256-bit AES key for one article */
export function generateArticleKey(): Buffer {
  return randomBytes(32)
}

/** Encrypt article content with AES-256-GCM */
export function encryptArticle(plaintext: string, key: Buffer): EncryptedArticle {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  const hash = createHash('sha256').update(ciphertext).digest('hex')
  return { ciphertext, iv, authTag, ciphertextHash: hash }
}

/** Decrypt article content */
export function decryptArticle(encrypted: EncryptedArticle, key: Buffer): string {
  const decipher = createDecipheriv('aes-256-gcm', key, encrypted.iv)
  decipher.setAuthTag(encrypted.authTag)
  return Buffer.concat([decipher.update(encrypted.ciphertext), decipher.final()]).toString('utf8')
}

/** Serialize encrypted article to a single Buffer for IPFS upload */
export function serializeEncrypted(e: EncryptedArticle): Buffer {
  // Format: [4 bytes: iv length][iv][4 bytes: authTag length][authTag][rest: ciphertext]
  const ivLen = Buffer.alloc(4)
  ivLen.writeUInt32BE(e.iv.length)
  const tagLen = Buffer.alloc(4)
  tagLen.writeUInt32BE(e.authTag.length)
  return Buffer.concat([ivLen, e.iv, tagLen, e.authTag, e.ciphertext])
}

/** Deserialize from IPFS-fetched Buffer */
export function deserializeEncrypted(data: Buffer): EncryptedArticle {
  let offset = 0
  const ivLen = data.readUInt32BE(offset)
  offset += 4
  const iv = data.subarray(offset, offset + ivLen)
  offset += ivLen
  const tagLen = data.readUInt32BE(offset)
  offset += 4
  const authTag = data.subarray(offset, offset + tagLen)
  offset += tagLen
  const ciphertext = data.subarray(offset)
  const hash = createHash('sha256').update(ciphertext).digest('hex')
  return { ciphertext, iv, authTag, ciphertextHash: hash }
}

/**
 * Constant-time compare of a computed ciphertext hash (hex, from
 * encrypt/deserialize) against the value stored on-chain (a bytes32, e.g.
 * "0x…"). Normalises both to raw 32-byte buffers before comparing so hex-vs-bytes
 * and 0x-prefix differences don't matter. Returns false on any malformed input
 * rather than throwing.
 */
export function ciphertextHashMatches(computedHex: string, onchainHash: string): boolean {
  try {
    const a = Buffer.from(computedHex.replace(/^0x/i, '').toLowerCase(), 'hex')
    const b = Buffer.from(onchainHash.replace(/^0x/i, '').toLowerCase(), 'hex')
    // SHA-256 is 32 bytes; reject anything that isn't (e.g. an unset on-chain
    // hash of all zeros still has length 32 and will simply not match).
    if (a.length !== 32 || b.length !== 32) return false
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}
