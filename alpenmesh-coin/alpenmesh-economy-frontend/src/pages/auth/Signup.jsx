import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Mail, Lock, User, ArrowRight, ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Alert } from '@/components/ui/Alert'
import { useAuth } from '@/hooks/useAuth'

const STEPS = [
  { n: '01', label: 'Create your account', detail: 'Sign up in under a minute. No credit card required.' },
  { n: '02', label: 'Connect a worker', detail: 'Register your GPU worker and claim it to your profile.' },
  { n: '03', label: 'Earn ALPEN', detail: 'Track proofs and rewards from your contributor dashboard.' },
]

const fieldAnim = (i) => ({
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.4, delay: 0.35 + i * 0.08, ease: [0.22, 1, 0.36, 1] },
})

export default function Signup() {
  const { signup } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({ email: '', password: '', display_name: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleChange = (e) => setForm(f => ({ ...f, [e.target.name]: e.target.value }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (form.password.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }
    setLoading(true)
    const result = await signup(form)
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
              Join the network
            </motion.p>
            <motion.h2
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.28, ease: [0.22, 1, 0.36, 1] }}
              className="font-display font-bold text-[clamp(2.75rem,4.5vw,4rem)] leading-[1.08] text-[var(--text-primary)] mb-10"
            >
              Contribute compute.<br />
              Earn{' '}
              <span className="text-[var(--accent)]">ALPEN.</span>
            </motion.h2>

            {/* Numbered steps */}
            <div className="space-y-6">
              {STEPS.map(({ n, label, detail }, i) => (
                <motion.div
                  key={n}
                  initial={{ opacity: 0, x: -16 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.45, delay: 0.42 + i * 0.1, ease: [0.22, 1, 0.36, 1] }}
                >
                  <div className="flex items-center gap-4 mb-1">
                    <span className="font-mono text-[11px] font-bold tracking-widest text-[var(--accent)]/70 shrink-0 w-6">
                      {n}
                    </span>
                    <p className="text-base font-semibold text-[var(--text-primary)]">{label}</p>
                  </div>
                  <p className="text-sm text-[var(--text-muted)] leading-relaxed pl-10">{detail}</p>
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
              Create your account
            </h1>
            <p className="text-sm text-[var(--text-muted)]">
              Free to join. Start earning from your first worker.
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
                label="Display name"
                name="display_name"
                type="text"
                placeholder="Your name or handle"
                value={form.display_name}
                onChange={handleChange}
                icon={User}
                required
              />
            </motion.div>

            <motion.div {...fieldAnim(1)}>
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

            <motion.div {...fieldAnim(2)}>
              <Input
                label="Password"
                name="password"
                type="password"
                placeholder="Min. 6 characters"
                value={form.password}
                onChange={handleChange}
                icon={Lock}
                required
                autoComplete="new-password"
              />
            </motion.div>

            <motion.div {...fieldAnim(3)} className="pt-1">
              <Button
                type="submit"
                loading={loading}
                size="lg"
                className="w-full justify-center"
              >
                Create account <ArrowRight size={16} />
              </Button>
            </motion.div>
          </form>

          {/* Footer */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4, delay: 0.75 }}
            className="mt-8 space-y-4"
          >
            <p className="text-center text-sm text-[var(--text-muted)]">
              Already have an account?{' '}
              <Link to="/login" className="text-[var(--accent)] hover:underline font-medium">
                Sign in
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
