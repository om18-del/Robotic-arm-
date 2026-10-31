import { describe, it, expect } from 'vitest'
import { rk4Step } from './rk4'
import { armDynamics, armEnergy, momentOfInertia } from './arm'
import type { ArmParams } from './arm'

const DT = 1 / 480

// gravity-free arm for the linear check
function gravityFreeParams(): ArmParams {
  return { m: 1.0, L: 0.5, g: 0.0, b: 0.0 }
}

// ---------- Test 1: linear check (gravity=0, small angle, matches analytic 2nd-order) ----------
describe('linear check: PD-controlled arm with no gravity, small angle', () => {
  it('matches analytic second-order solution to within 0.1% for small initial displacement', () => {
    const p = gravityFreeParams()
    const Kp = 20.0
    const Kd = 2 * Math.sqrt(Kp * momentOfInertia(p.m, p.L)) // critical damping for nice match
    const qStar = 0.0

    // Initial state: displaced 0.05 rad from equilibrium, zero velocity
    const x0 = [0.05, 0.0]

    // Analytic solution for critically damped second-order system with omega_n = sqrt(Kp/J)
    const J = momentOfInertia(p.m, p.L)
    const omegaN = Math.sqrt(Kp / J)
    const zeta = (p.b + Kd) / (2 * Math.sqrt(Kp * J))

    function analytic(t: number): number {
      // Under/critically/overdamped analytic forms
      if (zeta < 1) {
        const wd = omegaN * Math.sqrt(1 - zeta * zeta)
        const A = q0
        // position: e^{-zeta omega_n t} (A cos(wd t) + B sin(wd t))
        const expTerm = Math.exp(-zeta * omegaN * t)
        // B from initial velocity: qd(0) = -zeta omega_n A + wd B => B = (qdot0 + zeta omega_n A)/wd
        const Bval = (qdot0 + zeta * omegaN * A) / wd
        return expTerm * (A * Math.cos(wd * t) + Bval * Math.sin(wd * t))
      } else if (Math.abs(zeta - 1) < 1e-6) {
        // critically damped: (A + B t) e^{-omega_n t}
        const A = q0
        const B = qdot0 + omegaN * q0
        return (A + B * t) * Math.exp(-omegaN * t)
      } else {
        // overdamped: real roots r1, r2
        const r1 = -zeta * omegaN + omegaN * Math.sqrt(zeta * zeta - 1)
        const r2 = -zeta * omegaN - omegaN * Math.sqrt(zeta * zeta - 1)
        // q(t) = C1 e^{r1 t} + C2 e^{r2 t}
        // C1 + C2 = q0,  r1 C1 + r2 C2 = qdot0
        const C1 = (qdot0 - r2 * q0) / (r1 - r2)
        const C2 = q0 - C1
        return C1 * Math.exp(r1 * t) + C2 * Math.exp(r2 * t)
      }
    }

    // local initial conditions for the analytic closure
    const q0 = 0.05
    const qdot0 = 0.0

    const steps = 60 // 0.125 s of sim
    let maxErr = 0
    let xSim = [...x0]
    for (let i = 0; i <= steps; i++) {
      const t = i * DT
      // analytic position
      const qa = analytic(t)
      maxErr = Math.max(maxErr, Math.abs(xSim[0] - qa))
      // step forward
      const f = (s: number[]) => {
        const tau = Kp * (qStar - s[0]) - Kd * s[1]
        return armDynamics(s, p, tau)
      }
      xSim = rk4Step(f, xSim, t, DT)
    }

    // 0.1% of initial displacement = 5e-5 rad
    expect(maxErr).toBeLessThan(5e-5)
  })
})

// ---------- Test 2: energy check (b=0, Kp=0, Kd=0 => energy drift < 0.1% over 10s) ----------
describe('energy check: no damping, no control => energy conserved', () => {
  it('total mechanical energy drift stays under 0.1% over 10 s', () => {
    const p: ArmParams = { m: 1.0, L: 0.5, g: 9.81, b: 0.0 }
    const x0 = [Math.PI / 6, 0.0] // 30 deg from horizontal, released from rest
    const E0 = armEnergy(x0, p)

    let x = [...x0]
    const steps = Math.round(10 / DT)
    for (let i = 0; i < steps; i++) {
      const t = i * DT
      const f = (_s: number[], _t: number) => armDynamics(_s, p, 0.0)
      x = rk4Step(f, x, t, DT)
    }

    const E1 = armEnergy(x, p)
    const drift = Math.abs(E1 - E0) / Math.abs(E0)
    expect(drift).toBeLessThan(0.001) // 0.1%
  })
})

