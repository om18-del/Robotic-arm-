import { describe, it, expect } from 'vitest'
import { cubicRoots, linearize, formatPole } from './analysis'
import type { LinearizedParams, Pole } from './analysis'
import { armDynamics, momentOfInertia } from './arm'
import { piTorque } from './controller'
import { rk4Step } from './rk4'

const DT = 1 / 480

function lp(over: Partial<LinearizedParams> = {}): LinearizedParams {
  return { Kp: 20, Ki: 4, m: 1, L: 0.5, g: 9.81, b: 0.05, qStar: 0, ...over }
}

const cAbs = (z: Pole) => Math.hypot(z.re, z.im)

/** Residue of the characteristic polynomial at s, to confirm s is a root. */
function cubicResidual(p: LinearizedParams, s: Pole): number {
  const J = momentOfInertia(p.m, p.L)
  const kEff = p.Kp - p.m * p.g * (p.L / 2) * Math.sin(p.qStar)
  // (J s^3 + b s^2 + kEff s + Ki), evaluated with complex arithmetic.
  const c = [J, p.b, kEff, p.Ki]
  let re = 0
  let im = 0
  for (const coeff of c) {
    const nr = re * s.re - im * s.im + coeff
    const ni = re * s.im + im * s.re
    re = nr
    im = ni
  }
  return Math.hypot(re, im)
}

describe('cubicRoots', () => {
  it('finds the roots of (s+1)(s+2)(s+3) = s^3 + 6s^2 + 11s + 6', () => {
    const roots = cubicRoots(1, 6, 11, 6).map((r) => r.re).sort((a, b) => a - b)
    expect(roots[0]).toBeCloseTo(-3, 6)
    expect(roots[1]).toBeCloseTo(-2, 6)
    expect(roots[2]).toBeCloseTo(-1, 6)
  })

  it('finds a complex pair when the discriminant is negative', () => {
    // (s + 0.5)(s^2 + 4) = s^3 + 0.5 s^2 + 4 s + 2  =>  s = -0.5 and s = ±2j
    const roots = cubicRoots(1, 0.5, 4, 2)
    const complex = roots.filter((r) => Math.abs(r.im) > 1e-6)
    expect(complex).toHaveLength(2)
    for (const r of complex) {
      expect(r.re).toBeCloseTo(0, 6)
      expect(Math.abs(r.im)).toBeCloseTo(2, 6)
    }
    expect(roots.some((r) => Math.abs(r.im) < 1e-6 && Math.abs(r.re + 0.5) < 1e-6)).toBe(true)
  })

  it('falls back to the quadratic formula when a3 = 0 (pure P loop, Ki = 0)', () => {
    const roots = cubicRoots(0, 1, 3, 2) // s^2 + 3s + 2 = (s+1)(s+2)
    const reals = roots.map((r) => r.re).sort((a, b) => a - b)
    expect(reals[0]).toBeCloseTo(-2, 6)
    expect(reals[1]).toBeCloseTo(-1, 6)
    expect(roots.every((r) => Number.isFinite(r.re) && Number.isFinite(r.im))).toBe(true)
  })
})

describe('linearize: the closed loop is third order', () => {
  it('places every pole on the characteristic cubic J s^3 + b s^2 + k_eff s + Ki', () => {
    for (const over of [{}, { qStar: 0.4 }, { b: 0.8, Ki: 1 }, { Kp: 5, Ki: 12, qStar: -0.3 }]) {
      const p = lp(over)
      const r = linearize(p)
      for (const s of r.poles) {
        expect(cubicResidual(p, s)).toBeLessThan(1e-6)
      }
    }
  })

  it('uses k_eff = Kp - m g (L/2) sin q*', () => {
    const p = lp({ Kp: 30, qStar: 0.35 })
    const r = linearize(p)
    expect(r.kEff).toBeCloseTo(30 - 1 * 9.81 * 0.25 * Math.sin(0.35), 9)
    expect(r.a3).toBeCloseTo(momentOfInertia(1, 0.5), 12)
    expect(r.a2).toBeCloseTo(0.05, 12)
    expect(r.a1).toBeCloseTo(r.kEff, 12)
    expect(r.a0).toBeCloseTo(4, 12)
  })

  it('reports Ki_crit = b k_eff / J and the Routh margin b k_eff - J Ki', () => {
    const p = lp({ Kp: 20, b: 0.05 })
    const r = linearize(p)
    const J = momentOfInertia(1, 0.5)
    expect(r.KiCrit).toBeCloseTo((0.05 * 20) / J, 9) // = 12
    expect(r.KiCrit).toBeCloseTo(12, 6)
    expect(r.routhMargin).toBeCloseTo(0.05 * 20 - J * 4, 9)
  })

  it('is stable just below the Routh limit and unstable just above it', () => {
    const below = linearize(lp({ Ki: 11.9 }))
    const above = linearize(lp({ Ki: 12.1 }))
    expect(below.stable).toBe(true)
    expect(below.poles.every((s) => s.re < 0)).toBe(true)
    expect(above.stable).toBe(false)
    expect(above.regime).toBe('unstable')
    expect(Math.max(...above.poles.map((s) => s.re))).toBeGreaterThan(0)
  })

  it('flags unstable when k_eff <= 0 (the P term can no longer lift the arm)', () => {
    const r = linearize(lp({ Kp: 0.5, qStar: Math.PI / 2 }))
    expect(r.kEff).toBeLessThan(0)
    expect(r.regime).toBe('unstable')
    expect(r.poles.every((s) => Number.isFinite(s.re) && Number.isFinite(s.im))).toBe(true)
  })

  it('reports a zero integral gain as a second-order loop, never NaN', () => {
    const r = linearize(lp({ Ki: 0 }))
    expect(r.poles.every((s) => Number.isFinite(s.re) && Number.isFinite(s.im))).toBe(true)
    // Ki = 0 means one pole is the artificial one from the quadratic fallback.
    expect(r.stable).toBe(false)
    expect(r.dominant.re).toBeLessThan(0)
  })

  it('names the slowest pole as dominant', () => {
    const r = linearize(lp())
    const maxRe = Math.max(...r.poles.map((s) => s.re))
    expect(r.dominant.re).toBeCloseTo(maxRe, 12)
  })
})

