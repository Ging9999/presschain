import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { RefreshCw, Flag } from 'lucide-react'
import { useAppStore } from '../store'
import type { ArticleMeta } from '../types'
import { truncateAddress, relativeTime } from '../lib/format'
import StatusBadge from '../components/StatusBadge'
import ErrorCallout, { humanizeError } from '../components/ErrorCallout'

const PAGE_SIZE = 20

export default function Browse(): JSX.Element {
  const articles = useAppStore((s) => s.articles)
  const setArticles = useAppStore((s) => s.setArticles)
  const setShowUnlock = useAppStore((s) => s.setShowUnlock)
  const navigate = useNavigate()

  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [initialized, setInitialized] = useState(false)

  const load = useCallback(
    async (offset: number): Promise<void> => {
      const isFirst = offset === 0
      isFirst ? setLoading(true) : setLoadingMore(true)
      setError(null)
      try {
        const batch = await window.api.article.list({ offset, limit: PAGE_SIZE })
        setHasMore(batch.length === PAGE_SIZE)
        if (isFirst) {
          setArticles(batch)
        } else {
          setArticles([...useAppStore.getState().articles, ...batch])
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (msg.toLowerCase().includes('locked')) setShowUnlock(true)
        setError(humanizeError(msg))
      } finally {
        setLoading(false)
        setLoadingMore(false)
        setInitialized(true)
      }
    },
    [setArticles, setShowUnlock]
  )

  useEffect(() => {
    load(0)
  }, [load])

  const openArticle = async (article: ArticleMeta): Promise<void> => {
    if (article.status === 2) return
    let cid = article.cid
    if (!cid) {
      try {
        const res = await window.api.article.getCID({ articleId: article.id })
        cid = res.cid
      } catch {
        /* Read will surface the failure */
      }
    }
    navigate(`/read/${article.id}${cid ? `?cid=${encodeURIComponent(cid)}` : ''}`)
  }

  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Browse</h2>
          <p className="mt-1 text-sm text-muted">
            Articles published to the chain. Fetched over Tor and decrypted locally.
          </p>
        </div>
        <button
          onClick={() => load(0)}
          disabled={loading}
          className="flex items-center gap-2 border border-edge px-3 py-2 text-xs font-semibold text-muted hover:text-primary disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </header>

      {error && <ErrorCallout message={error} className="mb-6" />}

      {loading && !initialized ? (
        <SkeletonList />
      ) : articles.length === 0 && !error ? (
        <div className="border border-edge bg-panel px-6 py-12 text-center">
          <p className="text-sm text-primary">No articles published yet. Be the first.</p>
        </div>
      ) : (
        <>
          <ul className="space-y-3">
            {articles.map((article) => (
              <li key={article.id}>
                <ArticleCard article={article} onOpen={() => openArticle(article)} />
              </li>
            ))}
          </ul>

          {hasMore && (
            <div className="mt-6 flex justify-center">
              <button
                onClick={() => load(articles.length)}
                disabled={loadingMore}
                className="border border-edge px-5 py-2 text-xs font-semibold text-muted hover:text-primary disabled:opacity-50"
              >
                {loadingMore ? 'Loading…' : 'Load more'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function ArticleCard({
  article,
  onOpen
}: {
  article: ArticleMeta
  onOpen: () => void
}): JSX.Element {
  const removed = article.status === 2

  if (removed) {
    return (
      <div className="border border-edge bg-panel px-5 py-6 text-center">
        <p className="text-sm italic text-muted">Content removed by community vote</p>
      </div>
    )
  }

  return (
    <button
      onClick={onOpen}
      className="block w-full border border-edge bg-panel px-5 py-4 text-left transition-colors hover:border-muted"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-lg font-semibold text-primary">{article.title}</h3>
        <StatusBadge status={article.status} />
      </div>
      <p className="mt-1 line-clamp-2 text-sm text-muted">{article.summary}</p>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        <span className="font-mono">{truncateAddress(article.uploader)}</span>
        <span>{relativeTime(article.timestamp)}</span>
        {article.flagCount > 0 && (
          <span className="flex items-center gap-1 text-warning">
            <Flag size={12} />
            {article.flagCount} {article.flagCount === 1 ? 'flag' : 'flags'}
          </span>
        )}
      </div>
    </button>
  )
}

function SkeletonList(): JSX.Element {
  return (
    <ul className="space-y-3">
      {[0, 1, 2, 3].map((i) => (
        <li key={i} className="animate-pulse border border-edge bg-panel px-5 py-4">
          <div className="h-5 w-2/3 bg-edge" />
          <div className="mt-3 h-3 w-full bg-edge" />
          <div className="mt-2 h-3 w-1/2 bg-edge" />
          <div className="mt-4 h-3 w-40 bg-edge" />
        </li>
      ))}
    </ul>
  )
}
