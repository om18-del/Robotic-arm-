export interface LinearizedParams {
  Kp: number
  Ki: number
  m: number
  L: number
  g: number
  b: number
  qStar: number // target angle (rad) — linearization point
}

/** A complex number, kept as a pair so it can be displayed without deps. */
export interface Pole {
  re: number
  im: number
}

export interface LinearizedResult {
  J: number
  /** Effective proportional stiffness: Kp minus the gravity "spring". */
  kEff: number
  /** Closed-loop characteristic polynomial J s^3 + b s^2 + kEff s + Ki. */
  a3: number
  a2: number
  a1: number
  a0: number
  poles: [Pole, Pole, Pole]
  /** The pole that decays slowest (largest real part): it sets the settle time. */
  dominant: Pole
  /** Frequency of the mechanical (P-only) pair: sqrt(kEff / J). */
  omegaN: number
  /** Damping ratio of the mechanical pair, b / (2 sqrt(kEff J)). */
  zetaMech: number
  /** Routh–Hurwitz integral-gain ceiling: Ki < b kEff / J. */
  KiCrit: number
  /** b kEff − J Ki: positive means the integral term cannot destabilise. */
  routhMargin: number
  stable: boolean
  regime: 'underdamped' | 'critically-damped' | 'overdamped' | 'unstable'
}

const EPS = 1e-12

/** cbrt that works for negative arguments (Math.cbrt already does). */
function cbrt(x: number): number {
  return Math.cbrt(x)
}

/**
 * All three roots of a real cubic a3 s^3 + a2 s^2 + a1 s + a0.
 *
 * Uses the closed-form solution so the panel can name the roots exactly
 * instead of approximating them: Cardano for one real root plus a quadratic
 * remainder, the trigonometric form for three real roots. Degenerate cubics
 * (a3 = 0, i.e. Ki = 0 and a purely second-order loop) fall back to the
 * quadratic formula so no pole is ever NaN.
 */
export function cubicRoots(a3: number, a2: number, a1: number, a0: number): [Pole, Pole, Pole] {
  if (Math.abs(a3) < EPS) {
    // Quadratic limit: a2 s^2 + a1 s + a0
    if (Math.abs(a2) < EPS) {
      if (Math.abs(a1) < EPS) return [{ re: 0, im: 0 }, { re: 0, im: 0 }, { re: 0, im: 0 }]
      return [{ re: -a0 / a1, im: 0 }, { re: -a0 / a1, im: 0 }, { re: 0, im: 0 }]
    }
    const disc = a1 * a1 - 4 * a2 * a0
    if (disc < 0) {
      const re = -a1 / (2 * a2)
      const im = Math.sqrt(-disc) / (2 * a2)
      return [{ re, im }, { re, im: -im }, { re: 0, im: 0 }]
    }
    const sq = Math.sqrt(disc)
    return [
      { re: (-a1 + sq) / (2 * a2), im: 0 },
      { re: (-a1 - sq) / (2 * a2), im: 0 },
      { re: 0, im: 0 },
    ]
  }

  // Monic form s^3 + A s^2 + B s + C
  const A = a2 / a3
  const B = a1 / a3
  const C = a0 / a3

  const p = B - (A * A) / 3
  const q = (2 * A * A * A) / 27 - (A * B) / 3 + C
  const disc = (q * q) / 4 + (p * p * p) / 27

  const roots: Pole[] = []

  if (disc > EPS) {
    // One real root, one complex-conjugate pair.
    const sq = Math.sqrt(disc)
    const u = cbrt(-q / 2 + sq)
    const v = cbrt(-q / 2 - sq)
    const r1 = u + v - A / 3
    roots.push({ re: r1, im: 0 })

    // Synthetic division for the remaining quadratic.
    const b1 = A + r1
    const b0 = B + b1 * r1
    const qd = b1 * b1 - 4 * b0
    if (qd < 0) {
      const re = -b1 / 2
      const im = Math.sqrt(-qd) / 2
      roots.push({ re, im }, { re, im: -im })
    } else {
      const sq2 = Math.sqrt(qd)
      roots.push({ re: (-b1 + sq2) / 2, im: 0 }, { re: (-b1 - sq2) / 2, im: 0 })
    }
  } else if (disc < -EPS) {
    // Three distinct real roots (trigonometric form).
    const r = 2 * Math.sqrt(Math.max(0, -p / 3))
    const arg = r > EPS ? (3 * q) / (p * r) : 0
    const phi = Math.acos(Math.max(-1, Math.min(1, arg)))
    for (let k = 0; k < 3; k++) {
      roots.push({ re: r * Math.cos(phi / 3 - (2 * Math.PI * k) / 3) - A / 3, im: 0 })
    }
  } else {
    // Repeated roots: disc ≈ 0. p = q = 0 gives a triple root.
    const base = -A / 3
    if (Math.abs(p) < 1e-9 && Math.abs(q) < 1e-9) {
      roots.push({ re: base, im: 0 }, { re: base, im: 0 }, { re: base, im: 0 })
    } else {
      const u = cbrt(-q / 2)
      const r1 = 2 * u - A / 3
      const r2 = -u - A / 3
      roots.push({ re: r1, im: 0 }, { re: r2, im: 0 }, { re: r2, im: 0 })
    }
  }

  // Sort by real part descending: dominant (slowest) pole first.
  roots.sort((x, y) => y.re - x.re)
  return [roots[0], roots[1], roots[2]]
}

