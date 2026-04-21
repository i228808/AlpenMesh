const variants = {
  default: 'bg-[var(--surface-raised)] text-[var(--text-muted)] border-[var(--border)]',
  accent:  'bg-[var(--accent-dim)] text-[var(--accent)] border-[var(--accent-border)]',
  success: 'bg-[var(--success-dim)] text-[var(--success)] border-[var(--success-dim)]',
  error:   'bg-[var(--error-dim)] text-[var(--error)] border-[var(--error-dim)]',
  warning: 'bg-[var(--warning-dim)] text-[var(--warning)] border-[var(--warning-dim)]',
  phase2:  'bg-[var(--warning-dim)] text-[var(--warning)] border-[var(--warning-dim)]',
  live:    'bg-[var(--success-dim)] text-[var(--success)] border-[var(--success-dim)]',
}

export function Badge({ children, variant = 'default', className = '' }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${variants[variant]} ${className}`}
    >
      {children}
    </span>
  )
}
