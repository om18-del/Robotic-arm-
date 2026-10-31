import { describe, it, expect } from 'vitest'
import {
  ActuatorDelay,
  actuate,
  delayedTorque,
  makeDelayBuffer,
  piTorque,
  saturate,
} from './controller'
import type { ControllerParams } from './controller'
import { armDynamics } from './arm'
import { rk4Step } from './rk4'

const DT = 1 / 480

function params(over: Partial<ControllerParams> = {}): ControllerParams {
  return {
    Kp: 20,
    Ki: 4,
    gravityCompensation: false,
    tauMax: 6,
    delayMs: 0,
    m: 1,
    L: 0.5,
    g: 9.81,
    ...over,
  }
}

describe('PI torque law', () => {
  it('is purely proportional while the integral is still zero', () => {
    const p = params({ Kp: 10, Ki: 2 })
    const out = piTorque(0.2, 0.5, p, { integral: 0 }, DT)
    expect(out.tau).toBeCloseTo(10 * (0.5 - 0.2), 12)
    expect(out.tauP).toBeCloseTo(3, 12)
    expect(out.tauI).toBe(0)
  })

  it('adds Ki · ∫e, with the integral accumulated over dt', () => {
    const p = params({ Kp: 0, Ki: 3 })
    // error is constant at 0.4 rad for three steps => integral = 3 · 0.4 · dt
    let integral = 0
    for (let i = 0; i < 3; i++) {
      integral = piTorque(0.1, 0.5, p, { integral }, DT).integral
    }
    expect(integral).toBeCloseTo(0.4 * DT * 3, 12)
    expect(piTorque(0.1, 0.5, p, { integral }, DT).tau).toBeCloseTo(3 * integral, 12)
  })

  it('integrates the sign of the error, so it unwinds on overshoot', () => {
    const p = params({ Kp: 0, Ki: 1 })
    let integral = 0
    for (let i = 0; i < 10; i++) integral = piTorque(0, 1, p, { integral }, DT).integral
    const grown = integral
    for (let i = 0; i < 5; i++) integral = piTorque(2, 1, p, { integral }, DT).integral
    expect(grown).toBeGreaterThan(0)
    expect(integral).toBeLessThan(grown)
  })

  it('adds m g (L/2) cos q when gravity compensation is on', () => {
    const arm = { m: 2, L: 0.5, g: 9.81 }
    const off = piTorque(0.4, 0, params({ ...arm }), { integral: 0 }, DT).tau
    const on = piTorque(0.4, 0, params({ ...arm, gravityCompensation: true }), { integral: 0 }, DT).tau
    expect(on - off).toBeCloseTo(arm.m * arm.g * (arm.L / 2) * Math.cos(0.4), 10)
  })
})

describe('integral anti-windup', () => {
  it('freezes the integrator while the actuator is saturated in the same direction', () => {
    const p = params({ Kp: 100, Ki: 5, tauMax: 2 })
    // Large error => command is far past the limit, so nothing accumulates.
    const out = piTorque(0, 1, p, { integral: 0.1 }, DT)
    expect(out.integral).toBeCloseTo(0.1, 12)
  })

  it('caps Ki · ∫e at the actuator torque limit', () => {
    const p = params({ Kp: 0, Ki: 2, tauMax: 2 })
    let integral = 0
    for (let i = 0; i < 2000; i++) integral = piTorque(0, 1, p, { integral }, DT).integral
    // cap = tauMax / Ki = 1
    expect(integral).toBeLessThanOrEqual(1 + 1e-9)
    expect(Math.abs(2 * integral)).toBeLessThanOrEqual(2 + 1e-9)
  })

  it('keeps accumulating when the actuator has headroom', () => {
    const p = params({ Kp: 0, Ki: 2, tauMax: 6 })
    let integral = 0
    for (let i = 0; i < 100; i++) integral = piTorque(0, 1, p, { integral }, DT).integral
    expect(integral).toBeCloseTo(100 * DT, 9)
  })
})

describe('torque saturation', () => {
  it('clips symmetrically and passes values inside the limits', () => {
    expect(saturate(9, 6)).toBe(6)
    expect(saturate(-9, 6)).toBe(-6)
    expect(saturate(2.5, 6)).toBe(2.5)
  })
})

