import { Badge } from './Badge'

const chainStatusMap = {
  queued:    { variant: 'default',  label: 'Queued' },
  pending:   { variant: 'warning',  label: 'Pending' },
  submitted: { variant: 'accent',   label: 'Submitted' },
  confirmed: { variant: 'success',  label: 'Confirmed' },
  failed:    { variant: 'error',    label: 'Failed' },
  active:    { variant: 'success',  label: 'Active' },
  inactive:  { variant: 'default',  label: 'Inactive' },
}

export function StatusBadge({ status }) {
  const mapped = chainStatusMap[status?.toLowerCase()] || { variant: 'default', label: status || 'Unknown' }
  return <Badge variant={mapped.variant}>{mapped.label}</Badge>
}

export function OnlineIndicator({ online = true }) {
  return (
    <span className={`inline-block w-2 h-2 rounded-full ${online ? 'bg-[var(--success)]' : 'bg-[var(--text-faint)]'}`} />
  )
}
