import { linearize } from './analysis'
import type { SimParams } from '../hooks/useSimulation'

export type PresetName = 'underdamped' | 'critically-damped' | 'overdamped' | 'unstable'

/** The plant and gain values the presets read before overriding. */
export interface PresetInput {
  Kp: number
  m: number
  L: number
  g: number
  b: number
}

export interface PresetMeta {
  name: PresetName
  label: string
  /** What the arm actually does — used as the button tooltip. */
  detail: string
}

export const PRESETS: PresetMeta[] = [
  {
    name: 'underdamped',
    label: 'Underdamped',
    detail: 'Light joint (b = 0.05): the loop rings before it settles.',
  },
  {
    name: 'critically-damped',
    label: 'Critically damped',
    detail:
      'Damped joint (b = 4) with K_i on the repeated-root boundary: the fastest return that does not ring.',
  },
  {
    name: 'overdamped',
    label: 'Overdamped',
    detail:
      'Damped joint, K_i well below the boundary: all three poles real and spread out, so it is slower but does not ring.',
  },
  {
    name: 'unstable',
    label: 'Unstable',
    detail:
      'K_i pushed past b·k_eff/J: a pole enters the right half-plane, so it never settles. With torque saturation on, the runaway becomes a sustained oscillation.',
  },
]

/** Proportional gain every preset sets. Gains are computed from this, not
 * from whatever the slider happens to hold, so a preset always lands in the
 * regime on its button. */
const PRESET_KP = 20
/** Joint friction used by the damped presets, N·m·s/rad. */
const DAMPED_B = 4
/** Joint friction of the lightly damped default arm. */
const LIGHT_B = 0.05

/**
 * Largest integral gain for which the characteristic cubic still has three
 * real roots — i.e. where the dominant pair stops being complex and the
 * response stops overshooting. Solved by bisection on the discriminant, so it
 * adapts to the current Kp and setpoint instead of being a hard-coded number.
 *
 * Below this gain the loop is overdamped; at it, the dominant pair is a
 * repeated real root, which is the third-order meaning of critical damping.
 */
export function criticalKi(b: number, kEff: number, J: number): number {
  const disc = (Ki: number): number => {
    const A = b / J
    const B = kEff / J
    const C = Ki / J
    const p = B - (A * A) / 3
    const q = (2 * A * A * A) / 27 - (A * B) / 3 + C
    return (q * q) / 4 + (p * p * p) / 27
  }
  // Stability ceiling: above b*k_eff/J the real pole itself goes unstable.
  let hi = kEff > 0 && J > 0 ? (b * kEff) / J : 1
  let lo = 0
  if (disc(0) > 0) return 0 // never three real roots, e.g. b tiny
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2
    if (disc(mid) <= 0) lo = mid
    else hi = mid
  }
  return lo
}

/**
 * Parameters for each preset. The gains alone cannot produce a critically
 * damped or overdamped response: with no derivative term the only damping in
 * the loop is the joint's own friction b, so those two presets damp the joint
 * as well. That is the honest version of "the same controller on a heavier,
 * better-damped arm".
 */
export function presetParams(
  name: PresetName,
  current: PresetInput,
  qStar: number,
): Partial<SimParams> {
  const J = (current.m * current.L * current.L) / 3
  // Use the gain the preset is about to apply — not the current slider value —
  // otherwise a preset picked after raising K_p computes a boundary that does
  // not belong to the loop it installs.
  const kEff = PRESET_KP - current.m * current.g * (current.L / 2) * Math.sin(qStar)
  const dampedCrit = criticalKi(DAMPED_B, kEff, J)

  switch (name) {
    case 'underdamped':
      return { Kp: PRESET_KP, b: LIGHT_B, Ki: 4, delayMs: 0, gravityCompensation: false, tauMax: 6 }
    case 'critically-damped':
      return {
        Kp: PRESET_KP,
        b: DAMPED_B,
        Ki: Math.max(0.5, dampedCrit),
        delayMs: 0,
        gravityCompensation: false,
        tauMax: 6,
      }
    case 'overdamped':
      return {
        Kp: PRESET_KP,
        b: DAMPED_B,
        Ki: Math.max(0.5, 0.3 * dampedCrit),
        delayMs: 0,
        gravityCompensation: false,
        tauMax: 6,
      }
    case 'unstable': {
      const routhLimit = kEff > 0 && J > 0 ? (LIGHT_B * kEff) / J : 0
      // Push past the Routh–Hurwitz limit so a pole crosses into the RHP.
      const target = Math.max(1, routhLimit * 1.4)
      return { Kp: PRESET_KP, b: LIGHT_B, Ki: target, delayMs: 0, gravityCompensation: false, tauMax: 6 }
    }
  }
}

/** Convenience for tests: linearise the parameters a preset would produce. */
export function presetResult(name: PresetName, current: PresetInput, qStar: number) {
  const over = presetParams(name, current, qStar)
  return linearize({
    Kp: over.Kp ?? current.Kp,
    Ki: over.Ki ?? 0,
    m: current.m,
    L: current.L,
    g: current.g,
    b: over.b ?? current.b,
    qStar,
  })
}
