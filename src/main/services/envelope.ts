import nacl from 'tweetnacl'
import {
  type EncryptedArticle,
  serializeEncrypted,
  deserializeEncrypted
} from './encryption'

/**
 * Envelope encryption for sharing article read access.
 *
 * The per-article AES key is wrapped to each recipient's X25519 public key using
 * ephemeral-static ECDH (nacl.box). Wrapped keys travel inside the IPFS payload
 * — never on-chain, and never as plaintext (unless the author explicitly makes
 * the article public).
 */

export interface WrappedKey {
  epk: string // ephemeral public key (hex)
  nonce: string // hex
  boxed: string // wrapped AES key (hex)
}

export interface AccessEnvelope {
  v: 1
  /** When true, the AES key is stored in the clear (world-readable, irreversible). */
  public: boolean
  /** Hex AES key — present ONLY when `public` is true. */
  publicKey?: string
  /** AES key wrapped to each recipient's X25519 public key. */
  recipients: WrappedKey[]
}

const hexToBytes = (hex: string): Uint8Array => new Uint8Array(Buffer.from(hex.replace(/^0x/, ''), 'hex'))
const bytesToHex = (b: Uint8Array): string => Buffer.from(b).toString('hex')

/** Wrap the AES key to a recipient's X25519 public key (ephemeral-static). */
export function wrapKeyForRecipient(recipientPublicKeyHex: string, aesKey: Buffer): WrappedKey {
  const recipientPub = hexToBytes(recipientPublicKeyHex)
  if (recipientPub.length !== nacl.box.publicKeyLength) {
    throw new Error('Invalid recipient public key (expected 32-byte X25519 hex).')
  }
  const ephemeral = nacl.box.keyPair()
  const nonce = nacl.randomBytes(nacl.box.nonceLength)
  const boxed = nacl.box(new Uint8Array(aesKey), nonce, recipientPub, ephemeral.secretKey)
  return { epk: bytesToHex(ephemeral.publicKey), nonce: bytesToHex(nonce), boxed: bytesToHex(boxed) }
}

/** Try to unwrap a wrapped key with our X25519 secret key. Returns null if it isn't for us. */
export function unwrapKey(w: WrappedKey, mySecretKey: Uint8Array): Buffer | null {
  try {
    const opened = nacl.box.open(hexToBytes(w.boxed), hexToBytes(w.nonce), hexToBytes(w.epk), mySecretKey)
    return opened ? Buffer.from(opened) : null
  } catch {
    return null
  }
}

/**
 * IPFS payload = [4-byte envelope length][envelope JSON][serialized ciphertext].
 * The trailing serialized ciphertext is byte-identical to the pre-envelope format,
 * so the on-chain ciphertextHash (SHA-256 of the ciphertext) and the C4 integrity
 * check are unaffected by the envelope.
 */
export function serializeWithEnvelope(env: AccessEnvelope, encrypted: EncryptedArticle): Buffer {
  const envBytes = Buffer.from(JSON.stringify(env), 'utf8')
  const len = Buffer.alloc(4)
  len.writeUInt32BE(envBytes.length)
  return Buffer.concat([len, envBytes, serializeEncrypted(encrypted)])
}

export function deserializeWithEnvelope(data: Buffer): {
  env: AccessEnvelope
  encrypted: EncryptedArticle
} {
  const envLen = data.readUInt32BE(0)
  const env = JSON.parse(data.subarray(4, 4 + envLen).toString('utf8')) as AccessEnvelope
  const encrypted = deserializeEncrypted(data.subarray(4 + envLen))
  return { env, encrypted }
}
