import { motion } from 'framer-motion'
import { Store, Cpu, Zap, Shield, Clock } from 'lucide-react'
import { Phase2Banner } from '@/components/ui/Phase2Banner'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'

const tiers = [
  { name: 'Standard GPU', vram: '8 GB VRAM', compute: 'GPU Tier 1', price: '~0.08 ALPEN/hr', icon: Cpu },
  { name: 'High Memory GPU', vram: '24 GB VRAM', compute: 'GPU Tier 2', price: '~0.24 ALPEN/hr', icon: Zap },
  { name: 'Multi-GPU Node', vram: '80+ GB VRAM', compute: 'GPU Tier 3', price: '~0.80 ALPEN/hr', icon: Shield },
]

export default function AppMarketplace() {
  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <h1 className="font-display font-bold text-2xl text-[var(--text-primary)]">Compute Marketplace</h1>
          <Badge variant="phase2">Phase 2</Badge>
        </div>
        <p className="text-sm text-[var(--text-muted)]">Browse and rent distributed GPU compute from verified AlpenMesh workers.</p>
      </div>

      <Phase2Banner
        title="Marketplace Execution Layer Coming in Next Phase"
        description="Phase 2 will introduce a full compute marketplace where you can discover, evaluate, and rent GPU compute from verified network workers."
      />

      <div>
        <h2 className="font-display font-semibold text-[var(--text-primary)] mb-4">Planned Compute Tiers</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {tiers.map(({ name, vram, compute, price, icon: Icon }, i) => (
            <motion.div
              key={name}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="p-5 bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] opacity-60"
            >
              <div className="w-10 h-10 rounded-xl bg-[var(--surface-raised)] border border-[var(--border)] flex items-center justify-center mb-4">
                <Icon size={18} className="text-[var(--text-faint)]" />
              </div>
              <h3 className="font-display font-semibold text-[var(--text-primary)] mb-1">{name}</h3>
              <p className="text-xs text-[var(--text-muted)] mb-3">{vram} · {compute}</p>
              <p className="text-sm font-mono text-[var(--accent)]">{price}</p>
              <Badge variant="phase2" className="mt-3">Coming Soon</Badge>
            </motion.div>
          ))}
        </div>
      </div>

      <Card className="border-dashed">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-xl bg-[var(--surface-raised)] border border-[var(--border)] flex items-center justify-center shrink-0">
            <Clock size={18} className="text-[var(--text-faint)]" />
          </div>
          <div>
            <h3 className="font-semibold text-[var(--text-primary)] mb-1">Planned billing model</h3>
            <ul className="space-y-1 text-sm text-[var(--text-muted)]">
              <li>• Pay-per-run or pay-per-hour compute billing</li>
              <li>• Budget cap per job to prevent runaway costs</li>
              <li>• ALPEN token-denominated compute pricing</li>
              <li>• Trustless settlement via on-chain proof verification</li>
              <li>• Uptime and performance verification per worker</li>
            </ul>
          </div>
        </div>
      </Card>
    </div>
  )
}
