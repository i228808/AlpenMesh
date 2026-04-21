import { motion } from 'framer-motion'
import { Briefcase, Container, Cpu, Clock, Terminal, HardDrive } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Phase2Banner } from '@/components/ui/Phase2Banner'
import { Badge } from '@/components/ui/Badge'

const plannedFeatures = [
  { icon: Container, title: 'Docker/Container Jobs', desc: 'Submit containerized workloads with custom images and entrypoints.' },
  { icon: Cpu, title: 'GPU Requirements', desc: 'Specify VRAM, compute class, and runtime constraints per job.' },
  { icon: Terminal, title: 'Command & Entrypoint', desc: 'Define run commands, environment variables, and arguments.' },
  { icon: HardDrive, title: 'Output Management', desc: 'Route job outputs to storage destinations or webhooks.' },
  { icon: Clock, title: 'Job Lifecycle', desc: 'Monitor job status from queued → running → completed → settled.' },
]

export default function Jobs() {
  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <h1 className="font-display font-bold text-2xl text-[var(--text-primary)]">Job Submission</h1>
          <Badge variant="phase2">Phase 2</Badge>
        </div>
        <p className="text-sm text-[var(--text-muted)]">Submit compute workloads to the AlpenMesh distributed GPU network.</p>
      </div>

      <Phase2Banner
        title="Job Submission Coming in Next Phase"
        description="In Phase 2, you'll be able to submit containerized workloads, specify GPU requirements, and track execution across the AlpenMesh network."
      />

      <div>
        <h2 className="font-display font-semibold text-[var(--text-primary)] mb-4">Planned Features</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {plannedFeatures.map(({ icon: Icon, title, desc }, i) => (
            <motion.div
              key={title}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="p-5 bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] opacity-60"
            >
              <div className="w-9 h-9 rounded-lg bg-[var(--surface-raised)] border border-[var(--border)] flex items-center justify-center mb-3">
                <Icon size={16} className="text-[var(--text-faint)]" />
              </div>
              <h3 className="font-semibold text-sm text-[var(--text-primary)] mb-1">{title}</h3>
              <p className="text-xs text-[var(--text-muted)] leading-relaxed">{desc}</p>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Mockup form preview */}
      <Card className="opacity-50 pointer-events-none select-none">
        <div className="absolute inset-0 flex items-center justify-center z-10">
          <Badge variant="phase2" className="text-sm px-4 py-2">Coming in Next Phase</Badge>
        </div>
        <div className="relative">
          <h3 className="font-display font-semibold text-[var(--text-primary)] mb-4">Submit a Job</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="h-10 bg-[var(--surface-raised)] rounded-lg border border-[var(--border)]" />
            <div className="h-10 bg-[var(--surface-raised)] rounded-lg border border-[var(--border)]" />
            <div className="col-span-2 h-10 bg-[var(--surface-raised)] rounded-lg border border-[var(--border)]" />
            <div className="h-10 bg-[var(--surface-raised)] rounded-lg border border-[var(--border)]" />
            <div className="h-10 bg-[var(--surface-raised)] rounded-lg border border-[var(--border)]" />
            <div className="col-span-2 h-10 bg-[var(--accent)] rounded-lg opacity-30" />
          </div>
        </div>
      </Card>
    </div>
  )
}
