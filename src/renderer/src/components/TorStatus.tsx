import { useEffect } from 'react'
import { useAppStore } from '../store'

/**
 * Sidebar Tor indicator. Polls status every 2 seconds and mirrors it into the
 * store. Red dot while connecting / on error, green once the circuit is up. The
 * progress bar is driven by Tor's real bootstrap-phase percentage.
 */
export default function TorStatus(): JSX.Element {
  const torStatus = useAppStore((s) => s.torStatus)
  const torProgress = useAppStore((s) => s.torProgress)
  const setTorStatus = useAppStore((s) => s.setTorStatus)

  useEffect(() => {
    let mounted = true
    const poll = async (): Promise<void> => {
      try {
        const status = await window.api.tor.getStatus()
        if (mounted) setTorStatus(status.state, status.progress)
      } catch {
        if (mounted) setTorStatus('error', 0)
      }
    }
    poll()
    const id = setInterval(poll, 2000)
    return () => {
      mounted = false
      clearInterval(id)
    }
  }, [setTorStatus])

  const isReady = torStatus === 'ready'
  const isError = torStatus === 'error'
  const label = isReady ? 'Tor Connected' : isError ? 'Tor Error' : 'Connecting to the Tor network…'
  const dotColor = isReady ? 'bg-accent' : 'bg-danger'

  return (
    <div className="select-none">
      <div className="flex items-center gap-2">
        <span
          className={`inline-block h-2.5 w-2.5 rounded-full ${dotColor} ${
            isReady ? '' : 'animate-pulse'
          }`}
        />
        <span className={`text-xs font-medium ${isReady ? 'text-accent' : 'text-primary'}`}>
          {label}
        </span>
      </div>

      {torStatus === 'starting' && (
        <div className="mt-2">
          <div className="h-1 w-full bg-edge">
            <div
              className="h-full bg-accent transition-all duration-300"
              style={{ width: `${Math.max(0, Math.min(100, torProgress))}%` }}
            />
          </div>
          <div className="mt-1 text-[10px] tabular-nums text-muted">{torProgress}%</div>
        </div>
      )}
    </div>
  )
}
