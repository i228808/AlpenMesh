import { useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Cpu, Plus, ArrowRight, Key, Tag, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { Dialog } from '@/components/ui/Dialog'
import { Input } from '@/components/ui/Input'
import { Alert } from '@/components/ui/Alert'
import { EmptyState } from '@/components/ui/EmptyState'
import { Badge } from '@/components/ui/Badge'
import { PageSpinner } from '@/components/ui/Spinner'
import { useApi } from '@/hooks/useApi'
import { useAuth } from '@/hooks/useAuth'
import { usersApi } from '@/api/users'
import { workersApi } from '@/api/workers'

function fmt(n = 0) { return new Intl.NumberFormat().format(n) }
function fmtAlpen(n = 0) { return `${Number(n || 0).toFixed(3)} ALPEN` }

function WorkerCard({ worker, index }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.05 }}
    >
      <Link to={`/app/workers/${worker.worker_id}`}>
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] p-5 hover:border-[var(--accent-border)] hover:shadow-[var(--shadow-md)] transition-all duration-200 group">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[var(--surface-raised)] border border-[var(--border)] flex items-center justify-center group-hover:border-[var(--accent-border)] transition-colors">
                <Cpu size={18} className="text-[var(--text-muted)] group-hover:text-[var(--accent)] transition-colors" />
              </div>
              <div>
                <h3 className="font-semibold text-[var(--text-primary)] font-display">{worker.label}</h3>
                <p className="text-xs text-[var(--text-faint)] font-mono mt-0.5">{worker.worker_id}</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[var(--success)]" />
              <span className="text-xs text-[var(--success)]">Active</span>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="text-center p-2.5 bg-[var(--surface-raised)] rounded-lg">
              <p className="text-sm font-bold font-display text-[var(--accent)]">{fmtAlpen(worker.total_reward_alpen)}</p>
              <p className="text-[10px] text-[var(--text-faint)] mt-0.5">Total Earned</p>
            </div>
            <div className="text-center p-2.5 bg-[var(--surface-raised)] rounded-lg">
              <p className="text-sm font-bold font-display text-[var(--text-primary)]">{fmt(worker.total_inferences)}</p>
              <p className="text-[10px] text-[var(--text-faint)] mt-0.5">Inferences</p>
            </div>
            <div className="text-center p-2.5 bg-[var(--surface-raised)] rounded-lg">
              <p className="text-sm font-bold font-display text-[var(--warning)]">{fmtAlpen(worker.pending_reward_alpen)}</p>
              <p className="text-[10px] text-[var(--text-faint)] mt-0.5">Pending</p>
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between">
            {worker.payout_wallet ? (
              <p className="text-xs text-[var(--text-faint)] font-mono truncate max-w-[180px]">
                {worker.payout_wallet.slice(0, 8)}...{worker.payout_wallet.slice(-6)}
              </p>
            ) : (
              <Badge variant="warning">No payout wallet</Badge>
            )}
            <ArrowRight size={14} className="text-[var(--text-faint)] group-hover:text-[var(--accent)] transition-colors" />
          </div>
        </div>
      </Link>
    </motion.div>
  )
}

