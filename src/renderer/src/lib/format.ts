/** Truncate an Ethereum address to 0x1234...abcd */
export function truncateAddress(address?: string | null): string {
  if (!address) return '—'
  if (address.length <= 12) return address
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

/** Human-relative time from a unix timestamp (seconds). */
export function relativeTime(unixSeconds?: number): string {
  if (!unixSeconds) return ''
  const then = unixSeconds * 1000
  const diff = Date.now() - then
  const abs = Math.abs(diff)
  const units: [number, Intl.RelativeTimeFormatUnit][] = [
    [1000 * 60 * 60 * 24 * 365, 'year'],
    [1000 * 60 * 60 * 24 * 30, 'month'],
    [1000 * 60 * 60 * 24 * 7, 'week'],
    [1000 * 60 * 60 * 24, 'day'],
    [1000 * 60 * 60, 'hour'],
    [1000 * 60, 'minute'],
    [1000, 'second']
  ]
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
  for (const [ms, unit] of units) {
    if (abs >= ms || unit === 'second') {
      const value = Math.round(diff / ms)
      return rtf.format(-value, unit)
    }
  }
  return ''
}

export type StatusCode = 0 | 1 | 2

export const STATUS_LABELS: Record<StatusCode, string> = {
  0: 'Active',
  1: 'Flagged',
  2: 'Removed'
}
