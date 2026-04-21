import { motion } from 'framer-motion'
import { User, Mail, Wallet, Cpu, Shield, LogOut } from 'lucide-react'
import { Card, CardHeader } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { PageSpinner } from '@/components/ui/Spinner'
import { useApi } from '@/hooks/useApi'
import { useAuth } from '@/hooks/useAuth'
import { usersApi } from '@/api/users'
import { useNavigate } from 'react-router-dom'

function InfoRow({ icon: Icon, label, value, mono = false }) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-[var(--border-subtle)] last:border-0">
      <div className="flex items-center gap-2.5 text-[var(--text-muted)]">
        <Icon size={14} />
        <span className="text-sm">{label}</span>
      </div>
      <span className={`text-sm text-[var(--text-primary)] ${mono ? 'font-mono text-xs' : 'font-medium'} truncate max-w-[220px]`}>
        {value || <span className="text-[var(--text-faint)]">Not set</span>}
      </span>
    </div>
  )
}

export default function Profile() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const { data: portfolio, loading } = useApi(
    () => usersApi.portfolio(user?.user_id),
    [user?.user_id]
  )

  const handleLogout = () => {
    logout()
    navigate('/')
  }

  const initials = portfolio?.display_name
    ? portfolio.display_name.slice(0, 2).toUpperCase()
    : user?.email?.slice(0, 2).toUpperCase() || 'AM'

  if (loading) return <PageSpinner />

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div>
        <h1 className="font-display font-bold text-2xl text-[var(--text-primary)]">Account Profile</h1>
        <p className="text-sm text-[var(--text-muted)] mt-1">Your AlpenMesh Compute account details.</p>
      </div>

      {/* Avatar card */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center gap-5 p-6 bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-xl)]"
      >
        <div className="w-16 h-16 rounded-2xl bg-[var(--accent-dim)] border-2 border-[var(--accent-border)] flex items-center justify-center">
          <span className="font-display font-bold text-2xl text-[var(--accent)]">{initials}</span>
        </div>
        <div>
          <h2 className="font-display font-bold text-xl text-[var(--text-primary)]">
            {portfolio?.display_name || 'Worker'}
          </h2>
          <p className="text-sm text-[var(--text-muted)]">{portfolio?.email || user?.email}</p>
          <div className="flex items-center gap-2 mt-2">
            <Badge variant="live">Active Account</Badge>
            <Badge variant="default">{portfolio?.workers?.length || 0} Workers</Badge>
          </div>
        </div>
      </motion.div>

      {/* Account info */}
      <Card>
        <CardHeader title="Account Information" />
        <InfoRow icon={User} label="Display Name" value={portfolio?.display_name} />
        <InfoRow icon={Mail} label="Email" value={portfolio?.email} />
        <InfoRow icon={Shield} label="User ID" value={user?.user_id} mono />
        <InfoRow icon={Cpu} label="Connected Workers" value={`${portfolio?.workers?.length || 0} workers`} />
        <InfoRow
          icon={Wallet}
          label="Payout Wallet"
          value={portfolio?.wallet?.wallet_address}
          mono
        />
      </Card>

      {/* Session */}
      <Card>
        <CardHeader title="Session" />
        <InfoRow icon={Shield} label="Session Token" value={`${user?.session_token?.slice(0, 24)}...`} mono />
        <div className="mt-5">
          <Button variant="danger" onClick={handleLogout}>
            <LogOut size={14} /> Sign Out
          </Button>
        </div>
      </Card>
    </div>
  )
}
