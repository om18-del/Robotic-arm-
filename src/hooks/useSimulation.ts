import { useRef, useState, useCallback, useEffect, useMemo } from 'react'
import { rk4Step } from '../sim/rk4'
import { armDynamics, momentOfInertia } from '../sim/arm'
import { piTorque, actuate, makeDelayBuffer } from '../sim/controller'
import { linearize } from '../sim/analysis'
import type { Pole } from '../sim/analysis'
import { presetParams } from '../sim/presets'
import type { PresetName } from '../sim/presets'

// physics timestep
const DT = 1 / 480
/**
 * How much backlog one frame is allowed to carry, in seconds. The loop drains
 * it with fixed 1/480 s steps, so this also sets the frame rate down to which
 * the simulation runs in real time: at 0.1 s it tracks wall-clock time all the
 * way to ~10 fps instead of falling behind (the 0.05 s it used to allow was
 * exactly one 60 Hz frame's worth, so anything slower drifted into slow
 * motion). It stays finite so a backgrounded tab does not replay a long catch-up.
 */
const MAX_FRAME_ACCUM = 0.1
/** RK4 steps needed to drain that backlog inside a single frame. */
const MAX_STEPS_PER_FRAME = Math.ceil(MAX_FRAME_ACCUM / DT)

export interface SimParams {
  Kp: number
  Ki: number
  /** Fixed arm mass — a physical property of the rig, not a control knob. */
  m: number
  L: number
  g: number
  /** Fixed joint friction. */
  b: number
  gravityCompensation: boolean
  tauMax: number
  delayMs: number
}

export interface SimState {
  q: number
  qdot: number
  t: number
  tau: number
}

export interface TorqueBreakdown {
  tauP: number
  tauI: number
  tauGravity: number
  tauDamping: number
}

export interface SimResult {
  history: Array<{ t: number; q: number; qdot: number; tau: number }>
  J: number
  t: number
  tauBreakdown: TorqueBreakdown
  kEff: number
  omegaN: number
  zetaMech: number
  poles: [Pole, Pole, Pole]
  dominant: Pole
  KiCrit: number
  routhMargin: number
  stable: boolean
  regime: 'underdamped' | 'critically-damped' | 'overdamped' | 'unstable'
}

export interface UseSimulationReturn {
  state: SimState
  params: SimParams
  qTarget: number
  paused: boolean
  timeScale: number
  setTarget: (px: number, py: number) => void
  setQTarget: (q: number) => void
  setParams: (p: Partial<SimParams>) => void
  setPaused: (v: boolean) => void
  setTimeScale: (ts: number) => void
  applyDisturbance: () => void
  resetIntegral: () => void
  simResult: SimResult
  presets: (name: PresetName) => void
  snapToCritical: () => void
  /** Read-only refs for the 3D arm view. These do not drive the simulation. */
  qRef: { current: number }
  qTargetRef: { current: number }
  regimeRef: { current: string }
  LRef: { current: number }
}

const MAX_HISTORY = 2400 // 5 s at dt=1/480
/** Velocity kick given when a preset is chosen, rad/s. */
const PRESET_KICK = 1.2

const DEFAULTS: SimParams = {
  Kp: 20,
  Ki: 4,
  m: 1.0,
  L: 0.5,
  g: 9.81,
  b: 0.05,
  gravityCompensation: false,
  tauMax: 6,
  delayMs: 0,
}

