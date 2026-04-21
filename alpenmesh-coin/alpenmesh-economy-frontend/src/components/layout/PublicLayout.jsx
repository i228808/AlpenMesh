import { useState } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { Menu, X, MessageSquare } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { ThemeToggle } from './ThemeToggle'
import { Button } from '@/components/ui/Button'

const FOOTER_COLS = [
  {
    heading: 'Platform',
    links: [
      { to: '/features', label: 'Features' },
      { to: '/how-it-works', label: 'How it works' },
      { to: '/marketplace', label: 'Marketplace' },
      { to: '/about', label: 'About' },
    ],
  },
  {
    heading: 'Account',
    links: [
      { to: '/signup', label: 'Create account' },
      { to: '/login', label: 'Sign in' },
      { to: '/dashboard', label: 'Dashboard' },
      { to: '/dashboard/workers', label: 'Workers' },
    ],
  },
  {
    heading: 'Resources',
    links: [
      { to: '/how-it-works', label: 'Getting started' },
      { to: '/features', label: 'Feature overview' },
      { to: '/dashboard/api-docs', label: 'API reference' },
    ],
  },
  {
    heading: 'Legal',
    links: [
      { to: '/privacy', label: 'Privacy policy' },
      { to: '/terms', label: 'Terms of service' },
      { to: '/cookies', label: 'Cookie policy' },
    ],
  },
]

const NAV_LINKS = [
  { to: '/features', label: 'Features' },
  { to: '/how-it-works', label: 'How It Works' },
  { to: '/marketplace', label: 'Marketplace' },
  { to: '/about', label: 'About' },
]

export function PublicLayout({ children }) {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg)]">
      {/* Navbar */}
      <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-[var(--bg)]/90 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-5 h-16 flex items-center justify-between gap-6">
          {/* Logo */}
          <Link
            to="/"
            className="font-display font-bold text-lg text-[var(--text-primary)] shrink-0 tracking-tight"
          >
            AlpenMesh <span className="text-[var(--accent)]">Compute</span>
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-1">
            {NAV_LINKS.map(({ to, label }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  `px-3.5 py-2 rounded-lg text-sm font-medium transition-colors duration-150
                  ${isActive ? 'text-[var(--accent)] bg-[var(--accent-dim)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-raised)]'}`
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>

          {/* Right side */}
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <div className="hidden md:flex items-center gap-2">
              <Link to="/login">
                <Button variant="ghost" size="sm">Sign In</Button>
              </Link>
              <Link to="/signup">
                <Button variant="cta" size="sm">Get Started</Button>
              </Link>
            </div>
            <button
              className="md:hidden w-8 h-8 flex items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--surface-raised)] transition-colors"
              onClick={() => setMobileOpen(v => !v)}
              aria-label="Toggle menu"
            >
              {mobileOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
          </div>
        </div>

        {/* Mobile menu */}
        <AnimatePresence>
          {mobileOpen && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="md:hidden border-t border-[var(--border)] bg-[var(--bg)] px-5 py-4 flex flex-col gap-1"
            >
              {NAV_LINKS.map(({ to, label }) => (
                <Link
                  key={to}
                  to={to}
                  onClick={() => setMobileOpen(false)}
                  className="px-3 py-2.5 rounded-lg text-sm font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-raised)] transition-colors"
                >
                  {label}
                </Link>
              ))}
              <div className="border-t border-[var(--border)] mt-2 pt-3 flex flex-col gap-2">
                <Link to="/login" onClick={() => setMobileOpen(false)}>
                  <Button variant="secondary" size="md" className="w-full justify-center">Sign In</Button>
                </Link>
                <Link to="/signup" onClick={() => setMobileOpen(false)}>
                  <Button variant="cta" size="md" className="w-full justify-center">Get Started</Button>
                </Link>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      {/* Page content */}
      <main className="flex-1">{children}</main>

      {/* Footer */}
      <footer className="border-t border-[var(--border)] bg-[var(--bg-subtle)]">
        <div className="max-w-7xl mx-auto px-5 pt-16 pb-10">

          {/* Top row: brand + columns */}
          <div className="grid grid-cols-2 md:grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-10 md:gap-8 mb-14">

            {/* Brand */}
            <div className="col-span-2 md:col-span-1 space-y-4 max-w-xs">
              <Link to="/" className="inline-block font-display font-bold text-base text-[var(--text-primary)] tracking-tight">
                AlpenMesh <span className="text-[var(--accent)]">Compute</span>
              </Link>
              <p className="text-sm text-[var(--text-muted)] leading-relaxed">
                A distributed GPU network built for AI workloads. Contribute compute, earn ALPEN, and track everything from one dashboard.
              </p>
              {/* Network status */}
              <div className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--success)] opacity-60" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-[var(--success)]" />
                </span>
                <span className="text-xs font-medium text-[var(--text-muted)]">Network operational</span>
              </div>
              {/* Social icons */}
              <div className="flex items-center gap-3 pt-1">
                {[
                  {
                    href: 'https://twitter.com/alpenmesh',
                    label: 'X / Twitter',
                    icon: (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.73-8.835L1.254 2.25H8.08l4.253 5.622L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z" />
                      </svg>
                    ),
                  },
                  {
                    href: 'https://github.com/alpenmesh',
                    label: 'GitHub',
                    icon: (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                        <path d="M12 2C6.477 2 2 6.477 2 12c0 4.418 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.009-.868-.013-1.703-2.782.604-3.369-1.34-3.369-1.34-.454-1.155-1.11-1.463-1.11-1.463-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0 1 12 6.836a9.59 9.59 0 0 1 2.504.337c1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.202 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.163 22 16.418 22 12c0-5.523-4.477-10-10-10z" />
                      </svg>
                    ),
                  },
                  {
                    href: 'https://discord.gg/alpenmesh',
                    label: 'Discord',
                    icon: <MessageSquare size={14} />,
                  },
                ].map(({ href, label, icon }) => (
                  <a
                    key={label}
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={label}
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text-faint)] hover:text-[var(--accent)] hover:border-[var(--accent-border)] transition-colors duration-150"
                  >
                    {icon}
                  </a>
                ))}
              </div>
            </div>

            {/* Link columns */}
            {FOOTER_COLS.map(({ heading, links }) => (
              <div key={heading} className="space-y-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-faint)]">
                  {heading}
                </p>
                <ul className="space-y-2.5">
                  {links.map(({ to, label }) => (
                    <li key={to}>
                      <Link
                        to={to}
                        className="text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors duration-150"
                      >
                        {label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          {/* Bottom strip */}
          <div className="border-t border-[var(--border)] pt-6 flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="text-xs text-[var(--text-faint)]">
              &copy; {new Date().getFullYear()} AlpenMesh Compute. All rights reserved.
            </p>
            <div className="flex items-center gap-5">
              {[
                { to: '/privacy', label: 'Privacy' },
                { to: '/terms', label: 'Terms' },
                { to: '/cookies', label: 'Cookies' },
              ].map(({ to, label }) => (
                <Link
                  key={to}
                  to={to}
                  className="text-xs text-[var(--text-faint)] hover:text-[var(--text-muted)] transition-colors duration-150"
                >
                  {label}
                </Link>
              ))}
            </div>
          </div>

        </div>
      </footer>
    </div>
  )
}
