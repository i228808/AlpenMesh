import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { Shield, Cpu, Wallet, TrendingUp, Globe, Container, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { blurIn, revealUp, slideLeft, popIn } from '@/lib/animations'

const STEPS = [
  {
    n: '01', icon: Shield, title: 'Create your account',
    desc: 'Sign up with your email and display name. Your account is ready immediately with no wallet required at this stage.',
    details: [
      'Email and password sign up',
      'Session-based authentication with server-side token rotation',
      'Password hashed securely on the backend',
    ],
  },
  {
    n: '02', icon: Cpu, title: 'Register and connect a worker',
    desc: 'Register your local AlpenMesh worker using its unique worker ID and secret, then claim it to your account so contributions are credited to you.',
    details: [
      'Worker registration stores a hashed secret in the network registry',
      'Claiming links the worker to your account',
      'Add a human-readable label to stay organised',
      'Connect as many workers as you have machines',
    ],
  },
  {
    n: '03', icon: Wallet, title: 'Link your payout wallet',
    desc: 'Attach a wallet address to receive ALPEN rewards. You can set one wallet at the account level or bind different addresses per worker.',
    details: [
      'Account-level wallet for simple payout routing',
      'Per-worker wallet override for granular control',
      'Update or change your address any time',
    ],
  },
  {
    n: '04', icon: TrendingUp, title: 'Track proofs and earnings',
    desc: 'Your worker submits inference proof batches to the network automatically. Follow each batch and your accumulated ALPEN from the dashboard.',
    details: [
      'Proof batches show window time, inference count, and reward',
      'Status transitions from queued through submitted to confirmed',
      'Pending and settled reward breakdown per worker',
      'Network-wide and per-worker earnings summary',
    ],
  },
]

const EXPANDING_STEPS = [
  {
    n: '05', icon: Globe, title: 'Submit your own compute jobs',
    desc: 'When the marketplace opens, you will be able to submit AI workloads to the network and pay in ALPEN for distributed GPU compute.',
  },
  {
    n: '06', icon: Container, title: 'Run containerised workloads',
    desc: 'Define Docker-based jobs with custom entrypoints, VRAM requirements, and runtime limits. Settlement happens automatically on completion.',
  },
]

export default function HowItWorks() {
  return (
    <div>
      {/* Hero — blur dissolve */}
      <section className="py-20 relative overflow-hidden">
        <div className="absolute inset-0 bg-grid opacity-30 pointer-events-none" />
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[var(--accent)]/40 to-transparent" aria-hidden />
        <div className="max-w-7xl mx-auto px-5 relative z-10">
          <div className="max-w-2xl">
            <motion.p {...blurIn(0)} className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--accent)] mb-4">
              How it works
            </motion.p>
            <motion.h1 {...blurIn(0.1)} className="font-display font-bold text-[clamp(2rem,4vw,3.25rem)] leading-[1.08] text-[var(--text-primary)] mb-5">
              From account to earnings, step by step
            </motion.h1>
            <motion.p {...blurIn(0.2)} className="text-[var(--text-muted)] text-lg leading-relaxed">
              A clear walkthrough of the AlpenMesh Compute contributor flow, from signing up to tracking your proof history and rewards.
            </motion.p>
          </div>
        </div>
      </section>

      {/* Steps — slide in from left, staggered */}
      <section className="py-12 pb-20">
        <div className="max-w-4xl mx-auto px-5">
          <div className="relative flex flex-col gap-0">
            <div className="absolute left-6 top-12 bottom-12 w-px bg-[var(--border)] hidden sm:block" />
            {STEPS.map(({ n, icon: Icon, title, desc, details }, i) => (
              <motion.div key={n} {...slideLeft(i * 0.1)} className="flex gap-6 pb-12 last:pb-0">
                <div className="shrink-0 hidden sm:flex flex-col items-center gap-2">
                  <div className="w-12 h-12 rounded-full bg-[var(--accent-dim)] border border-[var(--accent-border)] flex items-center justify-center z-10 relative">
                    <Icon size={20} className="text-[var(--accent)]" />
                  </div>
                </div>
                <div className="flex-1 pb-4">
                  <span className="text-[11px] font-bold font-mono text-[var(--text-faint)] tracking-widest">STEP {n}</span>
                  <h3 className="font-display font-bold text-xl text-[var(--text-primary)] mt-1.5 mb-2">{title}</h3>
                  <p className="text-[var(--text-muted)] mb-4 leading-relaxed">{desc}</p>
                  <ul className="space-y-2">
                    {details.map(d => (
                      <li key={d} className="flex items-start gap-2.5 text-sm text-[var(--text-muted)]">
                        <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] shrink-0 mt-1.5 opacity-80" />
                        {d}
                      </li>
                    ))}
                  </ul>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Expanding — revealUp heading, slideLeft items */}
      <section className="py-16 bg-[var(--bg-subtle)] border-t border-[var(--border)]">
        <div className="max-w-4xl mx-auto px-5">
          <motion.div {...revealUp(0)} className="mb-10">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--text-faint)] mb-3">
              Expanding the network
            </p>
            <h2 className="font-display font-bold text-2xl text-[var(--text-primary)] mb-2">
              Where the flow goes next
            </h2>
            <p className="text-sm text-[var(--text-muted)] leading-relaxed max-w-lg">
              These steps extend the contributor flow into buyer-side compute. The infrastructure running today is built to support them.
            </p>
          </motion.div>
          <div className="flex flex-col gap-4">
            {EXPANDING_STEPS.map(({ n, icon: Icon, title, desc }, i) => (
              <motion.div key={n} {...slideLeft(i * 0.1)}>
                <div className="flex gap-5 p-6 bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-xl)]">
                  <div className="w-11 h-11 rounded-xl bg-[var(--surface-raised)] border border-[var(--border)] flex items-center justify-center shrink-0">
                    <Icon size={18} className="text-[var(--text-muted)]" />
                  </div>
                  <div>
                    <div className="flex items-center gap-3 mb-1.5">
                      <span className="text-[11px] font-bold font-mono text-[var(--text-faint)] tracking-widest">STEP {n}</span>
                    </div>
                    <h3 className="font-display font-semibold text-[var(--text-primary)] mb-1">{title}</h3>
                    <p className="text-sm text-[var(--text-muted)] leading-relaxed">{desc}</p>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA — spring pop */}
      <section className="py-20 border-t border-[var(--border)]">
        <div className="max-w-3xl mx-auto px-5 text-center">
          <motion.div {...popIn(0)}>
            <h2 className="font-display font-bold text-4xl text-[var(--text-primary)] mb-4">Ready to get started?</h2>
            <p className="text-[var(--text-muted)] text-lg mb-8 leading-relaxed">
              Create your account, connect your worker, and start earning today.
            </p>
            <div className="flex flex-wrap gap-3 justify-center">
              <Link to="/signup">
                <Button variant="cta" size="xl">Create free account <ArrowRight size={16} /></Button>
              </Link>
              <Link to="/features">
                <Button variant="secondary" size="xl">View all features</Button>
              </Link>
            </div>
          </motion.div>
        </div>
      </section>
    </div>
  )
}
