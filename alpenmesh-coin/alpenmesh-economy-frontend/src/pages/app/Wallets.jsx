import { useState } from 'react'
import { motion } from 'framer-motion'
import { Wallet, Cpu, CheckCircle2, AlertCircle, TrendingUp, Globe } from 'lucide-react'
import { Card, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Alert } from '@/components/ui/Alert'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { StatWidget } from '@/components/ui/StatWidget'
import { PageSpinner } from '@/components/ui/Spinner'
import { useApi } from '@/hooks/useApi'
import { useAuth } from '@/hooks/useAuth'
import { usersApi } from '@/api/users'
import { workersApi } from '@/api/workers'

function fmtAlpen(n = 0) { return `${Number(n || 0).toFixed(3)} ALPEN` }

export default function Wallets() {
  const { user } = useAuth()
  const { data: portfolio, loading, refetch } = useApi(
    () => usersApi.portfolio(user?.user_id),
    [user?.user_id]
  )

  const [walletForm, setWalletForm] = useState({ wallet_address: '', network: 'solana-localnet' })
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)

  const workers = portfolio?.workers || []
  const wallet = portfolio?.wallet

  const totalEarned = workers.reduce((s, w) => s + (w.total_reward_alpen || 0), 0)
  const totalSubmitted = workers.reduce((s, w) => s + (w.submitted_reward_alpen || 0), 0)
  const totalPending = workers.reduce((s, w) => s + (w.pending_reward_alpen || 0), 0)

  const handleSaveWallet = async (e) => {
    e.preventDefault()
    if (!walletForm.wallet_address.trim()) return
    setSaving(true)
    setMsg(null)
    try {
      await usersApi.connectWallet(user.user_id, walletForm)
      setMsg({ type: 'success', text: 'Payout wallet connected successfully.' })
      await refetch()
      setWalletForm(f => ({ ...f, wallet_address: '' }))
    } catch (err) {
      setMsg({ type: 'error', text: err.message })
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <PageSpinner />

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display font-bold text-2xl text-[var(--text-primary)]">Wallets & Rewards</h1>
        <p className="text-sm text-[var(--text-muted)] mt-1">Manage your payout wallet and view earnings across all workers.</p>
      </div>

      {/* Earnings summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatWidget label="Total Rewards" value={fmtAlpen(totalEarned)} accent icon={TrendingUp} delay={0} />
        <StatWidget label="Submitted" value={fmtAlpen(totalSubmitted)} delay={0.05} />
        <StatWidget label="Pending" value={fmtAlpen(totalPending)} delay={0.1} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* User wallet */}
        <Card>
          <CardHeader title="Account Payout Wallet" subtitle="Linked to your AlpenMesh account" />
          {wallet ? (
            <div className="space-y-4">
              <div className="p-4 bg-[var(--success-dim)] border border-[var(--success-dim)] rounded-[var(--radius-md)]">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle2 size={15} className="text-[var(--success)]" />
                  <span className="text-sm font-medium text-[var(--success)]">Connected</span>
                </div>
                <p className="text-sm font-mono text-[var(--text-primary)] break-all mb-1.5">{wallet.wallet_address}</p>
                <div className="flex items-center gap-2">
                  <Globe size={12} className="text-[var(--text-faint)]" />
                  <span className="text-xs text-[var(--text-faint)]">{wallet.network}</span>
                </div>
              </div>
              <p className="text-xs text-[var(--text-muted)]">Update your wallet address below:</p>
            </div>
          ) : (
            <div className="p-4 mb-4 bg-[var(--warning-dim)] border border-[var(--warning-dim)] rounded-[var(--radius-md)]">
              <div className="flex items-center gap-2">
                <AlertCircle size={14} className="text-[var(--warning)]" />
                <p className="text-sm text-[var(--warning)]">No payout wallet linked yet.</p>
              </div>
            </div>
          )}
          {msg && (
            <div className="mb-3">
              <Alert variant={msg.type} message={msg.text} onDismiss={() => setMsg(null)} />
            </div>
          )}
          <form onSubmit={handleSaveWallet} className="flex flex-col gap-3 mt-3">
            <Input
              label="Wallet Address"
              placeholder="Your wallet address"
              value={walletForm.wallet_address}
              onChange={e => setWalletForm(f => ({ ...f, wallet_address: e.target.value }))}
              icon={Wallet}
              required
            />
            <Input
              label="Network"
              placeholder="e.g. solana-localnet"
              value={walletForm.network}
              onChange={e => setWalletForm(f => ({ ...f, network: e.target.value }))}
              icon={Globe}
            />
            <Button type="submit" loading={saving} className="w-full justify-center">
              {wallet ? 'Update Wallet' : 'Connect Wallet'}
            </Button>
          </form>
        </Card>

        {/* Per-worker wallets */}
        <Card>
          <CardHeader title="Worker Payout Wallets" subtitle="Wallets bound per worker" />
          {workers.length === 0 ? (
            <EmptyState
              icon={Cpu}
              title="No workers"
              description="Connect a worker first to manage per-worker payout wallets."
            />
          ) : (
            <div className="flex flex-col gap-3">
              {workers.map((w, i) => (
                <motion.div
                  key={w.worker_id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="flex items-center justify-between gap-3 p-3 bg-[var(--surface-raised)] rounded-[var(--radius-md)] border border-[var(--border)]"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Cpu size={14} className="text-[var(--text-faint)] shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[var(--text-primary)] truncate">{w.label}</p>
                      {w.payout_wallet ? (
                        <p className="text-xs font-mono text-[var(--text-faint)] truncate">{w.payout_wallet.slice(0, 16)}...</p>
                      ) : (
                        <span className="text-xs text-[var(--warning)]">No wallet bound</span>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs font-mono text-[var(--accent)]">{fmtAlpen(w.total_reward_alpen)}</p>
                    {w.payout_wallet
                      ? <Badge variant="success">Bound</Badge>
                      : <Badge variant="warning">Unbound</Badge>}
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
