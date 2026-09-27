import { useState } from 'react'
import { ShieldCheck, KeyRound, Cloud, AlertTriangle, Lock } from 'lucide-react'
import { useAppStore } from '../store'
import ErrorCallout, { humanizeError } from '../components/ErrorCallout'
import Spinner from '../components/Spinner'

interface OnboardingProps {
  mode: 'create' | 'unlock'
}

function passphraseStrength(pass: string): { score: number; label: string } {
  let score = 0
  if (pass.length >= 12) score++
  if (pass.length >= 20) score++
  if (/[a-z]/.test(pass) && /[A-Z]/.test(pass)) score++
  if (/\d/.test(pass)) score++
  if (/[^A-Za-z0-9]/.test(pass)) score++
  const labels = ['Too weak', 'Weak', 'Fair', 'Good', 'Strong', 'Very strong']
  return { score, label: labels[Math.min(score, labels.length - 1)] }
}

/** Full-screen shell used for every onboarding/unlock step. */
function Shell({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div className="flex h-screen w-screen items-center justify-center overflow-auto bg-base p-6 text-primary">
      <div className="w-full max-w-lg border border-edge bg-panel p-8">{children}</div>
    </div>
  )
}

export default function Onboarding({ mode }: OnboardingProps): JSX.Element {
  const refreshGate = useAppStore((s) => s.refreshGate)

  if (mode === 'unlock') return <UnlockScreen onDone={refreshGate} />
  return <CreateWizard onDone={refreshGate} />
}

function UnlockScreen({ onDone }: { onDone: () => Promise<void> }): JSX.Element {
  const [passphrase, setPassphrase] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const res = await window.api.wallet.unlock({ passphrase })
      if (!res.success) {
        setError(res.error ?? 'Incorrect passphrase.')
        return
      }
      await onDone()
    } catch (err) {
      setError(humanizeError(err instanceof Error ? err.message : String(err)))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Shell>
      <div className="mb-6 flex items-center gap-2">
        <Lock size={20} className="text-accent" />
        <h1 className="text-xl font-bold">
          Press<span className="text-accent">Chain</span> — Unlock
        </h1>
      </div>
      <p className="mb-5 text-sm text-muted">Enter your passphrase to unlock your wallet.</p>
      {error && <ErrorCallout message={error} className="mb-4" />}
      <input
        type="password"
        autoFocus
        value={passphrase}
        onChange={(e) => setPassphrase(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && !busy && passphrase && submit()}
        placeholder="Passphrase"
        className="w-full border border-edge bg-input px-3 py-2 text-sm outline-none focus:border-accent"
      />
      <button
        onClick={submit}
        disabled={busy || !passphrase}
        className="mt-5 flex w-full items-center justify-center gap-2 bg-accent px-4 py-2.5 text-sm font-semibold text-base hover:bg-accent-dim disabled:opacity-50"
      >
        {busy && <Spinner size={14} />}
        Unlock
      </button>
    </Shell>
  )
}

