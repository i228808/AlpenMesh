import { motion } from 'framer-motion'
import { Clock, Zap } from 'lucide-react'
import { Badge } from './Badge'

export function Phase2Banner({ title, description, className = '' }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`
        border-2 border-dashed border-[var(--warning-dim)] rounded-[var(--radius-lg)]
        bg-[var(--warning-dim)] p-6 text-center flex flex-col items-center gap-3
        ${className}
      `}
    >
      <div className="w-12 h-12 rounded-xl bg-[var(--warning-dim)] border border-[var(--warning-dim)] flex items-center justify-center">
        <Clock size={20} className="text-[var(--warning)]" />
      </div>
      <div>
        <div className="flex items-center justify-center gap-2 mb-1.5">
          <Badge variant="phase2">
            <Zap size={10} />
            Coming in Next Phase
          </Badge>
        </div>
        <h3 className="font-display font-semibold text-[var(--text-primary)] text-lg mb-1">{title}</h3>
        {description && (
          <p className="text-sm text-[var(--text-muted)] max-w-md leading-relaxed">{description}</p>
        )}
      </div>
    </motion.div>
  )
}

export function Phase2Section({ title, description, children, className = '' }) {
  return (
    <div className={`relative ${className}`}>
      <div className="absolute inset-0 rounded-[var(--radius-lg)] border-2 border-dashed border-[var(--border)] pointer-events-none z-10" />
      <div className="opacity-50 pointer-events-none select-none">
        {children}
      </div>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 z-20">
        <Badge variant="phase2">
          <Clock size={10} />
          Coming in Next Phase
        </Badge>
        {title && <p className="text-sm font-medium text-[var(--text-muted)]">{title}</p>}
      </div>
    </div>
  )
}
