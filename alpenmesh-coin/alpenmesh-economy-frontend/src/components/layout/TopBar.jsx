import { PanelLeft, Menu } from 'lucide-react'
import { ThemeToggle } from './ThemeToggle'
import { useAuth } from '@/hooks/useAuth'
import { Link } from 'react-router-dom'

export function TopBar({ onToggleSidebar, onOpenMobile }) {
  const { user, logout } = useAuth()
  const initials = user?.display_name
    ? user.display_name.slice(0, 2).toUpperCase()
    : user?.email?.slice(0, 2).toUpperCase() || 'AM'

  return (
    <header className="h-16 border-b border-[var(--border)] bg-[var(--surface)] flex items-center px-4 gap-3 shrink-0">
      {/* Sidebar toggle desktop */}
      <button
        onClick={onToggleSidebar}
        className="hidden md:flex w-9 h-9 items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-raised)] transition-colors"
        aria-label="Toggle sidebar"
      >
        <PanelLeft size={18} />
      </button>

      {/* Mobile menu open */}
      <button
        onClick={onOpenMobile}
        className="md:hidden flex w-9 h-9 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--surface-raised)] transition-colors"
        aria-label="Open menu"
      >
        <Menu size={18} />
      </button>

      <div className="flex-1" />

      <ThemeToggle />

      {/* User avatar */}
      <div className="relative group">
        <button className="w-9 h-9 rounded-full bg-[var(--accent-dim)] border border-[var(--accent-border)] text-[var(--accent)] text-sm font-bold font-display flex items-center justify-center">
          {initials}
        </button>
        {/* Dropdown */}
        <div className="absolute right-0 top-full mt-1 w-48 bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-md)] shadow-[var(--shadow-md)] invisible group-hover:visible opacity-0 group-hover:opacity-100 transition-all duration-150 z-50">
          <div className="px-3 py-2.5 border-b border-[var(--border)]">
            <p className="text-sm font-medium text-[var(--text-primary)] truncate">{user?.display_name || 'Worker'}</p>
            <p className="text-xs text-[var(--text-muted)] truncate">{user?.email}</p>
          </div>
          <div className="p-1">
            <Link
              to="/app/profile"
              className="block px-2.5 py-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-raised)] rounded-md transition-colors"
            >
              Profile
            </Link>
            <button
              onClick={logout}
              className="block w-full text-left px-2.5 py-1.5 text-sm text-[var(--error)] hover:bg-[var(--error-dim)] rounded-md transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    </header>
  )
}
