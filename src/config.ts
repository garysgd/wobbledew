// All game tuning + theme data in one place. Theme: WOBBLEDEW (design brief
// from research workflow) — Dewlings in a lighthouse keeper's wishing jar.

export const GAME_NAME = 'Wobbledew'
export const GAME_TAGLINE = 'every wish starts as a wobble'

// Logical board: 640-wide jar interior, y-up, floor at 0.
export const DESIGN = {
  jarHalfWidth: 320,
  floorY: 0,
  jarTopY: 760,
  loseLineY: 676, // 11% below jar top
  dropY: 850,
  /** camera frames at least this much of the z=0 plane */
  frameW: 780,
  frameH: 1090,
  frameCenterY: 430,
}

export const RULES = {
  gravity: -2600,
  /** fallback re-arm time if the dropped blob somehow never contacts —
   *  must exceed the worst-case free-fall time from dropY (~0.85 s) */
  dropCooldown: 1.0,
  /** droppable tiers = indices 0..4, uniform odds */
  droppableTiers: 5,
  /** seconds of continuous lose-line overlap before bedtime */
  loseGrace: 0.75,
  /** chain window for combo escalation (juice + pitch only, canon scoring) */
  comboWindow: 0.8,
  /** Snuggle Seek: gap < snuggleGap × min(r) → attraction accel (px/s²) */
  snuggleGap: 0.5,
  snuggleAccel: 340,
  /** Star Snack: pellet banked every N merges, max 1 banked */
  starEvery: 8,
  /** physics-only hit-stop seconds by 0-based tier index of the merge result */
  hitStop: (tier: number) => (tier <= 2 ? 0 : tier <= 6 ? 0.05 : tier <= 8 ? 0.08 : 0.12),
  /** screen shake trauma only for big merges (0-based result tier) */
  shakeTrauma: (tier: number) => (tier >= 5 ? 0.18 + 0.02 * (tier - 5) : 0),
}

/** Eye atlas cells: 0 round-glossy, 1 half-lid, 2 happy-arc, 3 squint '>',
 *  4 sleeping zZ, 5 starry, 6 wink-closed, 7 lashes */
export type EyeStyle = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7
/** Mouth atlas cells: 0 smile, 1 open-joy, 2 smug-cat, 3 squint-wavy, 4 oh,
 *  5 pout, 6 tongue-grin, 7 tiny-3 */
export type MouthStyle = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7

export interface TierDef {
  name: string
  r: number
  /** main body color */
  color: string
  /** accent (extras, rim tint bias) */
  accent: string
  eyeL: EyeStyle
  eyeR: EyeStyle
  mouth: MouthStyle
  /** eye size relative to radius — babies have huge eyes */
  eyeScale: number
  /** 0..1 blush visibility */
  blush: number
  extra?: 'leaf' | 'bolt' | 'brows' | 'crown' | 'aurora'
  personality: string
}

const BASE_R = 21
const RATIOS = [1.0, 1.32, 1.84, 2.16, 2.73, 3.44, 3.97, 4.86, 5.44, 6.65, 7.89]

export const TIERS: TierDef[] = [
  { name: 'Plip',     color: '#FFB3D1', accent: '#FF7BAC', eyeL: 0, eyeR: 0, mouth: 7, eyeScale: 0.34, blush: 1.0, personality: 'a newborn wish that snores in tiny bounces' },
  { name: 'Squibble', color: '#FF9457', accent: '#FFD29B', eyeL: 0, eyeR: 0, mouth: 6, eyeScale: 0.28, blush: 0.5, personality: 'tastes everything first, thinks never' },
  { name: 'Bumble',   color: '#FFDE6B', accent: '#F2A93B', eyeL: 2, eyeR: 2, mouth: 1, eyeScale: 0.26, blush: 0.7, personality: 'giggles so hard it vibrates' },
  { name: 'Sprigg',   color: '#9FE05A', accent: '#5BB344', eyeL: 0, eyeR: 6, mouth: 2, eyeScale: 0.25, blush: 0.4, extra: 'leaf', personality: 'narrates its own somersaults' },
  { name: 'Nori',     color: '#4FD8C4', accent: '#2BA897', eyeL: 0, eyeR: 0, mouth: 4, eyeScale: 0.30, blush: 1.0, personality: 'painfully shy, secretly hopes you notice' },
  { name: 'Lumi',     color: '#6FC4FF', accent: '#B8E6FF', eyeL: 1, eyeR: 1, mouth: 0, eyeScale: 0.24, blush: 0.5, personality: 'hums lullabies that make neighbors drowsy' },
  { name: 'Grumble',  color: '#6F6AF2', accent: '#FFE066', eyeL: 0, eyeR: 0, mouth: 5, eyeScale: 0.23, blush: 0.3, extra: 'brows', personality: 'pocket thunderstorm, marshmallow heart' },
  { name: 'Floof',    color: '#C49AFF', accent: '#F3E3FF', eyeL: 7, eyeR: 7, mouth: 2, eyeScale: 0.22, blush: 0.6, personality: 'the prettiest being in the jar (self-declared)' },
  { name: 'Plumpa',   color: '#F06FD0', accent: '#FFC1EC', eyeL: 2, eyeR: 2, mouth: 0, eyeScale: 0.21, blush: 0.8, personality: 'the jar’s gentle giant nanny' },
  { name: 'Pomp',     color: '#E0436E', accent: '#FFD76B', eyeL: 1, eyeR: 1, mouth: 0, eyeScale: 0.19, blush: 0.4, extra: 'crown', personality: 'royalty until squished, then ticklish' },
  { name: 'Borealis', color: '#4A4E9E', accent: '#8FFAE1', eyeL: 2, eyeR: 2, mouth: 0, eyeScale: 0.18, blush: 0.3, extra: 'aurora', personality: 'an ancient sky-whale carrying every wish' },
].map((t, i) => ({ ...t, r: Math.round(BASE_R * RATIOS[i]) })) as TierDef[]

/** points for merging two of tier index i (0-based): triangular numbers */
export const TIER_SCORE = TIERS.map((_, i) => ((i + 1) * (i + 2)) / 2)

export const PALETTE = {
  bgTop: '#2C2752',
  bgMid: '#453E74',
  bgGlow: '#6A5A9E',
  mist: '#EFEAFB',
  text: '#FFF6F0',
  lamp: '#FFE8B8',
  pink: '#FFD9E8',
  glass: '#BFE8FF',
  button: '#9C8CFF',
  danger: '#E0436E',
  aurora: '#8FFAE1',
}