describe('the cubic predicts the simulated motion', () => {
  /** Solve a 3x3 real linear system by Gaussian elimination with pivoting. */
  function solve3(M: number[][], rhs: number[]): number[] {
    const A = M.map((row) => [...row])
    const b = [...rhs]
    for (let i = 0; i < 3; i++) {
      let pivot = i
      for (let k = i + 1; k < 3; k++) if (Math.abs(A[k][i]) > Math.abs(A[pivot][i])) pivot = k
      ;[A[i], A[pivot]] = [A[pivot], A[i]]
      ;[b[i], b[pivot]] = [b[pivot], b[i]]
      for (let k = i + 1; k < 3; k++) {
        const f = A[k][i] / A[i][i]
        for (let j = i; j < 3; j++) A[k][j] -= f * A[i][j]
        b[k] -= f * b[i]
      }
    }
    const x = [0, 0, 0]
    for (let i = 2; i >= 0; i--) {
      let sum = b[i]
      for (let j = i + 1; j < 3; j++) sum -= A[i][j] * x[j]
      x[i] = sum / A[i][i]
    }
    return x
  }

  /**
   * With no gravity, no delay and no saturation the closed loop is exactly
   * linear, so q(t) - q* must equal the modal solution built from the cubic's
   * roots. Fit the coefficients to the three initial conditions (q, q̇, q̈) and
   * compare against RK4 on the real plant.
   */
  function analyticVsSim(p: LinearizedParams, seconds: number, mode: 'ode' | 'pipeline' = 'pipeline'): number {
    const r = linearize(p)
    const J = r.J
    const q0 = 0.1
    const qd0 = 0

    // q̈(0) from the plant, with the controller's torque at t = 0 (integral 0).
    // Gravity is switched off in this comparison so the loop is exactly linear.
    const tau0 = p.Kp * (p.qStar - q0)
    const qdd0 = (tau0 - p.b * qd0) / J

    const realPole = r.poles.find((s) => Math.abs(s.im) < 1e-9)
    const pair = r.poles.filter((s) => Math.abs(s.im) > 1e-9)

    let analytic: (t: number) => number

    if (realPole && pair.length === 2) {
      // q(t) = A e^{s1 t} + e^{σt}( B cos ωt + C sin ωt )
      const s1 = realPole.re
      const sigma = pair[0].re
      const omega = Math.abs(pair[0].im)
      const M = [
        [1, 1, 0],
        [s1, sigma, omega],
        [s1 * s1, sigma * sigma - omega * omega, 2 * sigma * omega],
      ]
      const [A, B, C] = solve3(M, [q0, qd0, qdd0])
      analytic = (t) =>
        A * Math.exp(s1 * t) + Math.exp(sigma * t) * (B * Math.cos(omega * t) + C * Math.sin(omega * t))
    } else {
      // Three real roots: q(t) = Σ c_i e^{s_i t}
      const s = r.poles.map((x) => x.re)
      const M = [
        [1, 1, 1],
        [s[0], s[1], s[2]],
        [s[0] * s[0], s[1] * s[1], s[2] * s[2]],
      ]
      const [c0, c1, c2] = solve3(M, [q0, qd0, qdd0])
      analytic = (t) =>
        c0 * Math.exp(s[0] * t) + c1 * Math.exp(s[1] * t) + c2 * Math.exp(s[2] * t)
    }

    let maxErr = 0

    if (mode === 'ode') {
      // Companion form of J δ⃛ + b δ̈ + k_eff δ̇ + Ki δ = 0:
      //   x = [δ, δ̇, δ̈],  ẋ = [x2, x3, (−Ki x1 − k_eff x2 − b x3)/J]
      const h = 1e-4
      const f = (x: number[]) => [x[1], x[2], (-p.Ki * x[0] - r.kEff * x[1] - p.b * x[2]) / J]
      let x = [q0, qd0, qdd0]
      let t = 0
      const n = Math.round(seconds / h)
      for (let i = 0; i < n; i++) {
        x = rk4Step(f, x, t, h)
        t += h
        maxErr = Math.max(maxErr, Math.abs(x[0] - analytic(t)))
      }
      return maxErr
    }

    // The app's real pipeline: zero-order-hold controller at 480 Hz, RK4 plant.
    // Holding the torque for one 2 ms step is a small extra delay that is not
    // in the continuous cubic, so this comparison has a hold-sized tolerance.
    const ctrl = { ...p, gravityCompensation: false, tauMax: 0, delayMs: 0 }
    let x = [q0, qd0]
    let integral = 0
    const steps = Math.round(seconds / DT)
    for (let i = 0; i < steps; i++) {
      const pi = piTorque(x[0], p.qStar, ctrl, { integral }, DT)
      integral = pi.integral
      x = rk4Step((s) => armDynamics(s, { m: p.m, L: p.L, g: 0, b: p.b }, pi.tau), x, i * DT, DT)
      maxErr = Math.max(maxErr, Math.abs(x[0] - analytic((i + 1) * DT)))
    }
    return maxErr
  }

  it('is exactly the solution of the companion ODE (1e-6)', () => {
    expect(analyticVsSim(lp({ b: 0.6, Ki: 6 }), 1.0, 'ode')).toBeLessThan(1e-6)
    expect(analyticVsSim(lp({ b: 0.05, Ki: 20 }), 0.5, 'ode')).toBeLessThan(1e-6)
  })

  it('the 480 Hz pipeline follows it to within the torque hold error', () => {
    expect(analyticVsSim(lp({ b: 0.6, Ki: 6 }), 1.0)).toBeLessThan(5e-3)
  })

  it('also predicts an unstable loop, where the amplitude grows', () => {
    const p = lp({ b: 0.05, Ki: 20 })
    const r = linearize(p)
    expect(r.stable).toBe(false)
    expect(analyticVsSim(p, 0.5, 'ode')).toBeLessThan(1e-6)
    // The hold error scales with the (growing) amplitude, hence 1e-2 here.
    expect(analyticVsSim(p, 0.5)).toBeLessThan(1e-2)
  })
})

