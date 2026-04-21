import { Sun, Moon } from 'lucide-react'
import { useTheme } from '@/context/ThemeContext'

export function ThemeToggle({ size = 'md' }) {
  const { theme, toggle } = useTheme()
  const isDark = theme === 'dark'
  const dim = size === 'sm' ? 'w-8 h-8' : 'w-9 h-9'
  const iconSize = size === 'sm' ? 15 : 18

  return (
    <button
      onClick={toggle}
      aria-label="Toggle theme"
      className={`${dim} flex items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-raised)] border border-transparent hover:border-[var(--border)] transition-all duration-200`}
    >
      {isDark ? <Sun size={iconSize} /> : <Moon size={iconSize} />}
    </button>
  )
}
