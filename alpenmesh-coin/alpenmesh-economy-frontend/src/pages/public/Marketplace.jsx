import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { Cpu, Zap, Shield, Clock, DollarSign, Globe, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { blurIn, revealUp, scaleIn, slideLeft, popIn } from '@/lib/animations'

const TIERS = [
  {
    icon: Cpu,
    name: 'Standard compute',
    vram: '8 GB VRAM',
    tier: 'GPU Tier 1',
    price: '~0.08 ALPEN / hr',
    features: ['NVIDIA RTX class GPUs', 'Standard inference workloads', 'Batch job support'],
  },
  {
    icon: Zap,
    name: 'High performance',
    vram: '24 GB VRAM',
    tier: 'GPU Tier 2',
    price: '~0.24 ALPEN / hr',
    features: ['Large model inference', 'Higher throughput capacity', 'Priority queue placement'],
    highlight: true,
  },
  {
    icon: Shield,
    name: 'Multi-GPU node',
    vram: '80+ GB VRAM',
    tier: 'GPU Tier 3',
    price: '~0.80 ALPEN / hr',
    features: ['Multi-GPU configurations', 'Distributed job execution', 'High-demand workloads'],
  },
]

const BILLING_MODELS = [
  {
    icon: DollarSign,
    title: 'Pay per run',
    desc: 'Pay a flat ALPEN fee for each completed job execution. Straightforward and predictable for one-off tasks.',
  },
  {
    icon: Clock,
    title: 'Pay per hour',
    desc: 'Reserve GPU time billed by the hour for long-running or continuous workloads.',
  },
  {
    icon: Globe,
    title: 'Trustless settlement',
    desc: 'Settlement happens automatically on-chain after proof verification, with no manual step required.',
  },
]

export default function Marketplace() {
  return (
    <div>
      {/* Hero — blur dissolve with staggered children */}
      <section className="py-20 relative overflow-hidden">
        <div className="absolute inset-0 bg-grid opacity-30 pointer-events-none" />
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[var(--accent)]/40 to-transparent" aria-hidden />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] rounded-full bg-[var(--accent)] opacity-[0.04] blur-[100px] pointer-events-none" />
        <div className="max-w-7xl mx-auto px-5 relative z-10">
          <div className="max-w-2xl">
            <motion.p {...blurIn(0)} className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--accent)] mb-4">
              Marketplace
            </motion.p>
            <motion.h1 {...blurIn(0.1)} className="font-display font-bold text-[clamp(2rem,4vw,3.25rem)] leading-[1.08] text-[var(--text-primary)] mb-5">
              Rent distributed GPU compute from the network
            </motion.h1>
            <motion.p {...blurIn(0.2)} className="text-[var(--text-muted)] text-lg leading-relaxed mb-8">
              The AlpenMesh marketplace lets teams source GPU capacity from verified contributors across the network. Choose a compute tier, set your budget, and pay in ALPEN.
            </motion.p>
            <motion.div {...blurIn(0.3)} className="flex flex-wrap gap-3">
              <Link to="/signup">
                <Button variant="cta" size="xl">Join the network <ArrowRight size={16} /></Button>
              </Link>
              <Link to="/how-it-works">
                <Button variant="secondary" size="xl">How it works</Button>
              </Link>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Compute tiers — scale in */}
      <section className="py-16">
        <div className="max-w-7xl mx-auto px-5">
          <motion.div {...revealUp(0)} className="max-w-xl mb-12">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--text-faint)] mb-3">
              Compute tiers
            </p>
            <h2 className="font-display font-bold text-[clamp(1.75rem,3vw,2.5rem)] text-[var(--text-primary)] mb-3 leading-snug">
              Pick the right capacity for your workload
            </h2>
            <p className="text-[var(--text-muted)] text-sm leading-relaxed">
              Tiers are defined by VRAM and compute class. Pricing reflects network conditions and worker availability at the time of booking.
            </p>
          </motion.div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {TIERS.map(({ icon: Icon, name, vram, tier, price, features, highlight }, i) => (
              <motion.div key={name} {...scaleIn(i * 0.09)}>
                <div className={`p-7 rounded-[var(--radius-xl)] h-full border flex flex-col ${
                  highlight
                    ? 'border-[var(--accent-border)] bg-[var(--accent-dim)]'
                    : 'bg-[var(--surface)] border-[var(--border)]'
                }`}>
                  <div className="w-11 h-11 rounded-xl bg-[var(--surface-raised)] border border-[var(--border)] flex items-center justify-center mb-5">
                    <Icon size={20} className={highlight ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'} />
                  </div>
                  <h3 className="font-display font-bold text-xl text-[var(--text-primary)] mb-1">{name}</h3>
                  <p className="text-sm text-[var(--text-muted)] mb-3">{vram} · {tier}</p>
                  <p className="text-2xl font-display font-bold text-[var(--accent)] mb-5">{price}</p>
                  <ul className="space-y-2 flex-1">
                    {features.map(f => (
                      <li key={f} className="flex items-center gap-2.5 text-sm text-[var(--text-muted)]">
                        <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] shrink-0 opacity-70" />
                        {f}
                      </li>
                    ))}
                  </ul>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Billing models — slide in from left */}
      <section className="py-16 bg-[var(--bg-subtle)] border-t border-[var(--border)]">
        <div className="max-w-7xl mx-auto px-5">
          <motion.div {...revealUp(0)} className="max-w-xl mb-10">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--text-faint)] mb-3">
              Billing
            </p>
            <h2 className="font-display font-bold text-[clamp(1.75rem,3vw,2.5rem)] text-[var(--text-primary)] mb-3 leading-snug">
              Flexible payment models
            </h2>
            <p className="text-[var(--text-muted)] text-sm leading-relaxed">
              Choose how you pay based on your workload. All billing is settled in ALPEN with automatic on-chain verification.
            </p>
          </motion.div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            {BILLING_MODELS.map(({ icon: Icon, title, desc }, i) => (
              <motion.div key={title} {...slideLeft(i * 0.08)}>
                <div className="flex gap-4 p-6 bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-xl)] h-full">
                  <div className="w-10 h-10 shrink-0 rounded-xl bg-[var(--accent-dim)] border border-[var(--accent-border)] flex items-center justify-center mt-0.5">
                    <Icon size={18} className="text-[var(--accent)]" />
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
      <section className="py-20 border-t border-[var(--border)]">
        <div className="max-w-3xl mx-auto px-5 text-center">
          <motion.div {...popIn(0)}>
            <h2 className="font-display font-bold text-4xl text-[var(--text-primary)] mb-4">
              Start contributing today
            </h2>
            <p className="text-[var(--text-muted)] text-lg mb-8 leading-relaxed">
              Connect your GPU worker, link your wallet, and become part of the network that powers the marketplace.
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