export function useSimulation(): UseSimulationReturn {
  const stateRef = useRef<SimState>({ q: 0, qdot: 0, t: 0, tau: 0 })
  const paramsRef = useRef<SimParams>({ ...DEFAULTS })
  const qTargetRef = useRef(0)
  const pausedRef = useRef(false)
  const timeScaleRef = useRef(1)
  const delayBufferRef = useRef(makeDelayBuffer(DT))
  const historyRef = useRef<Array<{ t: number; q: number; qdot: number; tau: number }>>([])
  const rafRef = useRef<number | null>(null)
  const lastTimeRef = useRef<number>(0)
  const accRef = useRef(0)
  const regimeRefInternal = useRef<'underdamped' | 'critically-damped' | 'overdamped' | 'unstable'>('underdamped')
  const integralRef = useRef(0)

  // Plain refs that mirror the latest simulated values. Read in useFrame; not
  // React state, so the 3D scene stays off the React render path.
  const qRef = useRef(0)
  const LRef = useRef(paramsRef.current.L)

  const [state, setState] = useState<SimState>(() => ({ ...stateRef.current }))
  const [params, setParamsState] = useState<SimParams>(() => ({ ...paramsRef.current }))
  const [qTarget, setQTargetState] = useState(0)
  const [paused, setPausedState] = useState(false)
  const [timeScale, setTimeScaleState] = useState(1)
  // Seed the analysis from the initial parameters instead of a zeroed dummy, so
  // the equations never briefly show NaN / −Infinity before the first frame.
  const [simResult, setSimResult] = useState<SimResult>(() => {
    const p = paramsRef.current
    const lin = linearize({ Kp: p.Kp, Ki: p.Ki, m: p.m, L: p.L, g: p.g, b: p.b, qStar: 0 })
    return {
      history: [],
      J: lin.J,
      t: 0,
      tauBreakdown: { tauP: 0, tauI: 0, tauGravity: 0, tauDamping: 0 },
      kEff: lin.kEff,
      omegaN: lin.omegaN,
      zetaMech: lin.zetaMech,
      poles: lin.poles,
      dominant: lin.dominant,
      KiCrit: lin.KiCrit,
      routhMargin: lin.routhMargin,
      stable: lin.stable,
      regime: lin.regime,
    }
  })

  /**
   * The linearised model depends only on the parameters, never on q(t), so it
   * is derived here rather than inside the animation loop. When the browser
   * throttles rAF (background tab, occluded window) the equations still track
   * the sliders instead of freezing on stale numbers.
   */
  const analysis = useMemo(
    () =>
      linearize({
        Kp: params.Kp,
        Ki: params.Ki,
        m: params.m,
        L: params.L,
        g: params.g,
        b: params.b,
        qStar: qTarget,
      }),
    [params.Kp, params.Ki, params.m, params.L, params.g, params.b, qTarget],
  )

  useEffect(() => {
    regimeRefInternal.current = analysis.regime
    LRef.current = params.L
  }, [analysis.regime, params.L])

  const syncStateFromRef = useCallback(() => {
    setState({ ...stateRef.current })
  }, [])

  const syncParamsFromRef = useCallback(() => {
    setParamsState({ ...paramsRef.current })
  }, [])

  const syncTargetFromRef = useCallback(() => {
    setQTargetState(qTargetRef.current)
  }, [])

  // Exposed setters
  const setTarget = useCallback((px: number, py: number) => {
    const dx = px
    const dy = -py
    let q = Math.atan2(dy, dx)
    const lim = Math.PI / 2
    if (q > lim) q = lim
    if (q < -lim) q = -lim
    qTargetRef.current = q
    setQTargetState(q)
  }, [])

  const setQTarget = useCallback((q: number) => {
    qTargetRef.current = q
    setQTargetState(q)
  }, [])

  const setParams = useCallback((p: Partial<SimParams>) => {
    paramsRef.current = { ...paramsRef.current, ...p }
    setParamsState({ ...paramsRef.current })
  }, [])

  const setPaused = useCallback((v: boolean) => {
    pausedRef.current = v
    setPausedState(v)
  }, [])

  const setTimeScale = useCallback((ts: number) => {
    timeScaleRef.current = ts
    setTimeScaleState(ts)
  }, [])

  const applyDisturbance = useCallback(() => {
    // impulse: add to qdot (a shove, like a load landing on the tool)
    stateRef.current.qdot += 2.0
  }, [])

  const resetIntegral = useCallback(() => {
    integralRef.current = 0
  }, [])

  // Simulation step
  const step = useCallback(() => {
    const s = stateRef.current
    const p = paramsRef.current
    const qStar = qTargetRef.current

    // PI controller (zero-order hold across the RK4 step), then the actuator
    // chain: transport delay -> torque limit.
    const pi = piTorque(s.q, qStar, p, { integral: integralRef.current }, DT)
    integralRef.current = pi.integral
    const tauUsed = actuate(pi.tau, p, delayBufferRef.current, DT)

    // Plant: J q̈ + b q̇ + m g (L/2) cos q = τ
    const f = (x: number[]) => armDynamics(x, { m: p.m, L: p.L, g: p.g, b: p.b }, tauUsed)
    const next = rk4Step(f, [s.q, s.qdot], s.t, DT)

    stateRef.current = {
      q: next[0],
      qdot: next[1],
      t: s.t + DT,
      tau: tauUsed,
    }

    // history (throttle to ~60 Hz sampling for the plot)
    const hist = historyRef.current
    const last = hist[hist.length - 1]
    if (!last || s.t - last.t >= 1 / 60) {
      hist.push({ t: s.t, q: next[0], qdot: next[1], tau: tauUsed })
      if (hist.length > MAX_HISTORY) hist.shift()
    }
  }, [])

  // Step the sim enough times to catch up, called each animation frame
  useEffect(() => {
    lastTimeRef.current = performance.now()
    accRef.current = 0

    const loop = (now: number) => {
      if (!pausedRef.current) {
        const frameMs = Math.min(now - lastTimeRef.current, MAX_FRAME_ACCUM * 1000)
        lastTimeRef.current = now
        accRef.current += (frameMs / 1000) * timeScaleRef.current
        if (accRef.current > MAX_FRAME_ACCUM) accRef.current = MAX_FRAME_ACCUM
        let steps = 0
        while (accRef.current >= DT && steps < MAX_STEPS_PER_FRAME) {
          step()
          accRef.current -= DT
          steps++
        }
      } else {
        lastTimeRef.current = now
      }

      // The 3D arm draws itself from this ref on every rendered frame, so it
      // must be refreshed here rather than inside the 30 Hz React sync below —
      // the arm is the one thing that should never render a stale angle.
      qRef.current = stateRef.current.q

      // Push React state at ~30 Hz: the equations stay readable, the 3D scene
      // reads refs directly at full frame rate instead of waiting for renders.
      if (Math.floor(now / 33) !== Math.floor((now - 16) / 33)) {
        syncStateFromRef()
        syncParamsFromRef()
        syncTargetFromRef()

        const p = paramsRef.current
        const s = stateRef.current

        const qStar = qTargetRef.current
        const error = qStar - s.q
        // Analysis fields are filled in from the parameter-derived model just
        // below; this state only carries the live, q(t)-dependent numbers.
        setSimResult((prev) => ({
          ...prev,
          history: historyRef.current,
          t: s.t,
          tauBreakdown: {
            tauP: p.Kp * error,
            tauI: p.Ki * integralRef.current,
            tauGravity: p.m * p.g * (p.L / 2) * Math.cos(s.q),
            tauDamping: -p.b * s.qdot,
          },
        }))
      }
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [step, syncStateFromRef, syncParamsFromRef, syncTargetFromRef])

  /**
   * The four damping regimes. Gains alone cannot produce critical or
   * overdamped response without a derivative term — the only damping in the
   * loop is the joint's own friction b — so those presets also damp the joint,
   * which the live equation and readouts show. `sim/presets.ts` computes the
   * critical gain from the current Kp and setpoint rather than hard-coding it.
   */
  const presets = useCallback((name: PresetName) => {
    integralRef.current = 0
    setParams(presetParams(name, paramsRef.current, qTargetRef.current))
    // Start the demonstration from rest, so the response belongs to the mode
    // just chosen instead of carrying the previous mode's swing (switching away
    // from "Unstable" would otherwise leave the arm thrashing for a long time).
    // Then nudge it: with the arm already sitting on its target there is no
    // error, so changing gains alone would look like nothing happened.
    stateRef.current.qdot = PRESET_KICK
  }, [setParams])

  const snapToCritical = useCallback(() => {
    const p = paramsRef.current
    const lin = linearize({ Kp: p.Kp, Ki: p.Ki, m: p.m, L: p.L, g: p.g, b: p.b, qStar: qTargetRef.current })
    // Sit just inside the stability boundary: 95% of the Routh–Hurwitz ceiling.
    setParams({ Ki: Math.max(0.01, 0.95 * lin.KiCrit) })
  }, [setParams])

  // Live numbers (history, torque) plus the parameter-derived model. Merging
  // here means the equations can never show a pole set that belongs to an
  // older gain value.
  const mergedResult: SimResult = {
    ...simResult,
    J: analysis.J,
    kEff: analysis.kEff,
    omegaN: analysis.omegaN,
    zetaMech: analysis.zetaMech,
    poles: analysis.poles,
    dominant: analysis.dominant,
    KiCrit: analysis.KiCrit,
    routhMargin: analysis.routhMargin,
    stable: analysis.stable,
    regime: analysis.regime,
  }

  return {
    state,
    params,
    qTarget,
    paused,
    timeScale,
    setTarget,
    setQTarget,
    setParams,
    setPaused,
    setTimeScale,
    applyDisturbance,
    resetIntegral,
    simResult: mergedResult,
    presets,
    snapToCritical,
    qRef,
    qTargetRef,
    regimeRef: regimeRefInternal,
    LRef,
  }
}

export { momentOfInertia, DT }
