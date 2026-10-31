import { useEffect, useRef, useCallback } from 'react'

interface TimePlotProps {
  history: Array<{ t: number; q: number; qdot: number; tau: number }>
  qTarget: number
}

export default function TimePlot({ history, qTarget }: TimePlotProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const resize = useCallback(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return
    const dpr = window.devicePixelRatio || 1
    const rect = container.getBoundingClientRect()
    const w = Math.max(1, Math.floor(rect.width))
    const h = Math.max(1, Math.floor(rect.height))
    canvas.width = w * dpr
    canvas.height = h * dpr
    canvas.style.width = w + 'px'
    canvas.style.height = h + 'px'
  }, [])

  useEffect(() => {
    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [resize])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const dpr = window.devicePixelRatio || 1
    const w = canvas.width / dpr
    const h = canvas.height / dpr

    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.save()
    ctx.scale(dpr, dpr)

    // background
    ctx.fillStyle = '#0b0e14'
    ctx.fillRect(0, 0, w, h)

    const pad = { top: 18, bottom: 18, left: 32, right: 16 }
    const plotW = w - pad.left - pad.right
    const plotH = h - pad.top - pad.bottom
    if (plotW <= 0 || plotH <= 0) { ctx.restore(); return }

    // angle range for y-axis: ±90 deg = ±PI/2 rad
    const yMin = -Math.PI / 2
    const yMax = Math.PI / 2
    const yRange = yMax - yMin

    // x-axis: time window = last 5 s
    const tMax = history.length > 0 ? history[history.length - 1].t : 0
    const tWindow = 5
    const tMin = tMax - tWindow

    const xScale = (t: number) => pad.left + ((t - tMin) / tWindow) * plotW
    const yScale = (q: number) => pad.top + plotH - ((q - yMin) / yRange) * plotH

    // grid
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'
    ctx.lineWidth = 1
    ctx.font = '11px ui-monospace, monospace'
    ctx.fillStyle = 'rgba(255,255,255,0.4)'
    // horizontal gridlines (every 15 deg)
    for (let deg = -90; deg <= 90; deg += 15) {
      const q = deg * Math.PI / 180
      const y = yScale(q)
      if (y < pad.top || y > pad.top + plotH) continue
      ctx.beginPath()
      ctx.moveTo(pad.left, y)
      ctx.lineTo(pad.left + plotW, y)
      ctx.stroke()
      ctx.textAlign = 'right'
      ctx.textBaseline = 'middle'
      ctx.fillText(deg + '°', pad.left - 6, y)
    }
    // vertical gridlines (every 1 s)
    for (let s = Math.ceil(tMin); s <= tMax; s += 1) {
      const x = xScale(s)
      if (x < pad.left || x > pad.left + plotW) continue
      ctx.beginPath()
      ctx.moveTo(x, pad.top)
      ctx.lineTo(x, pad.top + plotH)
      ctx.stroke()
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillText(s + 's', x, pad.top + plotH + 4)
    }

    // y-axis label
    ctx.save()
    ctx.translate(10, pad.top + plotH / 2)
    ctx.rotate(-Math.PI / 2)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = 'rgba(255,255,255,0.5)'
    ctx.font = '12px sans-serif'
    ctx.fillText('angle', 0, 0)
    ctx.restore()

    // zero line
    ctx.strokeStyle = 'rgba(255,255,255,0.15)'
    ctx.lineWidth = 1
    ctx.setLineDash([4, 4])
    const y0 = yScale(0)
    ctx.beginPath()
    ctx.moveTo(pad.left, y0)
    ctx.lineTo(pad.left + plotW, y0)
    ctx.stroke()
    ctx.setLineDash([])

    // target line
    const yt = yScale(qTarget)
    ctx.strokeStyle = 'rgba(99, 140, 255, 0.5)'
    ctx.lineWidth = 1.5
    ctx.setLineDash([5, 5])
    ctx.beginPath()
    ctx.moveTo(pad.left, yt)
    ctx.lineTo(pad.left + plotW, yt)
    ctx.stroke()
    ctx.setLineDash([])

    // q(t) line
    if (history.length > 1) {
      ctx.strokeStyle = '#e8edf5'
      ctx.lineWidth = 2.5
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      ctx.beginPath()
      let started = false
      for (const pt of history) {
        if (pt.t < tMin) continue
        const x = xScale(pt.t)
        const y = yScale(pt.q)
        if (!started) { ctx.moveTo(x, y); started = true } else ctx.lineTo(x, y)
      }
      ctx.stroke()

      // qdot trace (secondary, smaller, below)
      // compute y range for qdot: ±5 rad/s
      const yDotMin = -5
      const yDotMax = 5
      const yDotRange = yDotMax - yDotMin
      const yDotScale = (qd: number) => pad.top + plotH - ((qd - yDotMin) / yDotRange) * plotH
      // draw qdot as a thin line
      ctx.strokeStyle = 'rgba(255, 200, 100, 0.5)'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      started = false
      for (const pt of history) {
        if (pt.t < tMin) continue
        const x = xScale(pt.t)
        const y = yDotScale(pt.qdot)
        if (!started) { ctx.moveTo(x, y); started = true } else ctx.lineTo(x, y)
      }
      ctx.stroke()

      // area fill under q curve (subtle)
      ctx.save()
      ctx.beginPath()
      started = false
      for (const pt of history) {
        if (pt.t < tMin) continue
        const x = xScale(pt.t)
        const y = yScale(pt.q)
        if (!started) { ctx.moveTo(x, y); started = true } else ctx.lineTo(x, y)
      }
      ctx.lineTo(xScale(Math.max(tMax, tMin + tWindow)), yScale(0))
      ctx.lineTo(xScale(tMin), yScale(0))
      ctx.closePath()
      ctx.fillStyle = 'rgba(232, 237, 245, 0.08)'
      ctx.fill()
      ctx.restore()
    }

    ctx.restore()
  }, [history, qTarget])

  useEffect(() => {
    draw()
  }, [draw])

  return (
    <div className="plot-wrap" ref={containerRef}>
      <canvas ref={canvasRef} className="time-plot" />
      <div className="plot-title">Time response</div>
    </div>
  )
}