describe('actuator delay buffer', () => {
  it('pull(0) is the newest sample, pull(k) the sample k pushes older', () => {
    const buf = new ActuatorDelay(DT)
    for (let i = 1; i <= 10; i++) buf.push(i)
    expect(buf.pull(0)).toBe(10)
    expect(buf.pull(1)).toBe(9)
    expect(buf.pull(4)).toBe(6)
  })

  it('clamps requests older than the buffered history', () => {
    const buf = new ActuatorDelay(DT)
    buf.push(1)
    buf.push(2)
    expect(buf.pull(5000)).toBe(1)
  })

  it('is empty-safe before any push', () => {
    const buf = new ActuatorDelay(DT)
    expect(buf.pull(0)).toBe(0)
    expect(delayedTorque(buf, 10, DT)).toBe(0)
  })

  it('delays the command by round(delay / dt) samples', () => {
    const buf = makeDelayBuffer(DT)
    const samples = Math.round(0.010 / DT) // 10 ms -> 5 samples
    const out: number[] = []
    for (let i = 0; i < 20; i++) {
      buf.push(i < 10 ? 0 : 3)
      out.push(delayedTorque(buf, 10, DT))
    }
    expect(out[10 + samples - 1]).toBe(0)
    expect(out[10 + samples]).toBe(3)
    expect(samples).toBe(5)
  })
})

describe('actuate: delay then saturation', () => {
  it('applies the torque limit with the delay switched off', () => {
    const buf = makeDelayBuffer(DT)
    const p = params({ tauMax: 2, delayMs: 0 })
    expect(actuate(5, p, buf, DT)).toBe(2)
    expect(actuate(-5, p, buf, DT)).toBe(-2)
  })

  it('still applies the torque limit when a delay is active', () => {
    // Regression: the delay branch used to bypass saturation entirely, so the
    // tau_max slider did nothing as soon as the delay was non-zero.
    const buf = makeDelayBuffer(DT)
    const p = params({ tauMax: 2, delayMs: 10 })
    let last = 0
    for (let i = 0; i < 40; i++) last = actuate(5, p, buf, DT)
    expect(last).toBe(2)
  })

  it('honours an unlimited actuator when tauMax <= 0', () => {
    const buf = makeDelayBuffer(DT)
    const p = params({ tauMax: 0, delayMs: 0 })
    expect(actuate(7.5, p, buf, DT)).toBe(7.5)
  })

  it('replays the command history when the delay is engaged', () => {
    const buf = makeDelayBuffer(DT)
    const p = params({ tauMax: 0, delayMs: 20 }) // 9.6 -> 10 samples
    const samples = Math.round(0.020 / DT)
    const out: number[] = []
    for (let i = 0; i < 30; i++) out.push(actuate(i < 5 ? 0 : 1, p, buf, DT))
    expect(samples).toBe(10)
    expect(out[5 + samples - 1]).toBe(0)
    expect(out[5 + samples]).toBe(1)
  })
})

describe('closed loop robustness: delay destabilises', () => {
  /** Run the PI + delay closed loop from a displaced start; return final q. */
  function settle(delayMs: number, seconds: number, startQ = 0.2): { final: number; rmsTail: number } {
    const p = params({ Kp: 20, Ki: 2, g: 0, delayMs, tauMax: 0 })
    const buf = makeDelayBuffer(DT)
    const arm = { m: p.m, L: p.L, g: p.g, b: 0.05 }
    let x = [startQ, 0]
    let integral = 0
    const steps = Math.round(seconds / DT)
    let acc = 0
    let n = 0
    for (let i = 0; i < steps; i++) {
      const pi = piTorque(x[0], 0, p, { integral }, DT)
      integral = pi.integral
      const tau = actuate(pi.tau, p, buf, DT)
      x = rk4Step((s) => armDynamics(s, arm, tau), x, i * DT, DT)
      if (i * DT >= seconds - 1) {
        acc += x[0] * x[0]
        n++
      }
    }
    return { final: x[0], rmsTail: Math.sqrt(acc / Math.max(1, n)) }
  }

  it('without delay the loop decays towards the target', () => {
    // Kp=20, Ki=2 sits well inside the Routh limit (b k_eff / J = 12), so the
    // slow integral pole still lets the oscillation die out.
    const early = settle(0, 7).rmsTail
    const late = settle(0, 29).rmsTail
    expect(late).toBeLessThan(early * 0.3)
  })

  it('with 60 ms of delay the same loop grows without bound', () => {
    // Phase lag from the transport delay eats the stability margin the
    // undelayed loop had — the reason delay is dangerous in real arms.
    const r = settle(60, 8)
    expect(Number.isFinite(r.final)).toBe(true)
    expect(Math.abs(r.final)).toBeGreaterThan(1e3)
  })
})
