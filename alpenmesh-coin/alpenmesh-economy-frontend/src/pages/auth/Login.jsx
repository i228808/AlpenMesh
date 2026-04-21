import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Mail, Lock, ArrowRight, ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Alert } from '@/components/ui/Alert'
import { useAuth } from '@/hooks/useAuth'

const PILLARS = [
  { label: 'Transparent', detail: 'Every proof batch and reward is visible in your dashboard.' },
  { label: 'Verifiable', detail: 'Contributions are signed and recorded, not approximated.' },
  { label: 'Yours', detail: 'Your hardware, your wallet, your earnings — fully in your control.' },
]

const fieldAnim = (i) => ({
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.4, delay: 0.35 + i * 0.08, ease: [0.22, 1, 0.36, 1] },
})

export default function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({ email: '', password: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleChange = (e) => setForm(f => ({ ...f, [e.target.name]: e.target.value }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    const result = await login(form)
    setLoading(false)
    if (result.ok) {
      navigate('/app/dashboard')
    } else {
      setError(result.error)
    }
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-[52%_48%]">

      {/* ── Left: brand panel ── */}
      <motion.div
        initial={{ opacity: 0, x: -24 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
        className="hidden lg:flex flex-col relative overflow-hidden bg-[var(--bg)] border-r border-[var(--border)]"
      >
        {/* Atmosphere */}
        <div className="absolute inset-0 bg-grid opacity-[0.18] pointer-events-none" />
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage:
              'radial-gradient(ellipse 70% 60% at 110% -10%, rgba(232,168,68,0.18) 0%, transparent 55%), radial-gradient(ellipse 50% 40% at -10% 110%, rgba(232,168,68,0.08) 0%, transparent 50%)',
          }}
        />
        <div className="absolute top-0 right-0 w-px h-full bg-gradient-to-b from-transparent via-[var(--accent)]/30 to-transparent" />

        <div className="relative flex flex-col h-full px-12 xl:px-16 py-12">
          {/* Wordmark */}
          <Link to="/" className="inline-flex items-center gap-2 group w-fit">
            <span className="font-display font-bold text-lg text-[var(--text-primary)] tracking-tight group-hover:text-[var(--accent)] transition-colors duration-200">
              AlpenMesh <span className="text-[var(--accent)]">Compute</span>
            </span>
          </Link>

          {/* Central statement */}
          <div className="flex-1 flex flex-col justify-center">
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5, delay: 0.2 }}
              className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[var(--accent)] mb-6"
            >
              Contributor network
            </motion.p>
            <motion.h2
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.28, ease: [0.22, 1, 0.36, 1] }}
              className="font-display font-bold text-[clamp(2.75rem,4.5vw,4rem)] leading-[1.08] text-[var(--text-primary)] mb-10"
            >
              Your hardware.<br />
              Your proof.<br />
              <span className="text-[var(--accent)]">Your rewards.</span>
            </motion.h2>

            <div className="space-y-6">
              {PILLARS.map(({ label, detail }, i) => (
                <motion.div
                  key={label}
                  initial={{ opacity: 0, x: -16 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.45, delay: 0.42 + i * 0.1, ease: [0.22, 1, 0.36, 1] }}
                >
                  <div className="flex items-center gap-3 mb-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] shrink-0 opacity-90" />
                    <p className="text-base font-semibold text-[var(--text-primary)]">{label}</p>
                  </div>
                  <p className="text-sm text-[var(--text-muted)] leading-relaxed pl-[18px]">{detail}</p>
                </motion.div>
              ))}
            </div>
          </div>

        </div>
      </motion.div>

      {/* ── Right: form panel ── */}
      <motion.div
        initial={{ opacity: 0, x: 24 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
        className="flex flex-col items-center justify-center min-h-screen lg:min-h-0 bg-[var(--bg-subtle)] px-6 py-12"
      >
        <div className="w-full max-w-[360px]">

          {/* Mobile wordmark */}
          <div className="lg:hidden text-center mb-10">
            <Link to="/" className="font-display font-bold text-xl text-[var(--text-primary)]">
              AlpenMesh <span className="text-[var(--accent)]">Compute</span>
            </Link>
          </div>

          {/* Heading */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="mb-8"
          >
            <h1 className="font-display font-bold text-[2rem] leading-tight text-[var(--text-primary)] mb-2">
              Welcome back
            </h1>
            <p className="text-sm text-[var(--text-muted)]">
              Sign in to your contributor console
            </p>
          </motion.div>

          {/* Error */}
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-6"
            >
              <Alert variant="error" message={error} onDismiss={() => setError('')} />
            </motion.div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <motion.div {...fieldAnim(0)}>
              <Input
                label="Email address"
                name="email"
                type="email"
                placeholder="you@example.com"
                value={form.email}
                onChange={handleChange}
                icon={Mail}
                required
                autoComplete="email"
              />
            </motion.div>

            <motion.div {...fieldAnim(1)}>
              <Input
                label="Password"
                name="password"
                type="password"
                placeholder="Your password"
                value={form.password}
                onChange={handleChange}
                icon={Lock}
                required
                autoComplete="current-password"
              />
            </motion.div>

            <motion.div {...fieldAnim(2)} className="pt-1">
              <Button
                type="submit"
                loading={loading}
                size="lg"
                className="w-full justify-center"
              >
                Sign in <ArrowRight size={16} />
              </Button>
            </motion.div>
          </form>

          {/* Footer links */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4, delay: 0.7 }}
            className="mt-8 space-y-4"
          >
            <p className="text-center text-sm text-[var(--text-muted)]">
              No account yet?{' '}
              <Link to="/signup" className="text-[var(--accent)] hover:underline font-medium">
                Sign up free
              </Link>
            </p>
            <div className="flex justify-center">
              <Link
                to="/"
                className="inline-flex items-center gap-1.5 text-xs text-[var(--text-faint)] hover:text-[var(--text-muted)] transition-colors"
              >
                <ArrowLeft size={12} />
                Back to AlpenMesh Compute
              </Link>
            </div>
          </motion.div>
        </div>
      </motion.div>

    </div>
  )
}
