import { PRESETS, presetParams } from './presets'
import type { PresetName } from './presets'
import { piTorque, actuate, makeDelayBuffer } from './controller'
import type { ControllerParams } from './controller'
import { armDynamics } from './arm'
import { rk4Step } from './rk4'
import type { SimParams } from '../hooks/useSimulation'

const DT = 1 / 480
/** Store one point every 8 physics steps: 60 Hz, plenty for drawing. */
const SAMPLE_EVERY = 8

export interface ModeCurvePoint {
  t: number
  q: number
}

export interface ModeCurvesInput {
  params: SimParams
  /** Release state: where the arm is now, and how fast it is moving. */
  q: number
  qdot: number
  qTarget: number
  /** How far ahead to look. */
  seconds?: number
}

/**
 * Simulate, for every preset, the trajectory the arm would follow if that mode
 * were chosen right now — same arm, same setpoint, same release state, only the
 * controller differs. This is what lets one plot answer "what would the other
 * modes do?" without the user clicking through them.
 *
 * Each curve runs the production pipeline exactly as `useSimulation` does:
 * PI torque with anti-windup → actuator delay and saturation → RK4 on the
 * nonlinear plant, with the integral starting from zero as a preset click does.
 */
export function modeCurves({
  params,
  q,
  qdot,
  qTarget,
  seconds = 6,
}: ModeCurvesInput): Record<PresetName, ModeCurvePoint[]> {
  const out = {} as Record<PresetName, ModeCurvePoint[]>
  const steps = Math.round(seconds / DT)

  for (const { name } of PRESETS) {
    const over = presetParams(
      name,
      { Kp: params.Kp, m: params.m, L: params.L, g: params.g, b: params.b },
      qTarget,
    )
    const ctrl: ControllerParams = {
      Kp: over.Kp ?? params.Kp,
      Ki: over.Ki ?? 0,
      m: params.m,
      L: params.L,
      g: params.g,
      gravityCompensation: over.gravityCompensation ?? false,
      tauMax: over.tauMax ?? 0,
      delayMs: over.delayMs ?? 0,
    }
    const arm = { m: params.m, L: params.L, g: params.g, b: over.b ?? params.b }
    const buffer = makeDelayBuffer(DT)

    let x = [q, qdot]
    let integral = 0
    const pts: ModeCurvePoint[] = [{ t: 0, q }]

    for (let i = 1; i <= steps; i++) {
      const pi = piTorque(x[0], qTarget, ctrl, { integral }, DT)
      integral = pi.integral
      const tau = actuate(pi.tau, ctrl, buffer, DT)
      x = rk4Step((s) => armDynamics(s, arm, tau), x, (i - 1) * DT, DT)
      // A runaway curve is still data — it just leaves the plot's window.
      if (!Number.isFinite(x[0])) break
      if (i % SAMPLE_EVERY === 0) pts.push({ t: i * DT, q: x[0] })
    }
    out[name] = pts
  }

  return out
}
