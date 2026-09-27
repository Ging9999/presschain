interface SpinnerProps {
  size?: number
  className?: string
}

/** Minimal terminal-style spinner (green ring on a dark track). */
export default function Spinner({ size = 20, className = '' }: SpinnerProps): JSX.Element {
  return (
    <span
      className={`inline-block animate-spin rounded-full border-edge border-t-accent ${className}`}
      style={{ width: size, height: size, borderWidth: Math.max(2, Math.round(size / 10)) }}
      role="status"
      aria-label="Loading"
    />
  )
}
