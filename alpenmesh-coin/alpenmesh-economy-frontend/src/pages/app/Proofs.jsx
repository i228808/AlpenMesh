import { useState, useMemo } from 'react'
import { motion } from 'framer-motion'
import { FileCheck, Search, Filter } from 'lucide-react'
import { Card, CardHeader } from '@/components/ui/Card'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner } from '@/components/ui/Spinner'
import { Input } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { useApi } from '@/hooks/useApi'
import { useAuth } from '@/hooks/useAuth'
import { usersApi } from '@/api/users'
import { workersApi } from '@/api/workers'

function fmtAlpen(n = 0) { return `${Number(n || 0).toFixed(3)} ALPEN` }
function fmt(n = 0) { return new Intl.NumberFormat().format(n) }
function fmtDate(ts) {
  if (!ts) return 'N/A'
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

const STATUSES = ['all', 'queued', 'pending', 'submitted', 'confirmed', 'failed']

export default function Proofs() {
  const { user } = useAuth()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')

  const { data: portfolio, loading: portfolioLoading } = useApi(
    () => usersApi.portfolio(user?.user_id),
    [user?.user_id]
  )
  const workers = portfolio?.workers || []

  const proofsQueries = workers.map(w => ({
    workerId: w.worker_id,
    label: w.label,
  }))

  const [allProofs, setAllProofs] = useState([])
  const [proofsLoading, setProofsLoading] = useState(false)
  const [fetched, setFetched] = useState(false)

  // Fetch all worker proofs once workers are loaded
  useMemo(() => {
    if (workers.length > 0 && !fetched) {
      setFetched(true)
      setProofsLoading(true)
      Promise.all(
        workers.map(w => workersApi.proofs(w.worker_id).then(d => ({
          workerLabel: w.label,
          proofs: d?.proofs || [],
        })))
      ).then(results => {
        const flat = results.flatMap(r =>
          r.proofs.map(p => ({ ...p, workerLabel: r.workerLabel }))
        ).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        setAllProofs(flat)
        setProofsLoading(false)
      }).catch(() => setProofsLoading(false))
    }
  }, [workers, fetched])

  const filtered = useMemo(() => {
    return allProofs.filter(p => {
      const matchesStatus = statusFilter === 'all' || p.chain_status === statusFilter
      const matchesSearch = !search || p.proof_id?.toLowerCase().includes(search.toLowerCase()) || p.workerLabel?.toLowerCase().includes(search.toLowerCase())
      return matchesStatus && matchesSearch
    })
  }, [allProofs, search, statusFilter])

  const loading = portfolioLoading || proofsLoading

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display font-bold text-2xl text-[var(--text-primary)]">Proof History</h1>
        <p className="text-sm text-[var(--text-muted)] mt-1">All proof batches submitted to the network across your workers.</p>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1">
          <Input
            placeholder="Search by proof ID or worker..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            icon={Search}
          />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {STATUSES.map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors border
                ${statusFilter === s
                  ? 'bg-[var(--accent-dim)] border-[var(--accent-border)] text-[var(--accent)]'
                  : 'border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <Card padding="p-0">
        <div className="px-6 py-4 border-b border-[var(--border)] flex items-center justify-between">
          <div>
            <h3 className="font-display font-semibold text-[var(--text-primary)]">Proof Batches</h3>
            {!loading && <p className="text-xs text-[var(--text-muted)] mt-0.5">{filtered.length} records</p>}
          </div>
          {statusFilter !== 'all' && <Badge variant="accent">{statusFilter}</Badge>}
        </div>

        {loading ? (
          <div className="py-16"><PageSpinner /></div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={FileCheck}
            title="No proof records found"
            description="Your workers haven't submitted any proofs yet, or none match your current filters."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  <th className="text-left py-3 px-5 text-xs font-medium text-[var(--text-faint)] uppercase tracking-wider">Proof ID</th>
                  <th className="text-left py-3 px-3 text-xs font-medium text-[var(--text-faint)] uppercase tracking-wider">Worker</th>
                  <th className="text-left py-3 px-3 text-xs font-medium text-[var(--text-faint)] uppercase tracking-wider">Status</th>
                  <th className="text-right py-3 px-3 text-xs font-medium text-[var(--text-faint)] uppercase tracking-wider">Inferences</th>
                  <th className="text-right py-3 px-3 text-xs font-medium text-[var(--text-faint)] uppercase tracking-wider">Reward</th>
                  <th className="text-right py-3 px-5 text-xs font-medium text-[var(--text-faint)] uppercase tracking-wider">Date</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((proof, i) => (
                  <motion.tr
                    key={`${proof.proof_id}-${i}`}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: Math.min(i * 0.02, 0.3) }}
                    className="border-b border-[var(--border-subtle)] hover:bg-[var(--surface-raised)] transition-colors"
                  >
                    <td className="py-3.5 px-5 font-mono text-xs text-[var(--text-muted)]">
                      {proof.proof_id?.slice(0, 16)}...
                    </td>
                    <td className="py-3.5 px-3 text-sm text-[var(--text-muted)]">
                      <span className="truncate max-w-[120px] block">{proof.workerLabel}</span>
                    </td>
                    <td className="py-3.5 px-3">
                      <StatusBadge status={proof.chain_status} />
                    </td>
                    <td className="py-3.5 px-3 text-right text-sm text-[var(--text-primary)]">
                      {fmt(proof.total_inferences)}
                    </td>
                    <td className="py-3.5 px-3 text-right font-mono text-xs text-[var(--accent)]">
                      {fmtAlpen(proof.reward_alpen)}
                    </td>
                    <td className="py-3.5 px-5 text-right text-xs text-[var(--text-faint)]">
                      {fmtDate(proof.timestamp)}
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
