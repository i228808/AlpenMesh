import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowLeft, Cpu, Wallet, FileCheck, TrendingUp, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Alert } from '@/components/ui/Alert'
import { Badge } from '@/components/ui/Badge'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { StatWidget } from '@/components/ui/StatWidget'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner } from '@/components/ui/Spinner'
import { useApi } from '@/hooks/useApi'
import { useAuth } from '@/hooks/useAuth'
import { workersApi } from '@/api/workers'
import { usersApi } from '@/api/users'

function fmt(n = 0) { return new Intl.NumberFormat().format(n) }
function fmtAlpen(n = 0) { return `${Number(n || 0).toFixed(3)} ALPEN` }
function fmtDate(ts) {
  if (!ts) return 'N/A'
  return new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export default function WorkerDetail() {
  const { id } = useParams()
  const { user } = useAuth()
  const [walletInput, setWalletInput] = useState('')
  const [walletSaving, setWalletSaving] = useState(false)
  const [walletMsg, setWalletMsg] = useState(null)

  const { data: earnings, loading: eLoading, refetch: refetchEarnings } = useApi(() => workersApi.earnings(id), [id])
  const { data: proofData, loading: pLoading } = useApi(() => workersApi.proofs(id), [id])

  const proofs = proofData?.proofs || []
  const loading = eLoading || pLoading

  const saveWallet = async (e) => {
    e.preventDefault()
    if (!walletInput.trim()) return
    setWalletSaving(true)
    setWalletMsg(null)
    try {
      await workersApi.bindWallet(id, { wallet_address: walletInput.trim() })
      setWalletMsg({ type: 'success', text: 'Payout wallet updated.' })
      await refetchEarnings()
      setWalletInput('')
    } catch (err) {
      setWalletMsg({ type: 'error', text: err.message })
    } finally {
      setWalletSaving(false)
    }
  }

  if (loading) return <PageSpinner />

  return (
    <div className="space-y-6">
      {/* Back + header */}
      <div>
        <Link to="/app/workers" className="inline-flex items-center gap-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors mb-3">
          <ArrowLeft size={14} /> Workers
        </Link>
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-[var(--surface-raised)] border border-[var(--border)] flex items-center justify-center">
            <Cpu size={20} className="text-[var(--text-muted)]" />
          </div>
          <div>
            <h1 className="font-display font-bold text-2xl text-[var(--text-primary)]">Worker Details</h1>
            <p className="text-sm text-[var(--text-faint)] font-mono">{id}</p>
          </div>
        </div>
      </div>

      {/* Earnings overview */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatWidget label="Total Inferences" value={fmt(earnings?.total_inferences)} icon={TrendingUp} delay={0} />
        <StatWidget label="Total Rewards" value={fmtAlpen(earnings?.total_reward_alpen)} icon={Cpu} accent delay={0.05} />
        <StatWidget label="Pending" value={fmtAlpen(earnings?.pending_reward_alpen)} delay={0.1} />
        <StatWidget label="Submitted" value={fmtAlpen(earnings?.submitted_reward_alpen)} delay={0.15} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Payout wallet */}
        <Card className="lg:col-span-1">
          <CardHeader title="Payout Wallet" />
          {earnings?.payout_wallet ? (
            <div className="mb-4 p-3 bg-[var(--success-dim)] border border-[var(--success-dim)] rounded-[var(--radius-md)]">
              <div className="flex items-center gap-2 mb-1.5">
                <CheckCircle2 size={14} className="text-[var(--success)]" />
                <span className="text-xs font-medium text-[var(--success)]">Wallet bound</span>
              </div>
              <p className="text-xs font-mono text-[var(--text-muted)] break-all">{earnings.payout_wallet}</p>
            </div>
          ) : (
            <div className="mb-4 p-3 bg-[var(--warning-dim)] border border-[var(--warning-dim)] rounded-[var(--radius-md)]">
              <p className="text-xs text-[var(--warning)]">No payout wallet bound. Bind one to receive ALPEN payouts.</p>
            </div>
          )}
          <form onSubmit={saveWallet} className="flex flex-col gap-3">
            {walletMsg && <Alert variant={walletMsg.type} message={walletMsg.text} onDismiss={() => setWalletMsg(null)} />}
            <Input
              placeholder="Wallet address"
              value={walletInput}
              onChange={e => setWalletInput(e.target.value)}
              icon={Wallet}
            />
            <Button type="submit" loading={walletSaving} size="sm" className="w-full justify-center">
              {earnings?.payout_wallet ? 'Update Wallet' : 'Bind Wallet'}
            </Button>
          </form>
        </Card>

        {/* Proof history */}
        <Card className="lg:col-span-2">
          <CardHeader
            title="Recent Proofs"
            subtitle={`${proofs.length} records found`}
          />
          {pLoading ? (
            <PageSpinner />
          ) : proofs.length === 0 ? (
            <EmptyState
              icon={FileCheck}
              title="No proofs yet"
              description="Proof batches will appear here once your worker submits them to the network."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)]">
                    <th className="text-left py-2.5 px-2 text-xs font-medium text-[var(--text-faint)] uppercase tracking-wider">Proof ID</th>
                    <th className="text-left py-2.5 px-2 text-xs font-medium text-[var(--text-faint)] uppercase tracking-wider">Status</th>
                    <th className="text-right py-2.5 px-2 text-xs font-medium text-[var(--text-faint)] uppercase tracking-wider">Inferences</th>
                    <th className="text-right py-2.5 px-2 text-xs font-medium text-[var(--text-faint)] uppercase tracking-wider">Reward</th>
                  </tr>
                </thead>
                <tbody>
                  {proofs.slice(0, 8).map((proof, i) => (
                    <motion.tr
                      key={proof.proof_id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: i * 0.04 }}
                      className="border-b border-[var(--border-subtle)] hover:bg-[var(--surface-raised)] transition-colors"
                    >
                      <td className="py-3 px-2 font-mono text-xs text-[var(--text-muted)]">
                        {proof.proof_id?.slice(0, 14)}...
                      </td>
                      <td className="py-3 px-2">
                        <StatusBadge status={proof.chain_status} />
                      </td>
                      <td className="py-3 px-2 text-right text-xs text-[var(--text-primary)]">
                        {fmt(proof.total_inferences)}
                      </td>
                      <td className="py-3 px-2 text-right text-xs font-mono text-[var(--accent)]">
                        {fmtAlpen(proof.reward_alpen)}
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
