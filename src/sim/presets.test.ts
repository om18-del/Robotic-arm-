import { describe, it, expect } from 'vitest'
import { PRESETS, criticalKi, presetParams, presetResult } from './presets'
import type { PresetInput, PresetName } from './presets'
import { piTorque } from './controller'
import { armDynamics } from './arm'
import { rk4Step } from './rk4'
import type { ControllerParams } from './controller'

const DT = 1 / 480

const BASE: PresetInput = { Kp: 20, m: 1, L: 0.5, g: 9.81, b: 0.05 }

/** Full controller params a preset would produce, with the arm's real gravity. */
function paramsFor(name: PresetName): ControllerParams {
  const over = presetParams(name, BASE, 0)
  return {
    Kp: over.Kp ?? BASE.Kp,
    Ki: over.Ki ?? 0,
    m: BASE.m,
    L: BASE.L,
    g: BASE.g,
    gravityCompensation: false,
    tauMax: 6,
    delayMs: 0,
  }
}

/**
 * Release the arm 0.2 rad from the setpoint through the real pipeline and
 * report the signature of the response: how far it dips past the target, how
 * often it crosses, when it finally settles, and how much motion is left at
 * the end. A stable non-ringing loop crosses at most once (gravity sags it,
 * the integrator brings it back) and then stops; an unstable one keeps going.
 */
function simulate(name: PresetName, seconds: number) {
  const p = paramsFor(name)
  const arm = { m: p.m, L: p.L, g: p.g, b: presetParams(name, BASE, 0).b ?? BASE.b }
  let x = [0.2, 0]
  let integral = 0
  let dip = 0
  let crossings = 0
  let sign = 1
  let settle = Infinity
  let tail = 0
  const steps = Math.round(seconds / DT)
  for (let i = 0; i < steps; i++) {
    const pi = piTorque(x[0], 0, p, { integral }, DT)
    integral = pi.integral
    const tau = Math.max(-p.tauMax, Math.min(p.tauMax, pi.tau))
    x = rk4Step((s) => armDynamics(s, arm, tau), x, i * DT, DT)
    if (!Number.isFinite(x[0])) return { final: NaN, dip: NaN, crossings: NaN, settle: NaN, tail: NaN }
    dip = Math.max(dip, -x[0])
    const sg = Math.abs(x[0]) > 0.002 ? Math.sign(x[0]) : sign
    if (sg !== sign) {
      crossings++
      sign = sg
    }
    if (Math.abs(x[0]) > 0.005) settle = (i + 1) * DT
    if (i * DT > seconds - 2) tail = Math.max(tail, Math.abs(x[0]))
  }
  return { final: x[0], dip, crossings, settle, tail }
}

describe('every preset lands in the regime on its button', () => {
  it('keeps the four classic labels', () => {
    expect(PRESETS.map((p) => p.label)).toEqual([
      'Underdamped',
      'Critically damped',
      'Overdamped',
      'Unstable',
    ])
  })

  for (const preset of PRESETS) {
    it(`${preset.label} — linearised regime is "${preset.name}"`, () => {
      const r = presetResult(preset.name, BASE, 0)
      expect(r.regime).toBe(preset.name)
      if (preset.name === 'unstable') {
        expect(r.stable).toBe(false)
        expect(Math.max(...r.poles.map((s) => s.re))).toBeGreaterThan(0)
      } else {
        expect(r.stable).toBe(true)
        expect(r.poles.every((s) => s.re < 0)).toBe(true)
      }
    })
  }

  it('critical damping needs a damped joint: with b = 0.05 the cubic is never all-real', () => {
    // The point of damping the joint in two of the presets: no derivative gain
    // means joint friction is the only damping available to the loop.
    const light = presetResult('underdamped', BASE, 0)
    expect(light.poles.some((s) => Math.abs(s.im) > 1e-6)).toBe(true)
    // A light joint has no critical gain at all, so the presets that need one
    // supply their own b.
    expect(criticalKi(0.05, 20, (1 * 0.25) / 3)).toBe(0)
    expect(criticalKi(4, 20, (1 * 0.25) / 3)).toBeGreaterThan(20)
  })
})

describe('and the arm actually moves that way', () => {
  it('underdamped keeps ringing instead of settling', () => {
    const r = simulate('underdamped', 12)
    // A light joint at this gain is barely damped: many crossings, still
    // moving several degrees two minutes-of-sim later.
    expect(r.crossings).toBeGreaterThan(5)
    expect(r.tail).toBeGreaterThan(0.02)
    expect(r.dip).toBeGreaterThan(0.2)
  })

  it('critically damped returns to the target without ringing', () => {
    const r = simulate('critically-damped', 12)
    expect(Math.abs(r.final)).toBeLessThan(0.01)
    // At most one crossing: the dip is gravity sag that the integrator removes,
    // not an oscillation.
    expect(r.crossings).toBeLessThanOrEqual(1)
    expect(r.tail).toBeLessThan(0.005)
    expect(r.settle).toBeLessThan(4)
  })

  it('overdamped also returns without ringing, but more slowly than critical', () => {
    const crit = simulate('critically-damped', 12)
    const over = simulate('overdamped', 12)
    expect(Math.abs(over.final)).toBeLessThan(0.01)
    expect(over.crossings).toBeLessThanOrEqual(1)
    expect(over.tail).toBeLessThan(0.005)
    // Same joint, lower integral gain: the slow real pole dominates, so the
    // tail takes longer to fall inside the settling band.
    expect(over.settle).toBeGreaterThan(crit.settle * 1.5)
  })

  it('unstable never settles — saturation turns the runaway into a sustained oscillation', () => {
    const r = simulate('unstable', 12)
    expect(r.tail).toBeGreaterThan(0.1)
    // Unlike the two damped modes, it is still swinging as widely at the end as
    // it did on the way in.
    expect(r.tail).toBeGreaterThan(0.5 * r.dip)
  })
})
