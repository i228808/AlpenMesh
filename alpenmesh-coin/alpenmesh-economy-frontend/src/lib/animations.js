/**
 * Shared animation presets for public pages.
 * Each variant is intentionally distinct — pick based on the role of the element.
 */

const SPRING = [0.22, 1, 0.36, 1]
const OVERSHOOT = [0.34, 1.56, 0.64, 1]

/** Hero headings and kickers — blur dissolve, no translate. Premium, weightless entrance. */
export const blurIn = (delay = 0) => ({
  initial: { opacity: 0, filter: 'blur(10px)' },
  whileInView: { opacity: 1, filter: 'blur(0px)' },
  viewport: { once: true },
  transition: { duration: 0.65, delay, ease: SPRING },
})

/** Section headings below the hero — deliberate upward reveal, slightly slower than cards. */
export const revealUp = (delay = 0) => ({
  initial: { opacity: 0, y: 32 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true },
  transition: { duration: 0.55, delay, ease: SPRING },
})

/** Cards and tile grids — scale up from slightly smaller. Feels like content arriving. */
export const scaleIn = (delay = 0) => ({
  initial: { opacity: 0, scale: 0.93, y: 12 },
  whileInView: { opacity: 1, scale: 1, y: 0 },
  viewport: { once: true },
  transition: { duration: 0.45, delay, ease: SPRING },
})

/** Timeline steps, rows, left-column text — strong directional entry from the left. */
export const slideLeft = (delay = 0) => ({
  initial: { opacity: 0, x: -28 },
  whileInView: { opacity: 1, x: 0 },
  viewport: { once: true },
  transition: { duration: 0.5, delay, ease: SPRING },
})

/** Right-column content — mirrors slideLeft for two-column layouts. */
export const slideRight = (delay = 0) => ({
  initial: { opacity: 0, x: 28 },
  whileInView: { opacity: 1, x: 0 },
  viewport: { once: true },
  transition: { duration: 0.5, delay, ease: SPRING },
})

/** CTA sections and highlight blocks — spring overshoot for a punchy, confident entrance. */
export const popIn = (delay = 0) => ({
  initial: { opacity: 0, scale: 0.88 },
  whileInView: { opacity: 1, scale: 1 },
  viewport: { once: true },
  transition: { duration: 0.5, delay, ease: OVERSHOOT },
})

/** Tags, bullets, small repeated items — pure opacity cascade, no movement. */
export const cascadeFade = (delay = 0) => ({
  initial: { opacity: 0 },
  whileInView: { opacity: 1 },
  viewport: { once: true },
  transition: { duration: 0.35, delay, ease: 'easeOut' },
})
