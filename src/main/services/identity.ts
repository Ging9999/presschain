import nacl from 'tweetnacl'
import { createHash } from 'crypto'
import { getWallet } from './wallet'

/**
 * Per-wallet X25519 encryption keypair, used for ECIES-style envelope encryption
 * (sharing read access to articles).
 *
 * The keypair is derived deterministically from the wallet's signing key via a
 * domain-separated SHA-256, so it needs no extra storage and is recoverable from
 * the mnemonic. The derived key is one-way and independent of the secp256k1
 * signing key — it is never used for signing.
 *
 * Requires the wallet to be unlocked (getWallet()).
 */
const DOMAIN = 'presschain-x25519-v1'

function deriveSecret(): Uint8Array {
  const wallet = getWallet() // throws "Wallet locked" if not unlocked
  const privHex = wallet.privateKey.replace(/^0x/, '')
  const seed = createHash('sha256').update(Buffer.from(privHex, 'hex')).update(DOMAIN).digest()
  return new Uint8Array(seed) // 32 bytes; nacl clamps internally
}

/** The wallet's X25519 keypair (public + secret). */
export function getEncryptionKeyPair(): nacl.BoxKeyPair {
  return nacl.box.keyPair.fromSecretKey(deriveSecret())
}

/** Hex-encoded X25519 public key to share so others can encrypt to this wallet. */
export function getEncryptionPublicKeyHex(): string {
  return Buffer.from(getEncryptionKeyPair().publicKey).toString('hex')
}