describe('the integral term removes the steady-state offset', () => {
  /** Settle the real closed loop and return the final angle error. */
  function settle(Ki: number, seconds: number): number {
    const p = { Kp: 30, Ki, m: 1, L: 0.5, g: 9.81, b: 0.3, gravityCompensation: false, tauMax: 0, delayMs: 0 }
    let x = [0, 0]
    let integral = 0
    const steps = Math.round(seconds / DT)
    for (let i = 0; i < steps; i++) {
      const pi = piTorque(x[0], 0, p, { integral }, DT)
      integral = pi.integral
      x = rk4Step((s) => armDynamics(s, p, pi.tau), x, i * DT, DT)
    }
    return x[0]
  }

  it('leaves the predicted droop with Ki = 0: e_ss = m g (L/2) cos q* / Kp', () => {
    const qFinal = settle(0, 60)
    const predicted = -(1 * 9.81 * 0.25) / 30
    expect(qFinal).toBeCloseTo(predicted, 2)
  })

  it('drives the error to zero once Ki > 0', () => {
    const qFinal = settle(4, 60)
    expect(Math.abs(qFinal)).toBeLessThan(2e-3)
  })
})

describe('formatPole', () => {
  it('prints a real pole as a number and a complex pole as a ± bj', () => {
    expect(formatPole({ re: -2.5, im: 0 })).toBe('-2.500')
    expect(formatPole({ re: -1, im: 3 })).toBe('-1.000 + 3.000j')
    expect(formatPole({ re: -1, im: -3 })).toBe('-1.000 − 3.000j')
  })

  it('has finite magnitudes for every pole the app can produce', () => {
    const r = linearize(lp({ Ki: 20 }))
    for (const s of r.poles) expect(cAbs(s)).toBeLessThan(1e4)
  })
})
