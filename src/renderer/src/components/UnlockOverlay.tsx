import { useState } from 'react'
import { Lock } from 'lucide-react'
import { useAppStore } from '../store'
import ErrorCallout, { humanizeError } from './ErrorCallout'
import Spinner from './Spinner'

/**
 * Modal overlay shown when an action fails because the wallet is locked
 * mid-session. On success it refreshes the gate and dismisses.
 */
export default function UnlockOverlay(): JSX.Element | null {
  const showUnlock = useAppStore((s) => s.showUnlock)
  const setShowUnlock = useAppStore((s) => s.setShowUnlock)
  const refreshGate = useAppStore((s) => s.refreshGate)

  const [passphrase, setPassphrase] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!showUnlock) return null

  const submit = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const res = await window.api.wallet.unlock({ passphrase })
      if (!res.success) {
        setError(res.error ?? 'Incorrect passphrase.')
        return
      }
      setPassphrase('')
      setShowUnlock(false)
      await refreshGate()
    } catch (err) {
      setError(humanizeError(err instanceof Error ? err.message : String(err)))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-[400px] max-w-[90vw] border border-edge bg-panel p-6">
        <div className="mb-4 flex items-center gap-2">
          <Lock size={18} className="text-accent" />
          <h2 className="text-lg font-semibold">Wallet locked</h2>
        </div>
        <p className="mb-4 text-sm text-muted">Enter your passphrase to continue.</p>

        {error && <ErrorCallout message={error} className="mb-3" />}

        <input
          type="password"
          autoFocus
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !busy && passphrase && submit()}
          placeholder="Passphrase"
          className="w-full border border-edge bg-input px-3 py-2 text-sm text-primary outline-none focus:border-accent"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={() => setShowUnlock(false)}
            className="border border-edge px-4 py-2 text-xs font-semibold text-muted hover:text-primary"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={busy || !passphrase}
            className="flex items-center gap-2 bg-accent px-4 py-2 text-xs font-semibold text-base hover:bg-accent-dim disabled:opacity-50"
          >
            {busy && <Spinner size={14} />}
            Unlock
          </button>
        </div>
      </div>
    </div>
  )
}
