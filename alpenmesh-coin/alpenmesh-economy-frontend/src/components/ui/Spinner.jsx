import { Loader2 } from 'lucide-react'

export function Spinner({ size = 20, className = '' }) {
  return (
    <Loader2
      size={size}
      className={`animate-spin text-[var(--accent)] ${className}`}
    />
  )
}

export function PageSpinner() {
  return (
    <div className="flex items-center justify-center min-h-[300px]">
      <Spinner size={28} />
    </div>
  )
}
