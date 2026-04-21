import { Link, NavLink, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  LayoutDashboard, Cpu, Wallet, FileCheck, User,
  Briefcase, Store, X, LogOut
} from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'

const NAV_ITEMS = [
  {
    group: 'Overview',
    items: [
      { to: '/app/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    ]
  },
  {
    group: 'My Resources',
    items: [
      { to: '/app/workers', label: 'Workers', icon: Cpu },
      { to: '/app/wallets', label: 'Wallets & Rewards', icon: Wallet },
      { to: '/app/proofs', label: 'Proofs', icon: FileCheck },
    ]
  },
  {
    group: 'Compute Market',
    items: [
      { to: '/app/jobs', label: 'Jobs', icon: Briefcase },
      { to: '/app/marketplace', label: 'Marketplace', icon: Store },
    ]
  },
  {
    group: 'Account',
    items: [
      { to: '/app/profile', label: 'Profile', icon: User },
    ]
  },
]

export function Sidebar({ collapsed, onClose, isMobile }) {
  const { logout } = useAuth()
  const navigate = useNavigate()

  const isCollapsed = collapsed && !isMobile

  const handleSignOut = () => {
    logout()
    navigate('/')
  }

  return (
    <aside
      className={`
        flex flex-col h-full bg-[var(--surface)] border-r border-[var(--border)]
        transition-all duration-300 ease-in-out
        ${isCollapsed ? 'w-[60px]' : 'w-[220px]'}
      `}
    >
      {/* Logo */}
      <div className={`h-16 flex items-center border-b border-[var(--border)] shrink-0 overflow-hidden ${isCollapsed ? 'justify-center px-0' : 'gap-3 px-4'}`}>
        {/* Favicon monogram — visible only when collapsed */}
        <AnimatePresence initial={false} mode="wait">
          {isCollapsed ? (
            <motion.div
              key="monogram"
              initial={{ opacity: 0, scale: 0.7 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.7 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className="w-8 h-8 rounded-lg bg-[var(--accent)] flex items-center justify-center shrink-0"
            >
              <span className="font-display font-bold text-sm text-[var(--bg)] leading-none select-none">A</span>
            </motion.div>
          ) : (
            <motion.span
              key="wordmark"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className="font-display font-bold text-[15px] text-[var(--text-primary)] whitespace-nowrap overflow-hidden tracking-tight"
            >
              AlpenMesh <span className="text-[var(--accent)]">Compute</span>
            </motion.span>
          )}
        </AnimatePresence>

        {isMobile && (
          <button
            onClick={onClose}
            className="ml-auto w-7 h-7 flex items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--surface-raised)] transition-colors"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 flex flex-col gap-4">
        {NAV_ITEMS.map(({ group, items }) => (
          <div key={group}>
            <AnimatePresence initial={false}>
              {!isCollapsed && (
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="text-[10px] font-semibold text-[var(--text-faint)] uppercase tracking-widest px-2 mb-1"
                >
                  {group}
                </motion.p>
              )}
            </AnimatePresence>

            {items.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) => `
                  flex items-center mb-0.5 text-sm font-medium transition-colors duration-150
                  rounded-lg
                  ${isCollapsed ? 'justify-center w-full h-10' : 'gap-2.5 px-2.5 py-2'}
                  ${isActive
                    ? 'bg-[var(--accent-dim)] text-[var(--accent)] border border-[var(--accent-border)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-raised)]'}
                `}
                title={isCollapsed ? label : undefined}
              >
                <Icon size={18} className="shrink-0" />
                <AnimatePresence initial={false}>
                  {!isCollapsed && (
                    <motion.span
                      initial={{ opacity: 0, width: 0 }}
                      animate={{ opacity: 1, width: 'auto' }}
                      exit={{ opacity: 0, width: 0 }}
                      transition={{ duration: 0.2 }}
                      className="flex-1 overflow-hidden whitespace-nowrap"
                    >
                      {label}
                    </motion.span>
                  )}
                </AnimatePresence>
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      {/* Sign out + version tag */}
      <div className="px-2 pb-3 border-t border-[var(--border)] shrink-0 pt-3 flex flex-col gap-2">
        <motion.button
          onClick={handleSignOut}
          whileHover={{ x: isCollapsed ? 0 : 2 }}
          whileTap={{ scale: 0.97 }}
          transition={{ type: 'spring', stiffness: 400, damping: 20 }}
          className={`
            flex items-center rounded-lg w-full text-sm font-medium
            text-[var(--text-muted)] hover:text-red-400 hover:bg-red-500/10
            transition-colors duration-150
            ${isCollapsed ? 'justify-center h-10' : 'gap-2.5 px-2.5 py-2'}
          `}
          title={isCollapsed ? 'Sign Out' : undefined}
        >
          <LogOut size={18} className="shrink-0" />
          <AnimatePresence initial={false}>
            {!isCollapsed && (
              <motion.span
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: 'auto' }}
                exit={{ opacity: 0, width: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden whitespace-nowrap"
              >
                Sign Out
              </motion.span>
            )}
          </AnimatePresence>
        </motion.button>

        <AnimatePresence initial={false}>
          {!isCollapsed && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="px-2"
            >
              <p className="text-[10px] text-[var(--text-faint)]">AlpenMesh Compute</p>
              <p className="text-[10px] text-[var(--text-faint)]">Network active</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </aside>
  )
}
