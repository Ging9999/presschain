import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { useAppStore } from '../store'
import ErrorCallout, { humanizeError } from '../components/ErrorCallout'
import Spinner from '../components/Spinner'

const TITLE_MAX = 200
const SUMMARY_MAX = 500

const PHASES = ['Encrypting…', 'Uploading to IPFS…', 'Registering on blockchain…']

export default function Upload(): JSX.Element {
  const setShowUnlock = useAppStore((s) => s.setShowUnlock)

  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [body, setBody] = useState('')
  const [recipientsText, setRecipientsText] = useState('')
  const [makePublic, setMakePublic] = useState(false)

  const [submitting, setSubmitting] = useState(false)
  const [phase, setPhase] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ articleId: number; cid?: string } | null>(null)
  const phaseTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    return () => {
      if (phaseTimer.current) clearInterval(phaseTimer.current)
    }
  }, [])

  const canSubmit =
    title.trim().length > 0 &&
    title.length <= TITLE_MAX &&
    summary.length <= SUMMARY_MAX &&
    body.trim().length > 0 &&
    !submitting

  const submit = async (): Promise<void> => {
    setSubmitting(true)
    setError(null)
    setResult(null)
    setPhase(0)
    // Advance the phase labels while the single upload call runs.
    phaseTimer.current = setInterval(() => {
      setPhase((p) => Math.min(p + 1, PHASES.length - 1))
    }, 1200)

    try {
      const recipients = recipientsText
        .split(/[\s,]+/)
        .map((r) => r.trim())
        .filter(Boolean)
      const res = await window.api.article.upload({ title, summary, body, recipients, makePublic })
      if (!res.success) {
        if ((res.error ?? '').toLowerCase().includes('locked')) setShowUnlock(true)
        setError(humanizeError(res.error))
        return
      }
      setResult({ articleId: res.articleId as number, cid: res.cid })
      setTitle('')
      setSummary('')
      setBody('')
      setRecipientsText('')
      setMakePublic(false)
    } catch (err) {
      setError(humanizeError(err instanceof Error ? err.message : String(err)))
    } finally {
      if (phaseTimer.current) clearInterval(phaseTimer.current)
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-8 py-10">
      <header className="mb-6">
        <h2 className="text-2xl font-bold">Upload</h2>
        <p className="mt-1 text-sm text-muted">
          Encrypt an article locally and publish it to the chain over Tor.
        </p>
      </header>

      <div className="mb-6 flex items-start gap-2 border border-warning/50 bg-warning/10 px-4 py-3 text-sm text-warning">
        <AlertTriangle size={16} className="mt-0.5 shrink-0" />
        <span>Your wallet address will be permanently recorded on-chain as the uploader.</span>
      </div>

      {error && <ErrorCallout message={error} className="mb-6" />}

      {result ? (
        <div className="border border-accent/50 bg-accent/10 p-6">
          <div className="mb-2 flex items-center gap-2 text-accent">
            <CheckCircle2 size={18} />
            <span className="font-semibold">Published!</span>
          </div>
          <p className="text-sm text-primary">
            Article ID <span className="font-mono text-accent">#{result.articleId}</span> is now on
            Base Sepolia.
          </p>
          <div className="mt-4 flex gap-2">
            <Link
              to={`/read/${result.articleId}${result.cid ? `?cid=${encodeURIComponent(result.cid)}` : ''}`}
              className="bg-accent px-4 py-2 text-xs font-semibold text-base hover:bg-accent-dim"
            >
              View article
            </Link>
            <button
              onClick={() => setResult(null)}
              className="border border-edge px-4 py-2 text-xs font-semibold text-muted hover:text-primary"
            >
              Publish another
            </button>
          </div>
        </div>
      ) : (
        <div className={`space-y-5 ${submitting ? 'pointer-events-none opacity-60' : ''}`}>
          <Field label="Title" counter={`${title.length}/${TITLE_MAX}`}>
            <input
              value={title}
              maxLength={TITLE_MAX}
              disabled={submitting}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Headline"
              className="w-full border border-edge bg-input px-3 py-2 text-sm text-primary outline-none focus:border-accent"
            />
          </Field>

          <Field
            label="Short description (public, not encrypted)"
            counter={`${summary.length}/${SUMMARY_MAX}`}
          >
            <textarea
              value={summary}
              maxLength={SUMMARY_MAX}
              rows={2}
              disabled={submitting}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="One-sentence summary shown in the browse view"
              className="w-full resize-none border border-edge bg-input px-3 py-2 text-sm text-primary outline-none focus:border-accent"
            />
          </Field>

          <Field label="Article body — this will be encrypted. Only you and the recipients below can read it.">
            <textarea
              value={body}
              rows={12}
              disabled={submitting}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write the story…"
              className="article-body w-full resize-none border border-edge bg-input px-3 py-2 text-sm text-primary outline-none focus:border-accent font-article"
            />
          </Field>

          <Field label="Share with (optional) — recipient public keys, one per line">
            <textarea
              value={recipientsText}
              rows={3}
              disabled={submitting || makePublic}
              onChange={(e) => setRecipientsText(e.target.value)}
              placeholder="Paste each reader's encryption public key (hex). They can copy theirs from Settings."
              className="w-full resize-none border border-edge bg-input px-3 py-2 font-mono text-xs text-primary outline-none focus:border-accent disabled:opacity-50"
            />
            <p className="mt-1 text-[11px] text-muted">
              The article key is wrapped to each recipient off-chain. No key is ever stored on the
              blockchain.
            </p>
          </Field>

          <label className="flex cursor-pointer items-start gap-2 border border-warning/40 bg-warning/5 px-4 py-3">
            <input
              type="checkbox"
              checked={makePublic}
              disabled={submitting}
              onChange={(e) => setMakePublic(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[#fbbf24]"
            />
            <span className="text-xs text-warning">
              <span className="font-semibold">Publish publicly (world-readable).</span> Stores the
              decryption key in the clear so anyone can read this article. This is{' '}
              <span className="font-semibold">irreversible</span> — the content is on IPFS forever
              and cannot be un-published.
            </span>
          </label>

          <button
            onClick={submit}
            disabled={!canSubmit}
            className="flex items-center gap-2 bg-accent px-5 py-2.5 text-sm font-semibold text-base hover:bg-accent-dim disabled:opacity-50"
          >
            {submitting ? (
              <>
                <Spinner size={14} />
                {PHASES[phase]}
              </>
            ) : (
              'Encrypt & Publish'
            )}
          </button>
        </div>
      )}
    </div>
  )
}

function Field({
  label,
  counter,
  children
}: {
  label: string
  counter?: string
  children: React.ReactNode
}): JSX.Element {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <label className="block text-xs font-semibold uppercase tracking-wider text-muted">
          {label}
        </label>
        {counter && <span className="text-[11px] tabular-nums text-muted">{counter}</span>}
      </div>
      {children}
    </div>
  )
}
