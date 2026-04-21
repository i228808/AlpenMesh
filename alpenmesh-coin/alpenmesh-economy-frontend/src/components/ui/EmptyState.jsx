import { motion } from 'framer-motion'

export function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="flex flex-col items-center justify-center text-center py-16 px-8 gap-4"
    >
      {Icon && (
        <div className="w-14 h-14 rounded-2xl bg-[var(--surface-raised)] border border-[var(--border)] flex items-center justify-center">
          <Icon size={24} className="text-[var(--text-faint)]" />
        </div>
      )}
      <div className="space-y-1 max-w-xs">
        <h3 className="font-display font-semibold text-[var(--text-primary)]">{title}</h3>
        {description && <p className="text-sm text-[var(--text-muted)] leading-relaxed">{description}</p>}
      </div>
      {action && <div className="mt-2">{action}</div>}
    </motion.div>
  )
}
