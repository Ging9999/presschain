import { useCallback, useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Flag, Gavel, KeyRound } from 'lucide-react'
import { useAppStore } from '../store'
import { truncateAddress, relativeTime } from '../lib/format'
import ErrorCallout, { humanizeError } from '../components/ErrorCallout'
import Spinner from '../components/Spinner'

export default function Read(): JSX.Element {
  const { articleId } = useParams<{ articleId: string }>()
  const [searchParams] = useSearchParams()
  const id = Number(articleId)

  const meta = useAppStore((s) => s.articles.find((a) => a.id === id))
  const setShowUnlock = useAppStore((s) => s.setShowUnlock)

  const [loading, setLoading] = useState(true)
  const [body, setBody] = useState<string | null>(null)
  const [keyMissing, setKeyMissing] = useState<{ reason?: string; message?: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [gov, setGov] = useState<{
    flagStakeEth: string
    voteStakeEth: string
    flagThreshold: number
    votePeriodSecs: number
  } | null>(null)

  useEffect(() => {
    let mounted = true
    window.api.gov
      .getParams()
      .then((r) => {
        if (mounted && r.success && r.params) setGov(r.params)
      })
      .catch(() => undefined)
    return () => {
      mounted = false
    }
  }, [])

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    setKeyMissing(null)
    setBody(null)
    try {
      let cid = searchParams.get('cid') ?? undefined
      if (!cid) {
        const res = await window.api.article.getCID({ articleId: id })
        cid = res.cid
      }
      if (!cid) {
        setError('Could not resolve this article’s storage location.')
        return
      }
      const res = await window.api.article.read({ articleId: id, cid })
      if (res.error === 'KEY_NOT_FOUND') {
        setKeyMissing({ reason: res.reason, message: res.message })
        return
      }
      if (res.error) {
        if ((res.message ?? '').toLowerCase().includes('locked')) setShowUnlock(true)
        setError(humanizeError(res.message ?? res.error))
        return
      }
      setBody(res.body ?? '')
    } catch (err) {
      setError(humanizeError(err instanceof Error ? err.message : String(err)))
    } finally {
      setLoading(false)
    }
  }, [id, searchParams, setShowUnlock])

  useEffect(() => {
    load()
  }, [load])

  const flagStakeLabel = gov ? `${gov.flagStakeEth} ETH` : 'a small refundable stake'
  const voteStakeLabel = gov ? `${gov.voteStakeEth} ETH` : 'a small refundable stake'
  const voteDays = gov ? Math.max(1, Math.round(gov.votePeriodSecs / 86400)) : 3
  const flagThreshold = gov?.flagThreshold ?? 10

  const flag = async (): Promise<void> => {
    const ok = window.confirm(
      `Flag this article?\n\n` +
        `This stakes ${flagStakeLabel} (refundable) and is recorded on-chain.\n\n` +
        `Refund/forfeit rule: your stake is RETURNED if the community later removes this ` +
        `article (your flag was aligned with the outcome), and FORFEITED if a removal vote ` +
        `keeps it. You can also withdraw your flag after the cooldown to reclaim the stake.`
    )
    if (!ok) return
    try {
      const res = await window.api.article.flag({ articleId: id })
      if (!res.success) {
        setError(humanizeError(res.error))
        return
      }
      setNotice(`Flagged (staked ${flagStakeLabel}). At ${flagThreshold} flags, the article is hidden.`)
    } catch (err) {
      setError(humanizeError(err instanceof Error ? err.message : String(err)))
    }
  }

  const propose = async (): Promise<void> => {
    const ok = window.confirm(
      `Propose removal of this article?\n\n` +
        `This casts a FOR vote, stakes ${voteStakeLabel} (refundable), and starts a ` +
        `${voteDays}-day community vote.\n\n` +
        `Refund/forfeit rule: after the vote, the winning side reclaims their stake PLUS a ` +
        `share of the losing side's forfeited stake; the losing side forfeits their stake. ` +
        `Removal is not instant and no single wallet can decide it.`
    )
    if (!ok) return
    try {
      const res = await window.api.article.proposeRemoval({ articleId: id })
      if (!res.success) {
        setError(humanizeError(res.error))
        return
      }
      setNotice(`Removal proposed (staked ${voteStakeLabel}). A ${voteDays}-day community vote has started.`)
    } catch (err) {
      setError(humanizeError(err instanceof Error ? err.message : String(err)))
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-8 py-10">
      <Link to="/" className="inline-flex items-center gap-1 text-xs text-muted hover:text-primary">
        <ArrowLeft size={14} /> Back to Browse
      </Link>

      <header className="mb-6 mt-4 border-b border-edge pb-4">
        <h1 className="text-2xl font-bold">{meta?.title ?? `Article #${id}`}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
          {meta && <span className="font-mono">{truncateAddress(meta.uploader)}</span>}
          {meta && <span>{relativeTime(meta.timestamp)}</span>}
          {meta && meta.flagCount > 0 && (
            <span className="text-warning">{meta.flagCount} flags</span>
          )}
        </div>
      </header>

      {notice && (
        <div className="mb-6 border border-accent/50 bg-accent/10 px-4 py-3 text-sm text-accent">
          {notice}
        </div>
      )}
      {error && <ErrorCallout message={error} className="mb-6" />}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted">
          <Spinner size={16} /> Fetching &amp; decrypting over Tor…
        </div>
      ) : keyMissing ? (
        <div className="border border-edge bg-panel p-6">
          <div className="mb-2 flex items-center gap-2 text-muted">
            <KeyRound size={18} />
            <span className="font-semibold text-primary">
              {keyMissing.reason === 'not_a_recipient'
                ? 'Encrypted — you’re not a recipient'
                : 'Encrypted — you don’t hold the key'}
            </span>
          </div>
          <p className="text-sm leading-relaxed text-muted">
            {keyMissing.message ??
              'You do not hold the decryption key for this article and cannot read the content.'}
          </p>
        </div>
      ) : (
        body !== null && (
          <article
            className="font-article text-primary"
            style={{ fontSize: 18, lineHeight: 1.8, maxWidth: 680, margin: '0 auto' }}
          >
            {body.split('\n').map((para, i) => (
              <p key={i} className="mb-5 whitespace-pre-wrap">
                {para}
              </p>
            ))}
          </article>
        )
      )}

      {!loading && (
        <div className="mt-10 flex flex-wrap gap-2 border-t border-edge pt-6">
          <button
            onClick={flag}
            className="flex items-center gap-2 border border-edge px-4 py-2 text-xs font-semibold text-muted hover:text-danger"
          >
            <Flag size={14} /> Flag as inappropriate
          </button>
          {meta?.status === 1 && (
            <button
              onClick={propose}
              className="flex items-center gap-2 border border-edge px-4 py-2 text-xs font-semibold text-muted hover:text-danger"
            >
              <Gavel size={14} /> Propose removal
            </button>
          )}
        </div>
      )}
    </div>
  )
}
