import { CheckCircle, AlertTriangle, XCircle, Info, X } from 'lucide-react'

const variantMap = {
  success: { icon: CheckCircle, base: 'bg-[var(--success-dim)] border-[var(--success)] text-[var(--success)]' },
  error:   { icon: XCircle,     base: 'bg-[var(--error-dim)] border-[var(--error)] text-[var(--error)]' },
  warning: { icon: AlertTriangle, base: 'bg-[var(--warning-dim)] border-[var(--warning)] text-[var(--warning)]' },
  info:    { icon: Info,         base: 'bg-[var(--accent-dim)] border-[var(--accent)] text-[var(--accent)]' },
}

export function Alert({ variant = 'info', message, onDismiss }) {
  const { icon: Icon, base } = variantMap[variant] || variantMap.info
  return (
    <div className={`flex items-start gap-3 p-3.5 rounded-[var(--radius-md)] border text-sm ${base}`}>
      <Icon size={16} className="shrink-0 mt-0.5" />
      <p className="flex-1 leading-relaxed">{message}</p>
      {onDismiss && (
        <button onClick={onDismiss} className="shrink-0 opacity-60 hover:opacity-100 transition-opacity">
          <X size={14} />
        </button>
      )}
    </div>
  )
}
