export interface ArmParams {
  m: number // kg
  L: number // m
  g: number // m/s^2
  b: number // N·m·s/rad
}

export function momentOfInertia(m: number, L: number): number {
  return (m * L * L) / 3
}

/**
 * State x = [q, qdot]. Returns dx/dt = [qdot, qddot].
 * q is angle from horizontal (rad). No clamping here.
 */
export function armDynamics(x: number[], p: ArmParams, tau: number): number[] {
  const [q, qdot] = x
  const J = momentOfInertia(p.m, p.L)
  const qddot = (tau - p.b * qdot - p.m * p.g * (p.L / 2) * Math.cos(q)) / J
  return [qdot, qddot]
}

/** Mechanical energy of the uniform rod about the pivot.
 *
 * Coordinate q is the angle from horizontal (rad).
 * Gravity acts in -y direction. The pivot is at the origin.
 *
 * Centre-of-mass position of a uniform rod of length L pivoted at one end:
 *   r_cm = (L/2)[cos(q), sin(q)]
 *
 * With gravity pointing downward (negative y), the gravitational potential is
 *   PE = m * g * y_cm = m * g * (L/2) * sin(q)
 *
 * (Choosing y = 0 at the pivot; this matches the dynamics where the gravity
 *  torque is -dPE/dq = -m g (L/2) cos(q), consistent with armDynamics.)
 */
export function armEnergy(x: number[], p: ArmParams): number {
  const [q, qdot] = x
  const m = p.m
  const L = p.L
  const g = p.g
  // KE = 1/2 * J * qdot^2, J = m L^2 / 3
  const J = momentOfInertia(m, L)
  const ke = 0.5 * J * qdot * qdot
  // PE = m g y_cm, with y_cm = (L/2) sin(q)
  const pe = m * g * (L / 2) * Math.sin(q)
  return ke + pe
}
