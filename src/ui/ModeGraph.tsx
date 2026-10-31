import { useEffect, useMemo, useRef, useState } from 'react'
import { PRESETS } from '../sim/presets'
import type { PresetName } from '../sim/presets'
import { modeCurves } from '../sim/modeCurves'
import type { SimParams } from '../hooks/useSimulation'

interface ModeGraphProps {
  params: SimParams
  q: number
  qdot: number
  qTarget: number
  history: Array<{ t: number; q: number; qdot: number; tau: number }>
  active: PresetName | null
}

/** Badge colours used in the 3D scene, so the legend matches the overlay. */
const COLORS: Record<PresetName, string> = {
  underdamped: '#5aff8a',
  'critically-damped': '#ffd24a',
  overdamped: '#7aa2ff',
  unstable: '#ff5d5d',
}

const LABELS: Record<PresetName, string> = {
  underdamped: 'Underdamped',
  'critically-damped': 'Critically damped',
  overdamped: 'Overdamped',
  unstable: 'Unstable',
}

/** Plot window: how much of the past (the white trace) and future to show. */
const PAST_S = 5
const FUTURE_S = 6

const PAD = { top: 14, right: 14, bottom: 20, left: 38 }
/** Axis limits that produce round gridline labels (ticks sit at ±limit, ±limit/2). */
const AXIS_LIMITS = [12, 20, 30, 40, 60, 90]

export default function ModeGraph({ params, q, qdot, qTarget, history, active }: ModeGraphProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const measure = () => setSize({ w: host.clientWidth, h: host.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(host)
    return () => ro.disconnect()
  }, [])

  // Quantised release state: the curves only need recomputing when the arm has
  // actually moved, not on every 30 Hz readout tick.
  const qKey = Math.round(q / 0.05) * 0.05
  const qdKey = Math.round(qdot / 0.25) * 0.25
  const { Kp, m, L, g, b, tauMax, gravityCompensation, delayMs } = params

  const curves = useMemo(
    () =>
      modeCurves({
        params,
        q: qKey,
        qdot: qdKey,
        qTarget,
        seconds: FUTURE_S,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [Kp, m, L, g, b, tauMax, gravityCompensation, delayMs, qKey, qdKey, qTarget],
  )

  const tLast = history.length ? history[history.length - 1].t : null

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const dpr = window.devicePixelRatio || 1
    const { w, h } = size
    if (w <= 0 || h <= 0) return
    canvas.width = Math.floor(w * dpr)
    canvas.height = Math.floor(h * dpr)

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = '#0b0e14'
    ctx.fillRect(0, 0, w, h)

    const plotW = w - PAD.left - PAD.right
    const plotH = h - PAD.top - PAD.bottom
    if (plotW <= 0 || plotH <= 0) return

    // Symmetric window that contains every curve, capped at ±90°.
    let maxAbs = Math.abs(qTarget) * 1.3
    for (const name of Object.keys(curves) as PresetName[]) {
      for (const p of curves[name]) {
        if (Math.abs(p.q) > 90) continue
        maxAbs = Math.max(maxAbs, Math.abs(p.q))
      }
    }
    const limit = AXIS_LIMITS.find((v) => v >= maxAbs) ?? 90

    const xScale = (t: number) => PAD.left + ((t + PAST_S) / (PAST_S + FUTURE_S)) * plotW
    const yScale = (deg: number) => PAD.top + plotH / 2 - (deg / limit) * (plotH / 2)

    // grid
    ctx.font = '11px ui-monospace, monospace'
    ctx.lineWidth = 1
    for (const deg of [limit, limit / 2, 0, -limit / 2, -limit]) {
      const y = yScale(deg)
      ctx.strokeStyle = 'rgba(255,255,255,0.05)'
      ctx.beginPath()
      ctx.moveTo(PAD.left, y)
      ctx.lineTo(PAD.left + plotW, y)
      ctx.stroke()
      ctx.fillStyle = 'rgba(255,255,255,0.4)'
      ctx.textAlign = 'right'
      ctx.textBaseline = 'middle'
      ctx.fillText(`${Math.round(deg)}°`, PAD.left - 6, y)
    }
    for (let s = -PAST_S; s <= FUTURE_S; s++) {
      const x = xScale(s)
      ctx.strokeStyle = s === 0 ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.05)'
      ctx.beginPath()
      ctx.moveTo(x, PAD.top)
      ctx.lineTo(x, PAD.top + plotH)
      ctx.stroke()
      if (s % 2 === 0 || s === 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.4)'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'top'
        ctx.fillText(s === 0 ? 'now' : `${s}s`, x, PAD.top + plotH + 5)
      }
    }

    // target
    ctx.strokeStyle = 'rgba(99,140,255,0.55)'
    ctx.setLineDash([5, 5])
    const yt = yScale(qTarget)
    ctx.beginPath()
    ctx.moveTo(PAD.left, yt)
    ctx.lineTo(PAD.left + plotW, yt)
    ctx.stroke()
    ctx.setLineDash([])

    // the arm's actual past, aligned so the newest sample lands on "now"
    if (tLast !== null && history.length > 1) {
      ctx.strokeStyle = '#e8edf5'
      ctx.lineWidth = 1.6
      ctx.lineJoin = 'round'
      ctx.beginPath()
      let started = false
      for (const p of history) {
        const x = xScale(p.t - tLast)
        if (x < PAD.left) continue
        const y = yScale(Math.max(-limit, Math.min(limit, p.q * (180 / Math.PI))))
        if (!started) {
          ctx.moveTo(x, y)
          started = true
        } else ctx.lineTo(x, y)
      }
      ctx.stroke()
    }

    // the four predicted responses
    for (const { name } of PRESETS) {
      const pts = curves[name]
      if (!pts || pts.length < 2) continue
      const isActive = active === name
      ctx.strokeStyle = COLORS[name]
      ctx.lineWidth = isActive ? 2.6 : 1.5
      ctx.globalAlpha = active === null || isActive ? 1 : 0.45
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      ctx.beginPath()
      pts.forEach((p, i) => {
        const x = xScale(p.t)
        const deg = p.q * (180 / Math.PI)
        const y = yScale(Math.max(-limit, Math.min(limit, deg)))
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      })
      ctx.stroke()
      ctx.globalAlpha = 1
    }
  }, [curves, size, qTarget, history, tLast, active])

  return (
    <section className="mode-graph" aria-label="How each mode would respond">
      <header className="mode-graph-head">
        <h2 className="panel-title">Four regimes, one start</h2>
        <p className="mode-graph-lede">
          What each mode would do from right here — same arm, same target, only the controller changes. The
          white line is where your arm has actually been.
        </p>
      </header>
      <div className="mode-plot-host" ref={hostRef}>
        <canvas ref={canvasRef} />
      </div>
      <div className="mode-legend">
        <span className="live">
          <i style={{ background: '#e8edf5' }} />
          your arm
        </span>
        {PRESETS.map((p) => (
          <span
            key={p.name}
            className={active === p.name ? 'sel' : active ? 'dim' : ''}
            style={{ color: COLORS[p.name] }}
          >
            <i style={{ background: COLORS[p.name] }} />
            {LABELS[p.name]}
          </span>
        ))}
      </div>
    </section>
  )
}