// ---------- Test 3: convergence order (halving dt => ~16x error reduction => 4th order) ----------
describe('convergence order: RK4 is 4th order', () => {
  it('halving dt reduces error by ~16x for a fixed endpoint', () => {
    const p: ArmParams = { m: 1.0, L: 0.5, g: 9.81, b: 0.05 }
    const Kp = 20.0
    const Kd = 1.0
    const qStar = 0.0
    const x0 = [0.2, 0.0]

    function simulate(dt: number, steps: number) {
      let x = [...x0]
      for (let i = 0; i < steps; i++) {
        const t = i * dt
        const f = (s: number[]) => {
          const tau = Kp * (qStar - s[0]) - Kd * s[1]
          return armDynamics(s, p, tau)
        }
        x = rk4Step(f, x, t, dt)
      }
      return x[0]
    }

    // Reference: run with dt/8
    const dtRef = DT / 8
    const stepsRef = Math.round(1.0 / dtRef)
    const qRef = simulate(dtRef, stepsRef)

    const dt1 = DT
    const steps1 = Math.round(1.0 / dt1)
    const q1 = simulate(dt1, steps1)

    const dt2 = DT / 2
    const steps2 = Math.round(1.0 / dt2)
    const q2 = simulate(dt2, steps2)

    const err1 = Math.abs(q1 - qRef)
    const err2 = Math.abs(q2 - qRef)

    const ratio = err1 / Math.max(1e-15, err2)
    // 4th order => ratio ~ 2^4 = 16. Accept 12..22 for floating point variation.
    expect(ratio).toBeGreaterThan(12)
    expect(ratio).toBeLessThan(22)
  })
})

// ---------- Test 4: steady state (gravity comp off => offset e_ss; on => error -> 0) ----------
describe('steady state: gravity compensation removes offset', () => {
  it('with gravity comp OFF, settles to predicted e_ss = m g (L/2) cos(q*) / Kp', () => {
    const p: ArmParams = { m: 1.0, L: 0.5, g: 9.81, b: 0.05 }
    const Kp = 30.0
    const Kd = 1.0
    const qStar = 0.0
    const x0 = [0.0, 0.0] // start at horizontal, equilibrium with gravity comp off is offset

    // Predicted steady-state error (from static balance: Kp (q* - q_ss) = m g (L/2) cos(q*))
    const eSS = (p.m * p.g * (p.L / 2) * Math.cos(qStar)) / Kp

    let x = [...x0]
    const steps = Math.round(10.0 / DT)
    for (let i = 0; i < steps; i++) {
      const t = i * DT
      const tau = Kp * (qStar - x[0]) - Kd * x[1] // no gravity comp
      const f = (s: number[]) => armDynamics(s, p, tau)
      x = rk4Step(f, x, t, DT)
    }

    // Final position should be near -e_ss (arm drops below horizontal because gravity pulls down)
    // q* = 0 => q_ss = -e_ss
    const qFinal = x[0]
    const expectedQss = -eSS
    // allow 1% relative tolerance plus small absolute
    const tol = Math.max(0.01 * Math.abs(expectedQss), 1e-4)
    expect(Math.abs(qFinal - expectedQss)).toBeLessThan(tol)
  })

  it('with gravity comp ON, error -> 0 (settles at q*)', () => {
    const p: ArmParams = { m: 1.0, L: 0.5, g: 9.81, b: 0.05 }
    const Kp = 30.0
    const Kd = 1.0
    const qStar = 0.0
    const x0 = [0.0, 0.0]

    let x = [...x0]
    const steps = Math.round(10.0 / DT)
    for (let i = 0; i < steps; i++) {
      const t = i * DT
      const tau = Kp * (qStar - x[0]) - Kd * x[1] + p.m * p.g * (p.L / 2) * Math.cos(x[0]) // gravity comp on
      const f = (s: number[]) => armDynamics(s, p, tau)
      x = rk4Step(f, x, t, DT)
    }

    expect(Math.abs(x[0] - qStar)).toBeLessThan(1e-4)
    expect(Math.abs(x[1])).toBeLessThan(1e-4)
  })
})

