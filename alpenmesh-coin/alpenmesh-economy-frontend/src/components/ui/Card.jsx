export function Card({ children, className = '', hover = false, padding = 'p-6', ...rest }) {
  return (
    <div
      className={`
        bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)]
        ${padding}
        ${hover ? 'transition-all duration-200 hover:border-[var(--accent-border)] hover:shadow-[var(--shadow-md)]' : ''}
        ${className}
      `}
      {...rest}
    >
      {children}
    </div>
  )
}

export function CardHeader({ title, subtitle, action, className = '' }) {
  return (
    <div className={`flex items-start justify-between gap-4 mb-5 ${className}`}>
      <div>
        <h3 className="text-base font-semibold font-display text-[var(--text-primary)]">{title}</h3>
        {subtitle && <p className="text-sm text-[var(--text-muted)] mt-0.5">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}
