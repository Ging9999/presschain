import type { StatusCode } from '../types'
import { STATUS_LABELS } from '../lib/format'

const STYLES: Record<StatusCode, string> = {
  0: 'border-accent/50 text-accent',
  1: 'border-warning/50 text-warning',
  2: 'border-edge text-muted'
}

export default function StatusBadge({ status }: { status: StatusCode }): JSX.Element {
  return (
    <span
      className={`inline-block border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${STYLES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  )
}
