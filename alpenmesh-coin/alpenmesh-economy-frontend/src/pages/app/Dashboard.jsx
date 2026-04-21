import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import {
  Cpu, Wallet, FileCheck, TrendingUp, ArrowRight,
  CheckCircle2, Circle, Globe
} from 'lucide-react'
import { StatWidget } from '@/components/ui/StatWidget'
import { Card, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { PageSpinner } from '@/components/ui/Spinner'
import { useApi } from '@/hooks/useApi'
import { useAuth } from '@/hooks/useAuth'
import { dashboardApi } from '@/api/dashboard'
import { usersApi } from '@/api/users'

function fmt(n = 0) { return new Intl.NumberFormat().format(n) }
function fmtAlpen(n = 0) { return `${Number(n || 0).toFixed(3)} ALPEN` }

export default function Dashboard() {
  const { user } = useAuth()
  const { data: summary, loading: summaryLoading } = useApi(() => dashboardApi.summary())
  const { data: portfolio, loading: portfolioLoading } = useApi(
    () => usersApi.portfolio(user?.user_id),
    [user?.user_id]
  )

  const loading = summaryLoading || portfolioLoading
  const workers = portfolio?.workers || []
  const wallet = portfolio?.wallet
  const hasWorkers = workers.length > 0
  const hasWallet = !!wallet

  const onboardingSteps = [
    { label: 'Create account', done: true },
    { label: 'Connect a worker', done: hasWorkers },
    { label: 'Link payout wallet', done: hasWallet },
    { label: 'Earn ALPEN rewards', done: hasWorkers && hasWallet },
  ]
  const onboardingDone = onboardingSteps.filter(s => s.done).length
  const onboardingProgress = (onboardingDone / onboardingSteps.length) * 100

  const recentProofs = workers.flatMap(w => w.recent_proofs || []).slice(0, 5)

  return (
    <div className="space-y-8">
      {/* Page header */}
      <div>
        <h1 className="font-display font-bold text-2xl text-[var(--text-primary)]">
          Welcome back, {portfolio?.display_name || user?.display_name || 'Contributor'}
        </h1>
        <p className="text-sm text-[var(--text-muted)] mt-1">
          Here is your contributor overview for AlpenMesh Compute.
        </p>
      </div>

      {/* Onboarding checklist */}
      {onboardingDone < onboardingSteps.length && (
        <Card className="border-[var(--accent-border)] bg-[var(--accent-dim)]">
          <CardHeader
            title="Complete your setup"
            subtitle={`${onboardingDone} of ${onboardingSteps.length} steps done`}
          />
          {/* Progress bar */}
          <div className="w-full h-1.5 bg-[var(--surface-raised)] rounded-full mb-4 overflow-hidden">
            <motion.div
              className="h-full bg-[var(--accent)] rounded-full"
              initial={{ width: 0 }}
              animate={{ width: `${onboardingProgress}%` }}
              transition={{ duration: 0.8, delay: 0.2, ease: 'easeOut' }}
            />
          </div>
          <div className="flex flex-col gap-2.5">
            {onboardingSteps.map((step, i) => (
              <div key={i} className="flex items-center gap-3">
                {step.done
                  ? <CheckCircle2 size={16} className="text-[var(--success)] shrink-0" />
                  : <Circle size={16} className="text-[var(--text-faint)] shrink-0" />}
                <span className={`text-sm ${step.done ? 'line-through text-[var(--text-faint)]' : 'text-[var(--text-primary)]'}`}>
                  {step.label}
                </span>
              </div>
            ))}
          </div>
          {!hasWorkers && (
            <div className="mt-4">
              <Link to="/app/workers">
                <Button size="sm">
                  Connect your first worker <ArrowRight size={14} />
                </Button>
              </Link>
            </div>
          )}
        </Card>
      )}

      {/* Summary stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatWidget
          label="Connected Workers"
          value={summaryLoading ? '...' : fmt(summary?.total_workers ?? 0)}
          icon={Cpu}
          loading={summaryLoading}
          delay={0}
        />
        <StatWidget
          label="Inference Jobs"
          value={summaryLoading ? '...' : fmt(summary?.total_inferences ?? 0)}
          icon={TrendingUp}
          loading={summaryLoading}
          delay={0.05}
        />
        <StatWidget
          label="Total Earned"
          value={summaryLoading ? '...' : fmtAlpen(summary?.total_reward_alpen)}
          icon={FileCheck}
          accent
          loading={summaryLoading}
          delay={0.1}
        />
        <StatWidget
          label="Pending Payout"
          value={summaryLoading ? '...' : fmtAlpen(summary?.pending_reward_alpen)}
          icon={Wallet}
          loading={summaryLoading}
          delay={0.15}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* My Workers */}
        <Card>
          <CardHeader
            title="My Workers"
            action={
              <Link to="/app/workers">
                <Button variant="ghost" size="sm">View all <ArrowRight size={13} /></Button>
              </Link>
            }
          />
          {portfolioLoading ? (
            <PageSpinner />
          ) : workers.length === 0 ? (
            <div className="py-8 text-center">
              <Cpu size={28} className="mx-auto text-[var(--text-faint)] mb-3" />
              <p className="text-sm text-[var(--text-muted)]">No workers connected to your account yet.</p>
              <p className="text-xs text-[var(--text-faint)] mt-1 mb-3">Register your first worker to start earning ALPEN.</p>
              <Link to="/app/workers" className="inline-block">
                <Button size="sm">Connect a worker</Button>
              </Link>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {workers.slice(0, 4).map(w => (
                <Link
                  key={w.worker_id}
                  to={`/app/workers/${w.worker_id}`}
                  className="flex items-center justify-between px-3 py-2.5 rounded-[var(--radius-md)] bg-[var(--surface-raised)] border border-[var(--border)] hover:border-[var(--accent-border)] transition-all group"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="w-2 h-2 rounded-full bg-[var(--success)]" />
                    <div>
                      <p className="text-sm font-medium text-[var(--text-primary)]">{w.label}</p>
                      <p className="text-xs text-[var(--text-faint)] font-mono">{w.worker_id.slice(0, 12)}...</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-[var(--accent)] font-mono">{fmtAlpen(w.total_reward_alpen)}</p>
                    <p className="text-xs text-[var(--text-faint)]">{fmt(w.total_inferences)} inf</p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Card>

        {/* Wallet status */}
        <Card>
          <CardHeader title="Payout Wallet" />
          {portfolioLoading ? (
            <PageSpinner />
          ) : wallet ? (
            <div className="flex flex-col gap-3">
              <div className="p-3.5 rounded-[var(--radius-md)] bg-[var(--success-dim)] border border-[var(--success-dim)]">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle2 size={15} className="text-[var(--success)]" />
                  <span className="text-sm font-medium text-[var(--success)]">Wallet linked</span>
                </div>
                <p className="text-xs font-mono text-[var(--text-muted)] break-all">{wallet.wallet_address}</p>
                <p className="text-xs text-[var(--text-faint)] mt-1">{wallet.network}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="text-center p-3 bg-[var(--surface-raised)] rounded-[var(--radius-md)]">
                  <p className="text-lg font-display font-bold text-[var(--accent)]">
                    {fmtAlpen(workers.reduce((s, w) => s + (w.submitted_reward_alpen || 0), 0))}
                  </p>
                  <p className="text-xs text-[var(--text-muted)]">Submitted</p>
                </div>
                <div className="text-center p-3 bg-[var(--surface-raised)] rounded-[var(--radius-md)]">
                  <p className="text-lg font-display font-bold text-[var(--text-primary)]">
                    {fmtAlpen(workers.reduce((s, w) => s + (w.pending_reward_alpen || 0), 0))}
                  </p>
                  <p className="text-xs text-[var(--text-muted)]">Pending</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="py-8 text-center">
              <Wallet size={28} className="mx-auto text-[var(--text-faint)] mb-3" />
              <p className="text-sm text-[var(--text-muted)]">No payout wallet linked to your account.</p>
              <p className="text-xs text-[var(--text-faint)] mt-1 mb-3">Link a wallet to receive your ALPEN rewards.</p>
              <Link to="/app/wallets" className="inline-block">
                <Button size="sm">Link a wallet</Button>
              </Link>
            </div>
          )}
        </Card>
      </div>

      {/* Marketplace teaser */}
      <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-6 flex flex-col sm:flex-row items-start sm:items-center gap-5">
        <div className="w-10 h-10 shrink-0 rounded-xl bg-[var(--accent-dim)] border border-[var(--accent-border)] flex items-center justify-center">
          <Globe size={18} className="text-[var(--accent)]" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[var(--text-primary)] mb-0.5">Compute Marketplace</p>
          <p className="text-sm text-[var(--text-muted)] leading-relaxed">
            Submit containerised workloads and source distributed GPU capacity from the network. Available in the Marketplace section.
          </p>
        </div>
        <Link to="/app/marketplace" className="shrink-0">
          <Button variant="secondary" size="sm">View marketplace <ArrowRight size={13} /></Button>
        </Link>
      </div>
    </div>
  )
}
