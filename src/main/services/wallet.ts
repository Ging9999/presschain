import { ethers } from 'ethers'
import Store from 'electron-store'
import { getProxiedProvider } from './torTransport'

// electron-store reads app.getPath('userData'), only valid after the app is
// ready, so the instance is created lazily rather than at import time.
let _store: Store<{ encryptedWallet: string }> | null = null
function walletStore(): Store<{ encryptedWallet: string }> {
  if (!_store) _store = new Store<{ encryptedWallet: string }>({ name: 'wallet' })
  return _store
}

// createRandom()/fromPhrase() return HDNodeWallet; fromEncryptedJson() returns a
// Wallet or HDNodeWallet. BaseWallet is the common signer base for all of them.
let _wallet: ethers.BaseWallet | null = null

// The provider's HTTP transport egresses through the Tor SOCKS proxy (see
// torTransport.ts). Every RPC request fails closed if Tor is not ready.
function getProvider(): ethers.JsonRpcProvider {
  return getProxiedProvider()
}

/** Create a new wallet and encrypt it with the user's passphrase. */
export async function createWallet(
  passphrase: string
): Promise<{ address: string; mnemonic: string }> {
  const wallet = ethers.Wallet.createRandom(getProvider())
  // ethers v6 encrypt(password, progressCb?) — scrypt params are fixed at a
  // strong default (N = 2^18), so no options object is passed.
  const encrypted = await wallet.encrypt(passphrase)
  walletStore().set('encryptedWallet', encrypted)
  _wallet = wallet
  return {
    address: wallet.address,
    mnemonic: wallet.mnemonic!.phrase
  }
}

/** Import an existing wallet by mnemonic and passphrase. */
export async function importWallet(mnemonic: string, passphrase: string): Promise<string> {
  const wallet = ethers.Wallet.fromPhrase(mnemonic, getProvider())
  const encrypted = await wallet.encrypt(passphrase)
  walletStore().set('encryptedWallet', encrypted)
  _wallet = wallet
  return wallet.address
}

/** Decrypt and load the wallet into memory for this session. */
export async function unlockWallet(passphrase: string): Promise<string> {
  const encrypted = walletStore().get('encryptedWallet')
  if (!encrypted) throw new Error('NO_WALLET')
  _wallet = (await ethers.Wallet.fromEncryptedJson(encrypted, passphrase)).connect(getProvider())
  return _wallet.address
}

export function getAddress(): string | null {
  return _wallet?.address ?? null
}

export function walletExists(): boolean {
  return walletStore().has('encryptedWallet')
}

export function getWallet(): ethers.BaseWallet {
  if (!_wallet) throw new Error('Wallet locked')
  return _wallet
}

export async function getBalance(): Promise<string> {
  if (!_wallet) throw new Error('Wallet locked')
  const balance = await getProvider().getBalance(_wallet.address)
  return ethers.formatEther(balance)
}

/** Decrypt the stored wallet with the passphrase and return its mnemonic phrase. */
export async function exportMnemonic(passphrase: string): Promise<string> {
  const encrypted = walletStore().get('encryptedWallet')
  if (!encrypted) throw new Error('NO_WALLET')
  const wallet = await ethers.Wallet.fromEncryptedJson(encrypted, passphrase)
  const phrase = 'mnemonic' in wallet ? wallet.mnemonic?.phrase : undefined
  if (!phrase) throw new Error('This wallet has no recoverable mnemonic.')
  return phrase
}

/** Clear the in-memory wallet (locks it for this session). */
export function lockWallet(): void {
  _wallet = null
}

/** Delete the stored wallet entirely (used by "Delete all local data"). */
export function clearWallet(): void {
  _wallet = null
  walletStore().clear()
}
