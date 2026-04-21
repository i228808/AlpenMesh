import { motion } from 'framer-motion'
import { Loader2 } from 'lucide-react'

const variants = {
  primary: 'bg-[var(--accent)] text-[#090B0F] font-semibold hover:bg-[var(--accent-hover)] shadow-sm',
  /** Primary CTA: warm off-white hover (landing / marketing) */
  cta: 'bg-[var(--accent)] text-[#090B0F] font-semibold shadow-sm transition-colors duration-200 hover:bg-[#F0EFE9] hover:text-[#090B0F] hover:shadow-md',
  secondary: 'bg-[var(--surface-raised)] text-[var(--text-primary)] border border-[var(--border)] hover:border-[var(--accent)] hover:text-[var(--accent)]',
  ghost: 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-raised)]',
  danger: 'bg-[var(--error-dim)] text-[var(--error)] border border-[var(--error-dim)] hover:bg-[var(--error)] hover:text-white',
  outline: 'border border-[var(--border)] text-[var(--text-primary)] hover:border-[var(--accent)] hover:text-[var(--accent)] bg-transparent',
}

const sizes = {
  sm: 'px-3 py-1.5 text-sm rounded-[var(--radius-sm)]',
  md: 'px-4 py-2 text-sm rounded-[var(--radius-md)]',
  lg: 'px-6 py-3 text-base rounded-[var(--radius-md)]',
  xl: 'px-8 py-4 text-base rounded-[var(--radius-lg)]',
}

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  className = '',
  onClick,
  type = 'button',
  ...rest
}) {
  const base = 'inline-flex items-center gap-2 font-medium transition-all duration-200 cursor-pointer select-none disabled:opacity-50 disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]'

  return (
    <motion.button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className={`${base} ${variants[variant]} ${sizes[size]} ${className}`}
      whileTap={{ scale: disabled || loading ? 1 : 0.97 }}
      {...rest}
    >
      {loading && <Loader2 size={14} className="animate-spin shrink-0" />}
      {children}
    </motion.button>
  )
}