function CreateWizard({ onDone }: { onDone: () => Promise<void> }): JSX.Element {
  const [step, setStep] = useState<1 | 2 | 3>(1)

  // Step 2 state
  const [passphrase, setPassphrase] = useState('')
  const [confirm, setConfirm] = useState('')
  const [mnemonic, setMnemonic] = useState<string | null>(null)
  const [wroteDown, setWroteDown] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  // Step 3 state
  const [email, setEmail] = useState('')
  const [ipfsBusy, setIpfsBusy] = useState(false)
  const [ipfsSent, setIpfsSent] = useState(false)
  const [ipfsDone, setIpfsDone] = useState(false)
  const [ipfsError, setIpfsError] = useState<string | null>(null)
  const [finishing, setFinishing] = useState(false)

  const strength = passphraseStrength(passphrase)
  const canCreate = passphrase.length >= 12 && passphrase === confirm && !creating

  const doCreate = async (): Promise<void> => {
    setCreating(true)
    setCreateError(null)
    try {
      const res = await window.api.wallet.create({ passphrase })
      if (!res.success || !res.mnemonic) {
        setCreateError(res.error ?? 'Failed to create wallet.')
        return
      }
      setMnemonic(res.mnemonic)
    } catch (err) {
      setCreateError(humanizeError(err instanceof Error ? err.message : String(err)))
    } finally {
      setCreating(false)
    }
  }

  const doIpfsSetup = async (): Promise<void> => {
    setIpfsBusy(true)
    setIpfsError(null)
    setIpfsSent(true)
    try {
      const res = await window.api.ipfs.setup({ email })
      if (!res.success) {
        setIpfsError(res.error ?? 'IPFS setup failed.')
        setIpfsSent(false)
        return
      }
      setIpfsDone(true)
    } catch (err) {
      setIpfsError(humanizeError(err instanceof Error ? err.message : String(err)))
      setIpfsSent(false)
    } finally {
      setIpfsBusy(false)
    }
  }

  const finish = async (): Promise<void> => {
    setFinishing(true)
    await onDone()
  }

  // ---- Step 1: Welcome ----
  if (step === 1) {
    return (
      <Shell>
        <div className="mb-5 flex items-center gap-2">
          <ShieldCheck size={22} className="text-accent" />
          <h1 className="text-2xl font-extrabold tracking-tight">
            Press<span className="text-accent">Chain</span>
          </h1>
        </div>
        <h2 className="mb-4 text-lg font-semibold">Censorship-Resistant Journalism Archive</h2>
        <div className="space-y-3 text-sm leading-relaxed text-muted">
          <p>
            PressChain lets you publish articles that cannot be quietly taken down. Content is
            encrypted on your device, stored on IPFS, and anchored on a public blockchain.
          </p>
          <p>
            All traffic is routed over the Tor network, so publishing and reading leave no direct
            trace back to you.
          </p>
          <p>
            You hold your own keys. No account, no company, and no server can read or remove your
            work on your behalf.
          </p>
        </div>
        <button
          onClick={() => setStep(2)}
          className="mt-7 w-full bg-accent px-4 py-2.5 text-sm font-semibold text-base hover:bg-accent-dim"
        >
          Set Up PressChain
        </button>
      </Shell>
    )
  }

  // ---- Step 2: Create wallet ----
  if (step === 2) {
    return (
      <Shell>
        <div className="mb-5 flex items-center gap-2">
          <KeyRound size={20} className="text-accent" />
          <h2 className="text-xl font-bold">Create your wallet</h2>
        </div>

        {!mnemonic ? (
          <>
            <p className="mb-5 text-sm text-muted">
              Your passphrase encrypts your wallet on this device. Choose at least 12 characters.
            </p>
            {createError && <ErrorCallout message={createError} className="mb-4" />}
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted">
              Passphrase
            </label>
            <input
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              className="mb-2 w-full border border-edge bg-input px-3 py-2 text-sm outline-none focus:border-accent"
            />
            {passphrase.length > 0 && (
              <div className="mb-4">
                <div className="flex h-1.5 gap-1">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <div
                      key={i}
                      className={`h-full flex-1 ${
                        i < strength.score
                          ? strength.score <= 2
                            ? 'bg-danger'
                            : strength.score <= 3
                              ? 'bg-warning'
                              : 'bg-accent'
                          : 'bg-edge'
                      }`}
                    />
                  ))}
                </div>
                <div className="mt-1 text-[11px] text-muted">Strength: {strength.label}</div>
              </div>
            )}
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted">
              Confirm passphrase
            </label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="w-full border border-edge bg-input px-3 py-2 text-sm outline-none focus:border-accent"
            />
            {confirm.length > 0 && confirm !== passphrase && (
              <div className="mt-1 text-[11px] text-danger">Passphrases do not match.</div>
            )}
            <button
              onClick={doCreate}
              disabled={!canCreate}
              className="mt-6 flex w-full items-center justify-center gap-2 bg-accent px-4 py-2.5 text-sm font-semibold text-base hover:bg-accent-dim disabled:opacity-50"
            >
              {creating && <Spinner size={14} />}
              Create wallet
            </button>
          </>
        ) : (
          <>
            <p className="mb-3 text-sm text-muted">
              This is your recovery phrase. It is the only way to restore your wallet.
            </p>
            <div className="mb-3 border border-edge bg-input p-4">
              <div className="grid grid-cols-3 gap-2 font-mono text-sm">
                {mnemonic.split(/\s+/).map((word, i) => (
                  <div key={i} className="flex gap-2">
                    <span className="w-5 select-none text-right text-muted">{i + 1}</span>
                    <span className="text-primary">{word}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="mb-4 flex items-start gap-2 border border-danger/60 bg-danger/10 px-4 py-3 text-sm text-danger">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <span>Write this down. You cannot recover your wallet without it.</span>
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-primary">
              <input
                type="checkbox"
                checked={wroteDown}
                onChange={(e) => setWroteDown(e.target.checked)}
                className="h-4 w-4 accent-[#4ade80]"
              />
              I have written down my recovery phrase.
            </label>
            <button
              onClick={() => setStep(3)}
              disabled={!wroteDown}
              className="mt-6 w-full bg-accent px-4 py-2.5 text-sm font-semibold text-base hover:bg-accent-dim disabled:opacity-50"
            >
              Continue
            </button>
          </>
        )}
      </Shell>
    )
  }

  // ---- Step 3: IPFS setup ----
  return (
    <Shell>
      <div className="mb-5 flex items-center gap-2">
        <Cloud size={20} className="text-accent" />
        <h2 className="text-xl font-bold">Set up storage</h2>
      </div>
      <p className="mb-5 text-sm leading-relaxed text-muted">
        PressChain stores encrypted articles on IPFS via Web3.Storage. Enter your email to link your
        account (free).
      </p>

      {ipfsError && <ErrorCallout message={ipfsError} className="mb-4" />}

      {!ipfsDone ? (
        <>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted">
            Email
          </label>
          <input
            type="email"
            value={email}
            disabled={ipfsBusy}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full border border-edge bg-input px-3 py-2 text-sm outline-none focus:border-accent disabled:opacity-60"
          />
          <button
            onClick={doIpfsSetup}
            disabled={ipfsBusy || !email.includes('@')}
            className="mt-5 flex w-full items-center justify-center gap-2 bg-accent px-4 py-2.5 text-sm font-semibold text-base hover:bg-accent-dim disabled:opacity-50"
          >
            {ipfsBusy && <Spinner size={14} />}
            Set up storage
          </button>
          {ipfsSent && ipfsBusy && (
            <p className="mt-4 text-sm text-warning">
              Check your email for a verification link, then it will complete automatically.
            </p>
          )}
          <button
            onClick={finish}
            className="mt-3 w-full text-center text-xs text-muted underline hover:text-primary"
          >
            Skip for now — set this up later in Settings
          </button>
        </>
      ) : (
        <>
          <div className="mb-5 flex items-start gap-2 border border-accent/50 bg-accent/10 px-4 py-3 text-sm text-accent">
            <ShieldCheck size={16} className="mt-0.5 shrink-0" />
            <span>Storage linked. You&apos;re ready to publish.</span>
          </div>
          <button
            onClick={finish}
            disabled={finishing}
            className="flex w-full items-center justify-center gap-2 bg-accent px-4 py-2.5 text-sm font-semibold text-base hover:bg-accent-dim disabled:opacity-50"
          >
            {finishing && <Spinner size={14} />}
            Continue
          </button>
        </>
      )}
    </Shell>
  )
}
