import { motion } from 'framer-motion'
import { TrendingUp } from 'lucide-react'

export function StatWidget({ label, value, sub, icon: Icon, accent = false, loading = false, delay = 0 }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay }}
      className={`
        bg-[var(--surface)] border rounded-[var(--radius-lg)] p-5 flex flex-col gap-3
        ${accent
          ? 'border-[var(--accent-border)] bg-[var(--accent-dim)]'
          : 'border-[var(--border)] hover:border-[var(--border)] transition-colors'}
      `}
    >
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">{label}</p>
        {Icon && (
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${accent ? 'bg-[var(--accent)] text-[#090B0F]' : 'bg-[var(--surface-raised)]'}`}>
            <Icon size={14} className={accent ? 'text-[#090B0F]' : 'text-[var(--text-muted)]'} />
          </div>
        )}
      </div>
      {loading ? (
        <div className="h-8 w-24 rounded-md bg-[var(--surface-raised)] animate-pulse" />
      ) : (
        <p className={`text-2xl font-display font-bold ${accent ? 'text-[var(--accent)]' : 'text-[var(--text-primary)]'}`}>
          {value}
        </p>
      )}
      {sub && <p className="text-xs text-[var(--text-faint)]">{sub}</p>}
    </motion.div>
  )
}