/**
 * Linearise the PI-controlled arm about the setpoint q*.
 *
 * Plant:      J q̈ + b q̇ + m g (L/2) cos q = τ
 * Controller: τ = Kp (q* − q) + Ki ∫ (q* − q) dt      (PI, no derivative term)
 *
 * Substituting the controller into the plant and differentiating once removes
 * the integral and leaves a *third-order* ODE in the deviation δ = q − q*:
 *
 *   J δ⃛ + b δ̈ + (Kp − m g (L/2) sin q*) δ̇ + Ki δ = 0
 *
 * with k_eff = Kp − m g (L/2) sin q*. Its characteristic polynomial is
 *
 *   J s³ + b s² + k_eff s + Ki = 0
 *
 * The extra pole (compared with a PD loop) is exactly what the integrator
 * costs: the loop is stable iff k_eff > 0, b > 0, Ki > 0 and b k_eff > J Ki.
 */
export function linearize(p: LinearizedParams): LinearizedResult {
  const J = (p.m * p.L * p.L) / 3
  const kEff = p.Kp - p.m * p.g * (p.L / 2) * Math.sin(p.qStar)

  const a3 = J
  const a2 = p.b
  const a1 = kEff
  const a0 = p.Ki

  const poles = cubicRoots(a3, a2, a1, a0)
  const dominant = poles[0]

  const omegaN = Math.sqrt(Math.max(0, kEff / J))
  const zetaMech = kEff > 0 ? p.b / (2 * Math.sqrt(kEff * J)) : Infinity

  const KiCrit = kEff > 0 && J > 0 ? (p.b * kEff) / J : 0
  const routhMargin = p.b * kEff - J * p.Ki

  const anyRightHalfPlane = poles.some((s) => s.re > 1e-9)
  const stable = !anyRightHalfPlane && kEff > 0 && p.Ki > 0 && routhMargin > 0

  const hasComplexPair = poles.some((s) => Math.abs(s.im) > 1e-6)

  let regime: LinearizedResult['regime']
  if (!stable) {
    regime = 'unstable'
  } else if (hasComplexPair) {
    regime = 'underdamped'
  } else {
    // All real. Critical damping is a property of the *dominant* pair (the two
    // slowest poles) — the third pole is usually far to the left and would
    // otherwise swamp any comparison of the whole spread.
    const s1 = poles[0].re
    const s2 = poles[1].re
    const scale = Math.max(1e-9, Math.max(Math.abs(s1), Math.abs(s2)))
    regime = Math.abs(s1 - s2) / scale < 0.2 ? 'critically-damped' : 'overdamped'
  }

  return {
    J,
    kEff,
    a3,
    a2,
    a1,
    a0,
    poles,
    dominant,
    omegaN,
    zetaMech,
    KiCrit,
    routhMargin,
    stable,
    regime,
  }
}

export type Regime = LinearizedResult['regime']

/** Format a pole for display: "−6.300 ± 14.153j" or a single real number. */
export function formatPole(s: Pole, digits = 3): string {
  if (Math.abs(s.im) < 1e-6) return s.re.toFixed(digits)
  const sign = s.im >= 0 ? '+' : '−'
  return `${s.re.toFixed(digits)} ${sign} ${Math.abs(s.im).toFixed(digits)}j`
}
