import { useCallback, useMemo, useState } from 'react'
import type { SimParams } from '../hooks/useSimulation'

interface PythonPanelProps {
  params: SimParams
  qTarget: number
  J: number
  kEff: number
  KiCrit: number
}

/**
 * Build a standalone Python script that reproduces exactly this loop.
 *
 * Values are baked in from the current sliders so the file always matches what
 * is on screen; nothing is imported from the app, and only the standard
 * library is used, so it runs anywhere Python 3 does.
 */
export function buildScript(p: SimParams, qTarget: number, J: number): string {
  const n = (x: number, d = 4) => (Number.isFinite(x) ? x.toFixed(d) : '0.0')
  return `"""
PI control of a one-joint robot arm
===================================

Mirrors the simulation in the browser: same plant, same gains, same
third-order closed loop. Run it to watch the arm settle, ring or run away,
and to see the poles that predict which of those happens.

    python arm_pi.py
"""

import math

# ------------------------------------------------------------------ plant ---
m = ${n(p.m, 2)}          # kg          arm mass
L = ${n(p.L, 2)}          # m           arm length, pivot to tip
g = ${n(p.g, 2)}          # m/s^2       gravity
b = ${n(p.b, 4)}          # N*m*s/rad   joint friction
J = ${n(J, 6)}          # kg*m^2      inertia about the pivot (m L^2 / 3)

# ------------------------------------------------------------- controller ---
Kp = ${n(p.Kp, 3)}          # N*m/rad
Ki = ${n(p.Ki, 3)}          # N*m/(rad*s)  integral gain
q_star = ${n(qTarget, 4)}      # rad         setpoint
tau_max = ${n(p.tauMax, 2)}        # N*m         actuator limit (0 = none)
delay_ms = ${n(p.delayMs, 1)}        # ms          drive delay

dt = 1.0 / 480.0      # s           integration step, same as the page

# ------------------------------- stiffness, and the stability boundary ------
# Gravity acts like a spring: differentiate its torque at the setpoint.
k_eff = Kp - m * g * (L / 2.0) * math.sin(q_star)
ki_crit = b * k_eff / J if k_eff > 0 else 0.0

print("k_eff   = %8.4f N*m/rad" % k_eff)
print("Ki_crit = %8.4f N*m/(rad*s)   (stable only below this)" % ki_crit)
print("margin  = %8.4f              b*k_eff - J*Ki" % (b * k_eff - J * Ki))

# ------------------------------------------- poles of the closed loop -------
# J s^3 + b s^2 + k_eff s + Ki = 0

def polyval(coeffs, x):
    total = 0j
    for c in coeffs:
        total = total * x + c
    return total

def poles(coeffs, iterations=400):
    """All roots by Durand-Kerner: no numpy needed."""
    n_roots = len(coeffs) - 1
    monic = [c / coeffs[0] for c in coeffs]
    roots = [complex(0.4, 0.9) ** (k + 1) for k in range(n_roots)]
    for _ in range(iterations):
        for i in range(n_roots):
            denom = 1 + 0j
            for j in range(n_roots):
                if i != j:
                    denom *= roots[i] - roots[j]
            roots[i] -= polyval(monic, roots[i]) / denom
    return roots

roots = poles([J, b, k_eff, Ki])
for i, r in enumerate(roots, 1):
    print("s%d      = %+8.3f %+8.3fj" % (i, r.real, r.imag))
print("stable  = %s" % all(r.real < 0 for r in roots))

# ---------------------------------------------------- the plant's own ODE ---
def plant(q, qdot, tau):
    """J q'' = tau - b q' - m g (L/2) cos q"""
    qddot = (tau - b * qdot - m * g * (L / 2.0) * math.cos(q)) / J
    return qdot, qddot

def simulate(q, qdot, seconds, delay_steps):
    """RK4 on the closed loop, with a FIFO standing in for drive delay."""
    integral = 0.0
    queue = [0.0] * max(1, delay_steps)
    steps = int(seconds / dt)
    for i in range(steps):
        error = q_star - q
        command = Kp * error + Ki * integral
        integral += error * dt

        if delay_steps:
            queue.append(command)
            tau = queue.pop(0)
        else:
            tau = command
        if tau_max > 0:
            tau = max(-tau_max, min(tau_max, tau))

        k1 = plant(q, qdot, tau)
        k2 = plant(q + 0.5 * dt * k1[0], qdot + 0.5 * dt * k1[1], tau)
        k3 = plant(q + 0.5 * dt * k2[0], qdot + 0.5 * dt * k2[1], tau)
        k4 = plant(q + dt * k3[0], qdot + dt * k3[1], tau)
        q += dt / 6.0 * (k1[0] + 2.0 * k2[0] + 2.0 * k3[0] + k4[0])
        qdot += dt / 6.0 * (k1[1] + 2.0 * k2[1] + 2.0 * k3[1] + k4[1])

        if i % 240 == 0:
            print("t = %5.2fs   q = %+.4f rad   qdot = %+.3f rad/s" % (i * dt, q, qdot))

    return q

print()
print("released 0.30 rad away from the setpoint:")
simulate(0.30, 0.0, 4.0, int(round(delay_ms / 1000.0 / dt)))
`
}

export default function PythonPanel({ params, qTarget, J, kEff, KiCrit }: PythonPanelProps) {
  const [copied, setCopied] = useState(false)
  const script = useMemo(() => buildScript(params, qTarget, J), [params, qTarget, J])

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(script)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      setCopied(false)
    }
  }, [script])

  const download = useCallback(() => {
    const blob = new Blob([script], { type: 'text/x-python' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'arm_pi.py'
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }, [script])

  return (
    <section className="python-panel" aria-label="Python script for this controller">
      <header className="python-head">
        <h2 className="panel-title">Same loop, in Python</h2>
        <div className="python-actions">
          <button type="button" className="python-btn" onClick={copy} aria-live="polite">
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button type="button" className="python-btn" onClick={download}>
            Download .py
          </button>
        </div>
      </header>
      <p className="python-lede">
        Generated from the sliders above: the plant ODE, the explicit RK4 step, the integral term and the cubic
        that predicts stability (k_eff = {kEff.toFixed(3)}, K_i,crit = {KiCrit.toFixed(2)}). Standard library
        only — save it, run it, and compare the printed poles with the equations above.
      </p>
      <pre className="python-code" tabIndex={0} aria-label="Generated Python source">
        <code>{script}</code>
      </pre>
    </section>
  )
}
