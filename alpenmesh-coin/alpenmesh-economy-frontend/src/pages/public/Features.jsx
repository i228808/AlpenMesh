import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { Cpu, Wallet, FileCheck, TrendingUp, Globe, Zap, Shield, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { blurIn, revealUp, scaleIn, slideLeft, popIn } from '@/lib/animations'

const FEATURES = [
  {
    icon: Cpu,
    title: 'Worker onboarding',
    desc: 'Register your GPU worker with a unique ID and secret. Once registered, claim it to your account and label it however makes sense for your setup. You can connect as many workers as you have machines.',
    bullets: [
      'Worker ID and secret registration',
      'Claim workers to your account',
      'Custom label per worker',
      'Multi-worker support',
    ],
  },
  {
    icon: Wallet,
    title: 'Wallet linking',
    desc: 'Connect a payout wallet at the account level for simple reward routing, or bind a different wallet per worker when you want earnings split by machine.',
    bullets: [
      'Account-level wallet address',
      'Per-worker payout override',
      'Update wallet address any time',
      'Full address stays under your control',
    ],
  },
  {
    icon: FileCheck,
    title: 'Proof history',
    desc: 'Every batch of inference work generates a signed proof record. You can follow each proof through its lifecycle and see the chain signature metadata attached to it.',
    bullets: [
      'Proof batch records',
      'Status lifecycle from queued to confirmed',
      'Chain signature display',
      'Latest-first history view',
    ],
  },
  {
    icon: TrendingUp,
    title: 'Earnings dashboard',
    desc: 'Your dashboard gives you a live read on total rewards, what is still pending, and what has already been submitted across every worker on your account.',
    bullets: [
      'Network-wide earnings summary',
      'Per-worker breakdown',
      'Pending vs submitted split',
      'Inference count tracking',
    ],
  },
]

const UPCOMING_FEATURES = [
  {
    icon: Globe,
    title: 'Compute marketplace',
    desc: 'Browse and rent distributed GPU capacity from verified AlpenMesh workers. Filter by VRAM tier, uptime rating, and compute class to find the right fit for your workload.',
  },
  {
    icon: Zap,
    title: 'Containerised job submission',
    desc: 'Submit Docker-based workloads with custom entrypoints, GPU requirements, and output destinations. Set a budget cap and let the network handle the rest.',
  },
  {
    icon: Shield,
    title: 'Real-time job monitoring',
    desc: 'Follow your submitted jobs from queued through running, completed, and settled. Automatic failover and reassignment keep things moving without manual intervention.',
  },
  {
    icon: FileCheck,
    title: 'Trustless proof verification',
    desc: 'An extended verification layer that anchors execution results on-chain and checks them independently of the worker, giving buyers and contributors the same ground truth.',
  },
]

export default function Features() {
  return (
    <div>
      {/* Hero — blur dissolve, no translate */}
      <section className="py-20 relative overflow-hidden">
        <div className="absolute inset-0 bg-grid opacity-30 pointer-events-none" />
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[var(--accent)]/40 to-transparent" aria-hidden />
        <div className="max-w-7xl mx-auto px-5 relative z-10">
          <div className="max-w-2xl">
            <motion.p {...blurIn(0)} className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--accent)] mb-4">
              Platform features
            </motion.p>
            <motion.h1 {...blurIn(0.1)} className="font-display font-bold text-[clamp(2rem,4vw,3.25rem)] leading-[1.08] text-[var(--text-primary)] mb-5">
              Everything you need to contribute and get paid
            </motion.h1>
            <motion.p {...blurIn(0.2)} className="text-[var(--text-muted)] text-lg leading-relaxed max-w-xl">
              Register your workers, link your wallet, and track your earnings and proof history from one place. All of it is live and backed by real data.
            </motion.p>
          </div>
        </div>
      </section>

      {/* Feature cards — scale in on scroll */}
      <section className="pb-24">
        <div className="max-w-7xl mx-auto px-5">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {FEATURES.map(({ icon: Icon, title, desc, bullets }, i) => (
              <motion.div key={title} {...scaleIn(i * 0.08)}>
                <div className="group bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-xl)] p-7 h-full hover:border-[var(--accent-border)] hover:shadow-[0_20px_48px_-28px_rgba(0,0,0,0.4)] transition-[border-color,box-shadow] duration-300">
                  <div className="flex items-start gap-4 mb-5">
                    <div className="w-11 h-11 shrink-0 rounded-xl bg-[var(--accent-dim)] border border-[var(--accent-border)] flex items-center justify-center">
                      <Icon size={20} className="text-[var(--accent)]" />
                    </div>
                    <h3 className="font-display font-bold text-xl text-[var(--text-primary)] mt-1.5 leading-snug">
                      {title}
                    </h3>
                  </div>
                  <p className="text-sm text-[var(--text-muted)] leading-relaxed mb-5">{desc}</p>
                  <ul className="space-y-2">
                    {bullets.map(b => (
                      <li key={b} className="flex items-center gap-2.5 text-sm text-[var(--text-muted)]">
                        <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] shrink-0 opacity-80" />
                        {b}
                      </li>
                    ))}
                  </ul>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Upcoming — slide in from left */}
      <section className="py-20 bg-[var(--bg-subtle)] border-t border-[var(--border)]">
        <div className="max-w-7xl mx-auto px-5">
          <motion.div {...revealUp(0)} className="max-w-xl mb-12">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--text-faint)] mb-3">
              What is coming next
            </p>
            <h2 className="font-display font-bold text-[clamp(1.75rem,3vw,2.5rem)] text-[var(--text-primary)] mb-3 leading-snug">
              Expanding the network
            </h2>
            <p className="text-[var(--text-muted)] text-base leading-relaxed">
              These capabilities are in active development. Nothing here is vaporware — they follow directly from the infrastructure already running today.
            </p>
          </motion.div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {UPCOMING_FEATURES.map(({ icon: Icon, title, desc }, i) => (
              <motion.div key={title} {...slideLeft(i * 0.07)}>
                <div className="flex gap-4 bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-xl)] p-6 h-full">
                  <div className="w-10 h-10 shrink-0 rounded-xl bg-[var(--surface-raised)] border border-[var(--border)] flex items-center justify-center mt-0.5">
                    <Icon size={18} className="text-[var(--text-muted)]" />
                  </div>
                  <div>
                    <h3 className="font-display font-semibold text-[var(--text-primary)] mb-1.5">{title}</h3>
                    <p className="text-sm text-[var(--text-muted)] leading-relaxed">{desc}</p>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA — spring pop */}
      <section className="py-20">
        <div className="max-w-3xl mx-auto px-5 text-center">
          <motion.div {...popIn(0)}>
            <h2 className="font-display font-bold text-4xl text-[var(--text-primary)] mb-4">
              Ready to get started?
            </h2>
            <p className="text-[var(--text-muted)] text-lg mb-8 leading-relaxed">
              Create a free account, connect your first worker, and start earning ALPEN today.
            </p>
            <div className="flex flex-wrap gap-3 justify-center">
              <Link to="/signup">
                <Button variant="cta" size="xl">Create free account <ArrowRight size={16} /></Button>
              </Link>
              <Link to="/how-it-works">
                <Button variant="secondary" size="xl">See how it works</Button>
              </Link>
            </div>
          </motion.div>
        </div>
      </section>
    </div>
  )
}