export default function Workers() {
  const { user } = useAuth()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [step, setStep] = useState('register') // 'register' | 'connect'
  const [form, setForm] = useState({ worker_id: '', worker_secret: '', label: '' })
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')
  const [formSuccess, setFormSuccess] = useState('')

  const { data: portfolio, loading, refetch } = useApi(
    () => usersApi.portfolio(user?.user_id),
    [user?.user_id]
  )
  const workers = portfolio?.workers || []

  const handleChange = e => setForm(f => ({ ...f, [e.target.name]: e.target.value }))

  const openDialog = () => {
    setStep('register')
    setForm({ worker_id: '', worker_secret: '', label: '' })
    setFormError('')
    setFormSuccess('')
    setDialogOpen(true)
  }

  const handleRegister = async (e) => {
    e.preventDefault()
    setFormError('')
    setSubmitting(true)
    try {
      await workersApi.register({ worker_id: form.worker_id, worker_secret: form.worker_secret })
      setFormSuccess('Worker registered. Now connect it to your account.')
      setStep('connect')
    } catch (err) {
      setFormError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleConnect = async (e) => {
    e.preventDefault()
    setFormError('')
    setSubmitting(true)
    try {
      await usersApi.connectWorker(user.user_id, form)
      setFormSuccess(`Worker "${form.label || form.worker_id}" connected successfully!`)
      await refetch()
      setTimeout(() => { setDialogOpen(false); setFormSuccess('') }, 1500)
    } catch (err) {
      setFormError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display font-bold text-2xl text-[var(--text-primary)]">Workers</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">Manage your connected compute workers.</p>
        </div>
        <Button onClick={openDialog}>
          <Plus size={15} /> Connect Worker
        </Button>
      </div>

      {loading ? (
        <PageSpinner />
      ) : workers.length === 0 ? (
        <Card>
          <EmptyState
            icon={Cpu}
            title="No workers connected"
            description="Connect your first worker to start contributing GPU compute and earning ALPEN rewards."
            action={<Button onClick={openDialog}><Plus size={14} /> Connect Worker</Button>}
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {workers.map((w, i) => (
            <WorkerCard key={w.worker_id} worker={w} index={i} />
          ))}
        </div>
      )}

      {/* Connect Worker Dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} title="Connect Worker">
        <div className="flex gap-2 mb-5">
          <button
            onClick={() => setStep('register')}
            className={`flex-1 py-2 text-sm rounded-lg font-medium transition-colors border
              ${step === 'register' ? 'bg-[var(--accent-dim)] border-[var(--accent-border)] text-[var(--accent)]' : 'border-[var(--border)] text-[var(--text-muted)]'}`}
          >
            1. Register
          </button>
          <button
            onClick={() => setStep('connect')}
            className={`flex-1 py-2 text-sm rounded-lg font-medium transition-colors border
              ${step === 'connect' ? 'bg-[var(--accent-dim)] border-[var(--accent-border)] text-[var(--accent)]' : 'border-[var(--border)] text-[var(--text-muted)]'}`}
          >
            2. Connect
          </button>
        </div>

        {formError && <div className="mb-4"><Alert variant="error" message={formError} onDismiss={() => setFormError('')} /></div>}
        {formSuccess && <div className="mb-4"><Alert variant="success" message={formSuccess} /></div>}

        {step === 'register' ? (
          <form onSubmit={handleRegister} className="flex flex-col gap-4">
            <p className="text-sm text-[var(--text-muted)]">First, register your worker ID and secret with the network. Use the same credentials from your local AlpenMesh worker install.</p>
            <Input label="Worker ID" name="worker_id" value={form.worker_id} onChange={handleChange} icon={Cpu} placeholder="e.g. worker-abc123" required />
            <Input label="Worker Secret" name="worker_secret" type="password" value={form.worker_secret} onChange={handleChange} icon={Key} placeholder="Your worker secret key" required />
            <Button type="submit" loading={submitting} className="w-full justify-center">Register Worker</Button>
          </form>
        ) : (
          <form onSubmit={handleConnect} className="flex flex-col gap-4">
            <p className="text-sm text-[var(--text-muted)]">Now claim this worker under your account using the same credentials.</p>
            <Input label="Worker ID" name="worker_id" value={form.worker_id} onChange={handleChange} icon={Cpu} placeholder="Same Worker ID as step 1" required />
            <Input label="Worker Secret" name="worker_secret" type="password" value={form.worker_secret} onChange={handleChange} icon={Key} placeholder="Your worker secret key" required />
            <Input label="Label (optional)" name="label" value={form.label} onChange={handleChange} icon={Tag} placeholder="e.g. My RTX 4090" />
            <Button type="submit" loading={submitting} className="w-full justify-center">Connect to My Account</Button>
          </form>
        )}
      </Dialog>
    </div>
  )
}
