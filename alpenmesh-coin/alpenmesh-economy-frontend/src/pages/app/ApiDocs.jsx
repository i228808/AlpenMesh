import { motion } from 'framer-motion'
import { Code2, Webhook, FileCheck, Cpu, DollarSign } from 'lucide-react'
import { Phase2Banner } from '@/components/ui/Phase2Banner'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'

const plannedEndpoints = [
  {
    method: 'POST', path: '/api/v1/jobs/submit',
    desc: 'Submit a containerized compute job to the network.',
    phase2: true,
  },
  {
    method: 'GET', path: '/api/v1/workers/:id/capabilities',
    desc: 'Query worker hardware capabilities and availability.',
    phase2: true,
  },
  {
    method: 'GET', path: '/api/v1/proofs/:id/verify',
    desc: 'Verify a proof batch against on-chain anchors.',
    phase2: true,
  },
  {
    method: 'POST', path: '/api/v1/hooks/settlement',
    desc: 'Register a webhook for real-time settlement events.',
    phase2: true,
  },
]

const currentEndpoints = [
  { method: 'POST', path: '/api/v1/economy/auth/signup', desc: 'Create a new user account.' },
  { method: 'POST', path: '/api/v1/economy/auth/login', desc: 'Authenticate and receive a session token.' },
  { method: 'GET',  path: '/api/v1/economy/dashboard/summary', desc: 'Network-wide economy summary.' },
  { method: 'GET',  path: '/api/v1/economy/users/:id', desc: 'User portfolio with workers and wallet.' },
  { method: 'POST', path: '/api/v1/economy/workers/register', desc: 'Register a new worker with secret.' },
  { method: 'POST', path: '/api/v1/economy/users/:id/workers', desc: 'Connect a worker to user account.' },
  { method: 'GET',  path: '/api/v1/economy/workers/:id', desc: 'Worker earnings snapshot.' },
  { method: 'GET',  path: '/api/v1/economy/workers/:id/proofs', desc: 'Worker proof batch history.' },
  { method: 'POST', path: '/api/v1/economy/workers/:id', desc: 'Bind payout wallet to a worker.' },
  { method: 'POST', path: '/api/v1/economy/users/:id/wallet', desc: 'Link wallet to user account.' },
]

const methodColors = {
  GET:  'bg-[var(--success-dim)] text-[var(--success)]',
  POST: 'bg-[var(--accent-dim)] text-[var(--accent)]',
  PUT:  'bg-[var(--warning-dim)] text-[var(--warning)]',
}

function EndpointRow({ method, path, desc, phase2 }) {
  return (
    <div className={`flex items-start gap-3 py-3 border-b border-[var(--border-subtle)] last:border-0 ${phase2 ? 'opacity-50' : ''}`}>
      <span className={`text-[10px] font-bold font-mono px-1.5 py-0.5 rounded shrink-0 mt-0.5 ${methodColors[method] || 'bg-[var(--surface-raised)] text-[var(--text-muted)]'}`}>
        {method}
      </span>
      <div>
        <code className="text-xs text-[var(--text-primary)]">{path}</code>
        <p className="text-xs text-[var(--text-muted)] mt-0.5">{desc}</p>
      </div>
      {phase2 && <Badge variant="phase2" className="ml-auto shrink-0 text-[9px]">P2</Badge>}
    </div>
  )
}

export default function ApiDocs() {
  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <h1 className="font-display font-bold text-2xl text-[var(--text-primary)]">API Reference</h1>
          <Badge variant="phase2">Partial (Phase 2)</Badge>
        </div>
        <p className="text-sm text-[var(--text-muted)]">Current live endpoints and planned future API surface.</p>
      </div>

      {/* Live APIs */}
      <Card>
        <div className="flex items-center gap-2 mb-4">
          <h2 className="font-display font-semibold text-[var(--text-primary)]">Live Endpoints</h2>
          <Badge variant="live">Active</Badge>
        </div>
        {currentEndpoints.map((ep, i) => (
          <EndpointRow key={i} {...ep} />
        ))}
      </Card>

      {/* Phase 2 */}
      <Phase2Banner
        title="Extended API Coming in Next Phase"
        description="Job submission, worker capability discovery, proof verification, and settlement hooks are planned for Phase 2."
      />

      <Card>
        <div className="flex items-center gap-2 mb-4">
          <h2 className="font-display font-semibold text-[var(--text-primary)]">Planned Phase 2 Endpoints</h2>
          <Badge variant="phase2">Phase 2</Badge>
        </div>
        {plannedEndpoints.map((ep, i) => (
          <EndpointRow key={i} {...ep} phase2 />
        ))}
      </Card>
    </div>
  )
}
