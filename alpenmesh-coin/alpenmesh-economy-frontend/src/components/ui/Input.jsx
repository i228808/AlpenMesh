export function Input({
  label,
  error,
  hint,
  className = '',
  containerClass = '',
  icon: Icon,
  ...rest
}) {
  return (
    <div className={`flex flex-col gap-1.5 ${containerClass}`}>
      {label && (
        <label className="text-sm font-medium text-[var(--text-primary)]">{label}</label>
      )}
      <div className="relative">
        {Icon && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)] pointer-events-none">
            <Icon size={16} />
          </span>
        )}
        <input
          className={`
            w-full bg-[var(--surface-raised)] border border-[var(--border)]
            text-[var(--text-primary)] placeholder:text-[var(--text-faint)]
            rounded-[var(--radius-md)] px-3 py-2.5 text-sm
            transition-colors duration-150
            focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]
            disabled:opacity-50 disabled:cursor-not-allowed
            ${Icon ? 'pl-9' : ''}
            ${error ? 'border-[var(--error)] focus:border-[var(--error)] focus:ring-[var(--error)]' : ''}
            ${className}
          `}
          {...rest}
        />
      </div>
      {error && <p className="text-xs text-[var(--error)]">{error}</p>}
      {hint && !error && <p className="text-xs text-[var(--text-muted)]">{hint}</p>}
    </div>
  )
}

export function Textarea({ label, error, hint, className = '', containerClass = '', ...rest }) {
  return (
    <div className={`flex flex-col gap-1.5 ${containerClass}`}>
      {label && (
        <label className="text-sm font-medium text-[var(--text-primary)]">{label}</label>
      )}
      <textarea
        className={`
          w-full bg-[var(--surface-raised)] border border-[var(--border)]
          text-[var(--text-primary)] placeholder:text-[var(--text-faint)]
          rounded-[var(--radius-md)] px-3 py-2.5 text-sm resize-none
          transition-colors duration-150
          focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]
          ${error ? 'border-[var(--error)]' : ''}
          ${className}
        `}
        {...rest}
      />
      {error && <p className="text-xs text-[var(--error)]">{error}</p>}
      {hint && !error && <p className="text-xs text-[var(--text-muted)]">{hint}</p>}
    </div>
  )
}

export function Select({ label, error, children, className = '', containerClass = '', ...rest }) {
  return (
    <div className={`flex flex-col gap-1.5 ${containerClass}`}>
      {label && (
        <label className="text-sm font-medium text-[var(--text-primary)]">{label}</label>
      )}
      <select
        className={`
          w-full bg-[var(--surface-raised)] border border-[var(--border)]
          text-[var(--text-primary)]
          rounded-[var(--radius-md)] px-3 py-2.5 text-sm
          focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]
          ${className}
        `}
        {...rest}
      >
        {children}
      </select>
      {error && <p className="text-xs text-[var(--error)]">{error}</p>}
    </div>
  )
}
