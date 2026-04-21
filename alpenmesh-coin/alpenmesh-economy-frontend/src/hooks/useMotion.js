import { useReducedMotion } from 'framer-motion'

/**
 * Returns motion props that respect the user's reduced-motion preference.
 * Pass as spread props to motion.* elements.
 */
export function useMotionSafe() {
  const reduce = useReducedMotion()

  if (reduce) {
    return {
      initial: { opacity: 0 },
      animate: { opacity: 1 },
      exit: { opacity: 0 },
      transition: { duration: 0.15 },
    }
  }

  return {
    initial: { opacity: 0, y: 12 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -8 },
    transition: { duration: 0.3, ease: 'easeOut' },
  }
}

/**
 * Returns stagger container props for lists.
 */
export function useStaggerContainer(stagger = 0.05) {
  const reduce = useReducedMotion()
  return {
    initial: 'hidden',
    animate: 'visible',
    variants: {
      hidden: {},
      visible: { transition: { staggerChildren: reduce ? 0 : stagger } },
    },
  }
}

export function staggerItem(reduce = false) {
  return {
    variants: {
      hidden: { opacity: 0, y: reduce ? 0 : 16 },
      visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: 'easeOut' } },
    },
  }
}
