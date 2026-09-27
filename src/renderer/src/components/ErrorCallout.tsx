import { AlertTriangle } from 'lucide-react'

interface ErrorCalloutProps {
  message: string
  className?: string
}

/**
 * Normalizes common failures into human messages. Network/RPC failures are
 * surfaced as a Tor-connection hint per the spec.
 */
export function humanizeError(raw?: string): string {
  if (!raw) return 'Something went wrong.'
  const m = raw.toLowerCase()
  if (
    m.includes('network') ||
    m.includes('timeout') ||
    m.includes('fetch failed') ||
    m.includes('econn') ||
    m.includes('could not detect network') ||
    m.includes('failed to fetch')
  ) {
    return 'Network request failed. Check your Tor connection.'
  }
  if (m.includes('wallet locked') || m.includes('locked')) {
    return 'Your wallet is locked. Unlock it to continue.'
  }
  return raw
}

export default function ErrorCallout({ message, className = '' }: ErrorCalloutProps): JSX.Element {
  return (
    <div
      role="alert"
      className={`flex items-start gap-2 border border-danger/60 bg-danger/10 px-4 py-3 text-sm text-danger ${className}`}
    >
      <AlertTriangle size={16} className="mt-0.5 shrink-0" />
      <span>{message}</span>
    </div>
  )
}
