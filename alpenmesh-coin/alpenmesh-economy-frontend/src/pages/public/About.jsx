import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { Globe, Shield, TrendingUp, Cpu, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { blurIn, revealUp, scaleIn, slideLeft, slideRight, popIn, cascadeFade } from '@/lib/animations'

const PRINCIPLES = [
  {
    icon: Globe,
    title: 'Distributed by design',
    desc: 'Workers run independently across the network. There is no central chokepoint — contributors plug in, contribute, and earn without depending on any single provider or gateway.',
  },
  {
    icon: Shield,
    title: 'Transparent rewards',
    desc: 'Every inference batch produces a proof record. Rewards are calculated from verifiable work and visible in your dashboard, so you always know where your earnings come from.',
  },
  {
    icon: TrendingUp,
    title: 'Verifiable contribution',
    desc: 'Workers submit signed proof batches that record inference counts and time windows. This builds an auditable history of compute contribution that both contributors and the network can trust.',
  },
  {
    icon: Cpu,
    title: 'Built for GPU workloads',
    desc: 'The worker and reward systems are designed around GPU inference, not generic compute. Rewards reflect real work done, tied directly to the capacity your hardware provides.',
  },
]

const NETWORK_TAGS = [
  'Distributed GPU network',
  'AI inference workloads',
  'ALPEN reward token',
  'Solana-compatible wallets',
  'Proof-based verification',
  'Worker contribution tracking',
  'On-chain settlement',
  'Permissionless participation',
  'Pay-per-compute billing',
]

const STATS = [
  { label: 'Reward token', val: 'ALPEN' },
  { label: 'Wallet network', val: 'Solana-compatible' },
  { label: 'Worker model', val: 'GPU inference nodes' },
  { label: 'Proof system', val: 'Signed batch records' },
  { label: 'Contributor access', val: 'Permissionless' },
  { label: 'Settlement', val: 'On-chain, automatic' },
]

export default function About() {
  return (
    <div>
      {/* Hero — blur dissolve, staggered lines */}
      <section className="py-24 relative overflow-hidden">
        <div className="absolute inset-0 bg-grid opacity-30 pointer-events-none" />
        <div className="absolute top-0 right-0 w-[500px] h-[500px] rounded-full bg-[var(--accent)] opacity-[0.04] blur-[100px] pointer-events-none" />
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[var(--accent)]/40 to-transparent" aria-hidden />
        <div className="max-w-7xl mx-auto px-5 relative z-10">
          <div className="max-w-3xl">
            <motion.p {...blurIn(0)} className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--accent)] mb-5">
              About AlpenMesh
            </motion.p>
            <motion.h1 {...blurIn(0.1)} className="font-display font-bold text-[clamp(2.25rem,5vw,3.75rem)] leading-[1.06] text-[var(--text-primary)] mb-6">
              Infrastructure for the next generation of distributed AI compute
            </motion.h1>
            <motion.p {...blurIn(0.22)} className="text-lg text-[var(--text-muted)] leading-relaxed max-w-2xl">
              AlpenMesh is a GPU compute network built around contributors. Anyone with a capable machine can join, connect their worker, and earn ALPEN rewards for the inference work their hardware completes.
            </motion.p>
          </div>
        </div>
      </section>

      {/* Mission — left text slides in, right stat boxes scale in */}
      <section className="py-16 bg-[var(--bg-subtle)] border-t border-[var(--border)]">
        <div className="max-w-5xl mx-auto px-5">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <motion.div {...slideLeft(0)}>
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--text-faint)] mb-4">
                Our mission
              </p>
              <h2 className="font-display font-bold text-[clamp(1.75rem,3vw,2.5rem)] text-[var(--text-primary)] mb-5 leading-snug">
                Open access to GPU compute
              </h2>
              <p className="text-[var(--text-muted)] leading-relaxed mb-4">
                Centralised cloud compute is expensive and concentrated in a small number of providers. AlpenMesh offers an alternative: a permissionless network where anyone with a GPU can contribute capacity and earn rewards for real, verifiable work.
              </p>
              <p className="text-[var(--text-muted)] leading-relaxed mb-4">
                Contributors run workers on hardware they already own. Those workers handle AI inference jobs routed by the network and submit signed proof batches that record what was done. Rewards follow directly from that proof.
              </p>
              <p className="text-[var(--text-muted)] leading-relaxed">
                The goal is a marketplace where AI teams can source distributed GPU capacity and pay in ALPEN, with contributors on the other side earning from the capacity they provide.
              </p>
            </motion.div>
            <div className="grid grid-cols-2 gap-4">
              {STATS.map(({ label, val }, i) => (
                <motion.div key={label} {...slideRight(0.06 + i * 0.06)}>
                  <div className="p-4 bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-md)]">
                    <p className="text-xs text-[var(--text-faint)] mb-1">{label}</p>
                    <p className="font-display font-bold text-sm text-[var(--text-primary)]">{val}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Principles — scale in from slightly small */}
      <section className="py-16 border-t border-[var(--border)]">
        <div className="max-w-7xl mx-auto px-5">
          <motion.div {...revealUp(0)} className="max-w-xl mb-12">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--text-faint)] mb-3">
              What we stand for
            </p>
            <h2 className="font-display font-bold text-[clamp(1.75rem,3vw,2.5rem)] text-[var(--text-primary)] leading-snug">
              Built on a few clear principles
            </h2>
          </motion.div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {PRINCIPLES.map(({ icon: Icon, title, desc }, i) => (
              <motion.div key={title} {...scaleIn(i * 0.08)}>
                <div className="flex gap-4 p-6 bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-xl)] h-full hover:border-[var(--accent-border)] transition-colors duration-200">
                  <div className="w-11 h-11 shrink-0 rounded-xl bg-[var(--accent-dim)] border border-[var(--accent-border)] flex items-center justify-center mt-0.5">
                    <Icon size={20} className="text-[var(--accent)]" />
                  </div>
                  <div>
                    <h3 className="font-display font-bold text-lg text-[var(--text-primary)] mb-2">{title}</h3>
                    <p className="text-sm text-[var(--text-muted)] leading-relaxed">{desc}</p>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Network scope — each tag cascades in individually */}
      <section className="py-16 bg-[var(--bg-subtle)] border-t border-[var(--border)]">
        <div className="max-w-5xl mx-auto px-5 text-center">
          <motion.div {...revealUp(0)} className="mb-10">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--text-faint)] mb-3">
              The network in scope
            </p>
            <h2 className="font-display font-bold text-[clamp(1.75rem,3vw,2.5rem)] text-[var(--text-primary)] mb-3 leading-snug">
              What AlpenMesh covers
            </h2>
            <p className="text-[var(--text-muted)] max-w-lg mx-auto text-sm leading-relaxed">
              From contributor onboarding to job execution and settlement, the network is designed to handle the full lifecycle of distributed GPU compute.
            </p>
          </motion.div>
          <div className="flex flex-wrap justify-center gap-2.5">
            {NETWORK_TAGS.map((tag, i) => (
              <motion.span
                key={tag}
                {...cascadeFade(0.05 + i * 0.05)}
                className="px-3.5 py-1.5 bg-[var(--surface)] border border-[var(--border)] rounded-full text-xs text-[var(--text-muted)] font-medium"
              >
                {tag}
              </motion.span>
            ))}
          </div>
        </div>
      </section>

      {/* CTA — spring pop */}
      <section className="py-20 border-t border-[var(--border)]">
        <div className="max-w-3xl mx-auto px-5 text-center">
          <motion.div {...popIn(0)}>
            <h2 className="font-display font-bold text-4xl text-[var(--text-primary)] mb-4">
              Become part of the network
            </h2>
            <p className="text-[var(--text-muted)] text-lg mb-8 leading-relaxed">
              Create a free account, connect your GPU worker, and start earning ALPEN for the compute you contribute.
            </p>
            <div className="flex flex-wrap gap-3 justify-center">
              <Link to="/signup">
                <Button variant="cta" size="xl">Get started <ArrowRight size={16} /></Button>
              </Link>
              <Link to="/how-it-works">
                <Button variant="secondary" size="xl">How it works</Button>
              </Link>
            </div>
          </motion.div>
        </div>
      </section>
    </div>
  )
}
