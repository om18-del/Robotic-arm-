export type F = (x: number[], t: number) => number[]

/**
 * Fixed-step RK4 integrator.
 * f(x, t) returns dx/dt as a number array of the same length as x.
 * The new state is returned; x is not mutated.
 */
export function rk4Step(f: F, x: number[], t: number, dt: number): number[] {
  const n = x.length
  const k1 = f(x, t)

  const x2: number[] = new Array(n)
  for (let i = 0; i < n; i++) x2[i] = x[i] + 0.5 * dt * k1[i]
  const k2 = f(x2, t + 0.5 * dt)

  const x3: number[] = new Array(n)
  for (let i = 0; i < n; i++) x3[i] = x[i] + 0.5 * dt * k2[i]
  const k3 = f(x3, t + 0.5 * dt)

  const x4: number[] = new Array(n)
  for (let i = 0; i < n; i++) x4[i] = x[i] + dt * k3[i]
  const k4 = f(x4, t + dt)

  const out: number[] = new Array(n)
  for (let i = 0; i < n; i++) {
    out[i] = x[i] + (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i])
  }
  return out
}
