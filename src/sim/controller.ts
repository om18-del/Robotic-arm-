export interface ControllerParams {
  Kp: number
  Ki: number
  gravityCompensation: boolean
  tauMax: number
  delayMs: number
  m: number
  L: number
  g: number
}

const DELAY_BUFFER_LENGTH = 2048 // enough for 100ms at dt=1/480

export class ActuatorDelay {
  private ring: number[] = new Array(DELAY_BUFFER_LENGTH).fill(0)
  private head = 0
  private count = 0

  constructor(_dt: number) {
    this.clear()
  }

  clear() {
    this.ring.fill(0)
    this.head = 0
    this.count = 0
  }

  push(value: number) {
    this.ring[this.head] = value
    this.head = (this.head + 1) % DELAY_BUFFER_LENGTH
    if (this.count < DELAY_BUFFER_LENGTH) this.count++
  }

  /**
   * Value written `samplesAgo` pushes before the most recent one.
   * pull(0) is the newest sample, pull(1) the one before it, and so on.
   * Requests older than the buffered history return the oldest sample.
   */
  pull(samplesAgo: number): number {
    if (this.count === 0) return 0
    const age = Math.min(Math.max(0, Math.round(samplesAgo)), this.count - 1)
    const idx = (this.head - 1 - age + DELAY_BUFFER_LENGTH) % DELAY_BUFFER_LENGTH
    return this.ring[idx]
  }
}

export interface PIControllerState {
  /** ∫ (q* − q) dt, in rad·s. */
  integral: number
}

/**
 * PI torque law.
 *
 *   τ = Kp (q* − q) + Ki ∫ (q* − q) dt
 *
 * The integral term is what removes the steady-state droop a pure P loop
 * leaves under gravity: it keeps pushing until the error has been zero for
 * long enough that the accumulated error stops changing.
 *
 * Anti-windup: the integrator stops accumulating while the actuator is
 * saturated in the same direction, and the integral term is capped so that
 * `Ki · ∫e` can never ask for more torque than the motor can deliver.
 * Without this the arm sleeps through a long saturated approach and then
 * overshoots hard.
 */
export function piTorque(
  q: number,
  qTarget: number,
  p: ControllerParams,
  state: PIControllerState,
  dt: number,
): { tau: number; integral: number; error: number; tauP: number; tauI: number } {
  const error = qTarget - q
  const limit = p.tauMax > 0 ? p.tauMax : Infinity

  // Output uses the integral accumulated *so far*, so at t = 0 the response is
  // exactly proportional. The integral is advanced afterwards, which is what
  // makes this the discrete form of τ = Kp e + Ki ∫e dt.
  const tauP = p.Kp * error
  const tauI = p.Ki * state.integral
  const piCommand = tauP + tauI

  // Integrate unless the error is pushing an already-saturated actuator.
  const pushingIntoLimit =
    Number.isFinite(limit) &&
    Math.abs(piCommand) >= limit &&
    Math.sign(piCommand) === Math.sign(error)

  let integral = pushingIntoLimit ? state.integral : state.integral + error * dt

  // Clamp the integral term's authority to the actuator's own reach. With the
  // limit switched off there is nothing to clamp to, so the integrator is left
  // free — capping it there would quietly break the linear model the panel
  // analyses (the two must stay the same system).
  if (Number.isFinite(limit) && Math.abs(p.Ki) > 1e-9) {
    const cap = limit / Math.abs(p.Ki)
    if (integral > cap) integral = cap
    if (integral < -cap) integral = -cap
  }

  let tau = piCommand
  if (p.gravityCompensation) {
    tau += p.m * p.g * (p.L / 2) * Math.cos(q)
  }

  return { tau, integral, error, tauP, tauI }
}

/** Apply saturation to a torque value. */
export function saturate(tau: number, tauMax: number): number {
  if (tau > tauMax) return tauMax
  if (tau < -tauMax) return -tauMax
  return tau
}

/** Build a delay buffer for actuator delay. Ring buffer of past tau_cmd values. */
export function makeDelayBuffer(dt: number): ActuatorDelay {
  return new ActuatorDelay(dt)
}

/** Resolve the delayed torque given the buffer and current delay setting (ms). */
export function delayedTorque(buffer: ActuatorDelay, delayMs: number, dt: number): number {
  if (delayMs <= 0) return buffer.pull(0)
  const samplesAgo = Math.round(delayMs / 1000 / dt)
  return buffer.pull(Math.max(0, samplesAgo))
}

/**
 * The actuator chain: the command is time-shifted by the drive delay, then
 * clipped at the motor's torque limit. `tauMax <= 0` disables the limit.
 *
 * Doing the delay before the clip matters: an over-driven command should be
 * limited when it reaches the motor, not before it enters the drive.
 */
export function actuate(
  tauCmd: number,
  p: ControllerParams,
  buffer: ActuatorDelay,
  dt: number,
): number {
  buffer.push(tauCmd)
  const shaped = p.delayMs > 0 ? delayedTorque(buffer, p.delayMs, dt) : tauCmd
  return p.tauMax > 0 ? saturate(shaped, p.tauMax) : shaped
}
