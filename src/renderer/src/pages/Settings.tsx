import { useEffect, useState } from 'react'
import { Copy, Check, Wifi, Cloud, ShieldAlert, Lock, Trash2, Eye } from 'lucide-react'
import { useAppStore } from '../store'
import { truncateAddress } from '../lib/format'
import ErrorCallout, { humanizeError } from '../components/ErrorCallout'
import Spinner from '../components/Spinner'

function Section({
  icon,
  title,
  children
}: {
  icon: React.ReactNode
  title: string
  children: React.ReactNode
}): JSX.Element {
  return (
    <section className="border border-edge bg-panel">
      <div className="flex items-center gap-2 border-b border-edge px-5 py-3">
        {icon}
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted">{title}</h3>
      </div>
      <div className="p-5">{children}</div>
    </section>
  )
}

export default function Settings(): JSX.Element {
  const walletAddress = useAppStore((s) => s.walletAddress)
  const setWalletAddress = useAppStore((s) => s.setWalletAddress)
  const torStatus = useAppStore((s) => s.torStatus)
  const torProgress = useAppStore((s) => s.torProgress)
  const refreshGate = useAppStore((s) => s.refreshGate)

  const [balance, setBalance] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [pubKey, setPubKey] = useState<string | null>(null)
  const [copiedKey, setCopiedKey] = useState(false)

  useEffect(() => {
    let mounted = true
    if (!walletAddress) {
      window.api.wallet
        .getAddress()
        .then((a) => mounted && setWalletAddress(a))
        .catch(() => undefined)
    }
    window.api.wallet
      .getBalance()
      .then((b) => mounted && setBalance(b))
      .catch(() => mounted && setBalance(null))
    window.api.wallet
      .getEncryptionPublicKey()
      .then((r) => mounted && setPubKey(r.success ? (r.publicKey ?? null) : null))
      .catch(() => undefined)
    return () => {
      mounted = false
    }
  }, [walletAddress, setWalletAddress])

  const copyAddress = async (): Promise<void> => {
    if (!walletAddress) return
    try {
      await navigator.clipboard.writeText(walletAddress)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable */
    }
  }

  const copyPubKey = async (): Promise<void> => {
    if (!pubKey) return
    try {
      await navigator.clipboard.writeText(pubKey)
      setCopiedKey(true)
      setTimeout(() => setCopiedKey(false), 1500)
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-8 py-10">
      <header>
        <h2 className="text-2xl font-bold">Settings</h2>
        <p className="mt-1 text-sm text-muted">Identity, network and storage.</p>
      </header>

      {/* 1. Wallet */}
      <Section icon={<Lock size={16} className="text-accent" />} title="Wallet">
        <div className="space-y-4 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted">Address</span>
            <div className="flex items-center gap-2">
              <code className="text-accent" title={walletAddress ?? ''}>
                {truncateAddress(walletAddress)}
              </code>
              <button
                onClick={copyAddress}
                className="text-muted hover:text-primary"
                title="Copy address"
              >
                {copied ? <Check size={14} className="text-accent" /> : <Copy size={14} />}
              </button>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted">Balance</span>
            <span className="font-mono text-primary">
              {balance === null ? '—' : `${Number(balance).toFixed(5)} ETH`}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted">Network</span>
            <span className="text-primary">Base Sepolia (Testnet)</span>
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-muted">Encryption public key</span>
              <button
                onClick={copyPubKey}
                disabled={!pubKey}
                className="text-muted hover:text-primary disabled:opacity-40"
                title="Copy encryption public key"
              >
                {copiedKey ? <Check size={14} className="text-accent" /> : <Copy size={14} />}
              </button>
            </div>
            <code className="block break-all font-mono text-[11px] text-primary">
              {pubKey ?? '—'}
            </code>
            <p className="mt-1 text-[11px] text-muted">
              Share this so authors can grant you read access to their articles. It is not your
              wallet address and not a secret.
            </p>
          </div>
          <ExportMnemonic />
        </div>
      </Section>

      {/* 2. Tor */}
      <Section icon={<Wifi size={16} className="text-accent" />} title="Tor">
        <TorSection status={torStatus} progress={torProgress} />
      </Section>

      {/* 3. IPFS */}
      <Section icon={<Cloud size={16} className="text-accent" />} title="Web3.Storage (IPFS)">
        <IpfsSection />
      </Section>

      {/* 4. Danger zone */}
      <Section icon={<ShieldAlert size={16} className="text-danger" />} title="Danger zone">
        <DangerZone
          onLock={async () => {
            await window.api.wallet.lock()
            await refreshGate()
          }}
          onDelete={async () => {
            await window.api.app.deleteAllData()
            await refreshGate()
          }}
        />
      </Section>
    </div>
  )
}

function ExportMnemonic(): JSX.Element {
  const [open, setOpen] = useState(false)
  const [passphrase, setPassphrase] = useState('')
  const [mnemonic, setMnemonic] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const reveal = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const res = await window.api.wallet.exportMnemonic({ passphrase })
      if (!res.success || !res.mnemonic) {
        setError(res.error ?? 'Incorrect passphrase.')
        return
      }
      setMnemonic(res.mnemonic)
    } catch (err) {
      setError(humanizeError(err instanceof Error ? err.message : String(err)))
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 border border-edge px-3 py-2 text-xs font-semibold text-muted hover:text-primary"
      >
        <Eye size={14} /> Export mnemonic
      </button>
    )
  }

  return (
    <div className="border border-edge bg-input p-4">
      {mnemonic ? (
        <>
          <p className="mb-2 text-xs text-danger">Keep this secret. Anyone with it controls your wallet.</p>
          <div className="grid grid-cols-3 gap-2 font-mono text-xs text-primary">
            {mnemonic.split(/\s+/).map((w, i) => (
              <span key={i}>
                <span className="mr-1 text-muted">{i + 1}</span>
                {w}
              </span>
            ))}
          </div>
          <button
            onClick={() => {
              setMnemonic(null)
              setOpen(false)
              setPassphrase('')
            }}
            className="mt-3 text-xs text-muted underline hover:text-primary"
          >
            Hide
          </button>
        </>
      ) : (
        <>
          <p className="mb-2 text-xs text-muted">Re-enter your passphrase to reveal your recovery phrase.</p>
          {error && <ErrorCallout message={error} className="mb-2" />}
          <div className="flex gap-2">
            <input
              type="password"
              autoFocus
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && passphrase && !busy && reveal()}
              placeholder="Passphrase"
              className="flex-1 border border-edge bg-base px-3 py-2 text-sm text-primary outline-none focus:border-accent"
            />
            <button
              onClick={reveal}
              disabled={busy || !passphrase}
              className="flex items-center gap-2 bg-accent px-3 py-2 text-xs font-semibold text-base hover:bg-accent-dim disabled:opacity-50"
            >
              {busy && <Spinner size={12} />} Reveal
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function TorSection({ status, progress }: { status: string; progress: number }): JSX.Element {
  const [busy, setBusy] = useState(false)
  const label = status === 'ready' ? 'Connected' : status === 'error' ? 'Error' : 'Connecting…'

  const newCircuit = async (): Promise<void> => {
    setBusy(true)
    try {
      await window.api.tor.newCircuit()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4 text-sm">
      <div className="flex items-center justify-between">
        <span className="text-muted">Status</span>
        <span className="flex items-center gap-2">
          <span
            className={`inline-block h-2.5 w-2.5 rounded-full ${status === 'ready' ? 'bg-accent' : 'bg-danger'}`}
          />
          <span className={status === 'ready' ? 'text-accent' : 'text-primary'}>
            {label}
            {status === 'starting' ? ` (${progress}%)` : ''}
          </span>
        </span>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-muted">SOCKS proxy</span>
        <code className="text-primary">127.0.0.1:19051</code>
      </div>
      <button
        onClick={newCircuit}
        disabled={busy}
        className="flex items-center gap-2 border border-edge px-3 py-2 text-xs font-semibold text-muted hover:text-primary disabled:opacity-50"
      >
        {busy && <Spinner size={12} />} New Circuit
      </button>
    </div>
  )
}

function IpfsSection(): JSX.Element {
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [relinking, setRelinking] = useState(false)

  useEffect(() => {
    let mounted = true
    window.api.ipfs
      .status()
      .then((s) => mounted && setConfigured(s.configured))
      .catch(() => mounted && setConfigured(false))
    return () => {
      mounted = false
    }
  }, [])

  const relink = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const res = await window.api.ipfs.setup({ email })
      if (!res.success) {
        setError(res.error ?? 'Setup failed.')
        return
      }
      setConfigured(true)
      setRelinking(false)
    } catch (err) {
      setError(humanizeError(err instanceof Error ? err.message : String(err)))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4 text-sm">
      <div className="flex items-center justify-between">
        <span className="text-muted">Status</span>
        <span className={configured ? 'text-accent' : 'text-warning'}>
          {configured === null ? '—' : configured ? 'Linked' : 'Not linked'}
        </span>
      </div>
      {error && <ErrorCallout message={error} />}
      {relinking ? (
        <div className="flex gap-2">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="flex-1 border border-edge bg-input px-3 py-2 text-sm text-primary outline-none focus:border-accent"
          />
          <button
            onClick={relink}
            disabled={busy || !email.includes('@')}
            className="flex items-center gap-2 bg-accent px-3 py-2 text-xs font-semibold text-base hover:bg-accent-dim disabled:opacity-50"
          >
            {busy && <Spinner size={12} />} Link
          </button>
        </div>
      ) : (
        <button
          onClick={() => setRelinking(true)}
          className="border border-edge px-3 py-2 text-xs font-semibold text-muted hover:text-primary"
        >
          Re-link Web3.Storage account
        </button>
      )}
    </div>
  )
}

function DangerZone({
  onLock,
  onDelete
}: {
  onLock: () => Promise<void>
  onDelete: () => Promise<void>
}): JSX.Element {
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [busy, setBusy] = useState(false)

  return (
    <div className="space-y-4 text-sm">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-primary">Lock wallet</div>
          <div className="text-xs text-muted">Clears the session passphrase.</div>
        </div>
        <button
          onClick={onLock}
          className="border border-edge px-3 py-2 text-xs font-semibold text-muted hover:text-primary"
        >
          Lock
        </button>
      </div>

      <div className="flex items-start justify-between border-t border-edge pt-4">
        <div>
          <div className="text-danger">Delete all local data</div>
          <div className="text-xs text-muted">
            Wallet, keys and settings. This cannot be undone.
          </div>
        </div>
        {!confirmingDelete ? (
          <button
            onClick={() => setConfirmingDelete(true)}
            className="flex items-center gap-2 border border-danger/60 px-3 py-2 text-xs font-semibold text-danger hover:bg-danger/10"
          >
            <Trash2 size={14} /> Delete
          </button>
        ) : (
          <div className="flex gap-2">
            <button
              onClick={() => setConfirmingDelete(false)}
              className="border border-edge px-3 py-2 text-xs font-semibold text-muted hover:text-primary"
            >
              Cancel
            </button>
            <button
              onClick={async () => {
                setBusy(true)
                await onDelete()
              }}
              disabled={busy}
              className="flex items-center gap-2 bg-danger px-3 py-2 text-xs font-semibold text-base hover:opacity-90 disabled:opacity-50"
            >
              {busy && <Spinner size={12} />} Confirm delete
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
