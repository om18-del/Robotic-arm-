import { useEffect, useRef, useCallback } from 'react'

interface ArmCanvasProps {
  q: number // current angle from horizontal (rad), unclamped
  qTarget: number // target angle (rad), clamped to +/-90 in display
  tau: number // present for interface stability; not drawn
  regime: string // regime key for glow ring color
  onDrag: (px: number, py: number) => void
}

// Palette — orange industrial robot (KUKA/ABB style) on dark background.
const C = {
  bg: '#0b0e14',
  floor: '#0d1119',
  basePlateDark: '#2a1a0e',
  basePlateMid: '#4a2a14',
  baseOrange: '#ff8c42',
  baseOrangeDark: '#cc6a28',
  baseOrangeLight: '#ffb07a',
  turntableDark: '#232a38',
  turntableMid: '#323b4d',
  turntableLight: '#5a6a82',
  linkOrange: '#ff8c42',
  linkOrangeDark: '#cc6a28',
  linkOrangeLight: '#ffb07a',
  linkBody: '#a05a20',
  outline: '#161c26',
  accent: '#ff8c42',
  accentDim: 'rgba(255, 140, 66, 0.3)',
  bolt: '#1a202c',
  warn: '#e8a45a',
  danger: '#ff7a7a',
  good: '#5ad1a0',
  wristDark: '#232a38',
  fingerOrange: '#ff8c42',
  fingerOrangeDark: '#cc6a28',
}

const REGIME_COLOR: Record<string, string> = {
  underdamped: '#7aa2ff',
  'critically-damped': '#5ad1a0',
  overdamped: C.warn,
  unstable: C.danger,
}

const TRAIL_MS = 500
const TRAIL_MAX = 60

interface TrailPoint {
  x: number
  y: number
  t: number
}

export default function ArmCanvas({ q, qTarget, regime, onDrag }: ArmCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const staticCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const trailRef = useRef<TrailPoint[]>([])
  const regimeRef = useRef<string>(regime)

  // Keep regime ref in sync when the prop changes.
  useEffect(() => {
    regimeRef.current = regime
  }, [regime])

  // Geometry (recomputed on resize)
  const geomRef = useRef({
    cx: 0,
    cy: 0,
    linkLen: 0,
    w: 0,
    h: 0,
  })

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

    geomRef.current = {
      cx: w / 2,
      cy: h / 2,
      linkLen: Math.min(w, h) * 0.42,
      w,
      h,
    }

    buildStaticCanvas(w, h, dpr)
  }, [])

  useEffect(() => {
    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [resize])

  const buildStaticCanvas = useCallback(
    (w: number, h: number, dpr: number) => {
      const sc = document.createElement('canvas')
      sc.width = w * dpr
      sc.height = h * dpr
      const s = sc.getContext('2d')
      if (!s) return
      s.scale(dpr, dpr)

      // background
      s.fillStyle = C.bg
      s.fillRect(0, 0, w, h)

      // floor line + soft shadow
      const baseY = h - 22
      s.fillStyle = 'rgba(0,0,0,0.4)'
      s.fillRect(0, baseY + 2, w, 22)

      s.strokeStyle = 'rgba(255,255,255,0.05)'
      s.lineWidth = 1
      s.beginPath()
      s.moveTo(0, baseY)
      s.lineTo(w, baseY)
      s.stroke()

      // subtle grid dots
      s.fillStyle = 'rgba(255,255,255,0.025)'
      for (let x = 0; x < w; x += 30) {
        for (let y = 0; y < baseY; y += 30) {
          s.beginPath()
          s.arc(x, y, 0.8, 0, Math.PI * 2)
          s.fill()
        }
      }

      const cx = w / 2
      const pedTop = Math.round(h * 0.5)

      // base plate
      const plateW = Math.min(200, w * 0.34)
      const plateH = 14
      const plateX = cx - plateW / 2
      const plateY = baseY - plateH
      drawBasePlate(s, plateX, plateY, plateW, plateH)

      // stepped pedestal
      drawPedestal(s, cx, plateY, pedTop, plateW)

      // column / shoulder housing base
      drawColumn(s, cx, pedTop)

      staticCanvasRef.current = sc
    },
    [],
  )

  const drawBasePlate = useCallback(
    (s: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) => {
      // shadow
      s.fillStyle = 'rgba(0,0,0,0.5)'
      roundRect(s, x + 3, y + 4, w, h, 5)
      s.fill()

      // plate body — orange gradient
      const g = s.createLinearGradient(x, y, x, y + h)
      g.addColorStop(0, C.baseOrangeLight)
      g.addColorStop(0.4, C.baseOrange)
      g.addColorStop(1, C.baseOrangeDark)
      s.fillStyle = g
      roundRect(s, x, y, w, h, 5)
      s.fill()

      // top rim highlight
      s.fillStyle = 'rgba(255,255,255,0.15)'
      roundRect(s, x + 2, y + 1, w - 4, 3, 3)
      s.fill()

      // dark border
      s.strokeStyle = 'rgba(0,0,0,0.4)'
      s.lineWidth = 1
      roundRect(s, x, y, w, h, 5)
      s.stroke()

      // bolt circles
      const boltR = Math.min(3.5, w * 0.02)
      const boltY = y + h / 2
      const margin = w * 0.18
      for (const bx of [x + margin, x + w - margin]) {
        s.fillStyle = 'rgba(0,0,0,0.5)'
        s.beginPath()
        s.arc(bx, boltY, boltR, 0, Math.PI * 2)
        s.fill()
        s.fillStyle = C.baseOrangeLight
        s.beginPath()
        s.arc(bx, boltY, boltR * 0.6, 0, Math.PI * 2)
        s.fill()
      }
    },
    [],
  )

  const drawPedestal = useCallback(
    (s: CanvasRenderingContext2D, cx: number, topY: number, botY: number, plateW: number) => {
      // Turntable column — dark steel column with two orange band accents.
      const colW = Math.min(38, plateW * 0.19)
      const colTop = topY - 8
      const colBot = botY
      const g = s.createLinearGradient(cx - colW / 2, colTop, cx + colW / 2, colTop)
      g.addColorStop(0, C.turntableDark)
      g.addColorStop(0.5, C.turntableMid)
      g.addColorStop(1, C.turntableDark)
      s.fillStyle = g
      roundRect(s, cx - colW / 2, colTop, colW, colBot - colTop, 7)
      s.fill()
      s.strokeStyle = C.outline
      s.lineWidth = 1
      roundRect(s, cx - colW / 2, colTop, colW, colBot - colTop, 7)
      s.stroke()

      // vertical center seam
      s.strokeStyle = 'rgba(0,0,0,0.35)'
      s.lineWidth = 1
      s.beginPath()
      s.moveTo(cx, colTop + 3)
      s.lineTo(cx, colBot - 3)
      s.stroke()

      // orange band near top
      s.fillStyle = C.baseOrangeDark
      roundRect(s, cx - colW / 2 + 1, colTop + 5, colW - 2, 7, 2)
      s.fill()
      s.fillStyle = 'rgba(255,255,255,0.12)'
      roundRect(s, cx - colW / 2 + 2, colTop + 6, colW - 4, 2, 1)
      s.fill()

      // orange band near bottom
      s.fillStyle = C.baseOrangeDark
      roundRect(s, cx - colW / 2 + 1, colBot - 14, colW - 2, 7, 2)
      s.fill()

      // central shaft behind shoulder (dark steel)
      const shaftW = Math.min(24, plateW * 0.12)
      const shaftTop = topY - 14
      const g2 = s.createLinearGradient(cx - shaftW / 2, shaftTop, cx + shaftW / 2, shaftTop)
      g2.addColorStop(0, C.turntableDark)
      g2.addColorStop(0.5, C.turntableMid)
      g2.addColorStop(1, C.turntableDark)
      s.fillStyle = g2
      roundRect(s, cx - shaftW / 2, shaftTop, shaftW, topY - shaftTop + 10, 5)
      s.fill()
      s.strokeStyle = C.outline
      s.lineWidth = 1
      roundRect(s, cx - shaftW / 2, shaftTop, shaftW, topY - shaftTop + 10, 5)
      s.stroke()
    },
    [],
  )

  const drawColumn = useCallback(
    (s: CanvasRenderingContext2D, cx: number, topY: number) => {
      // Turntable top — orange disc
      const colR = 24
      const colH = 8
      const g = s.createLinearGradient(cx - colR, topY, cx + colR, topY)
      g.addColorStop(0, C.baseOrangeDark)
      g.addColorStop(0.5, C.baseOrange)
      g.addColorStop(1, C.baseOrangeDark)
      s.fillStyle = g
      s.beginPath()
      s.ellipse(cx, topY + colH / 2, colR, colH / 2, 0, 0, Math.PI * 2)
      s.fill()
      s.strokeStyle = 'rgba(0,0,0,0.4)'
      s.lineWidth = 1
      s.stroke()

      // top ellipse rim (orange highlight)
      s.strokeStyle = C.baseOrangeLight
      s.lineWidth = 1
      s.beginPath()
      s.ellipse(cx, topY, colR, colH / 2, 0, 0, Math.PI * 2)
      s.stroke()

      // center detail ring
      s.strokeStyle = C.baseOrangeDark
      s.lineWidth = 1
      s.beginPath()
      s.ellipse(cx, topY, 10, 4, 0, 0, Math.PI * 2)
      s.stroke()
    },
    [],
  )

  const drawShoulder = useCallback(
    (s: CanvasRenderingContext2D, cx: number, cy: number) => {
      const housingR = 38

      // Dark shoulder body (the hub behind the ring)
      const body = s.createRadialGradient(cx - 10, cy - 12, 2, cx, cy, housingR)
      body.addColorStop(0, '#4a5060')
      body.addColorStop(0.55, C.turntableMid)
      body.addColorStop(1, '#151a24')
      s.fillStyle = body
      s.beginPath()
      s.arc(cx, cy, housingR, 0, Math.PI * 2)
      s.fill()

      // Outer housing ring — dark
      s.strokeStyle = '#0c1018'
      s.lineWidth = 2.2
      s.beginPath()
      s.arc(cx, cy, housingR, 0, Math.PI * 2)
      s.stroke()

      // Bolt holes around the housing (industrial detail)
      const boltR = 2.4
      const boltOrbit = housingR - 5
      const boltN = 8
      for (let i = 0; i < boltN; i++) {
        const a = (i / boltN) * Math.PI * 2
        const bx = cx + boltOrbit * Math.cos(a)
        const by = cy + boltOrbit * Math.sin(a)
        s.fillStyle = 'rgba(0,0,0,0.6)'
        s.beginPath()
        s.arc(bx, by, boltR, 0, Math.PI * 2)
        s.fill()
        s.fillStyle = C.baseOrangeLight
        s.beginPath()
        s.arc(bx, by, boltR * 0.55, 0, Math.PI * 2)
        s.fill()
      }

      // Large orange ring (the rotating joint ring visible at the shoulder)
      s.strokeStyle = C.baseOrange
      s.lineWidth = 3.2
      s.beginPath()
      s.arc(cx, cy, housingR - 4, 0, Math.PI * 2)
      s.stroke()

      // Inner ring — lighter orange highlight
      s.strokeStyle = C.baseOrangeLight
      s.lineWidth = 1
      s.beginPath()
      s.arc(cx, cy, housingR - 8, 0, Math.PI * 2)
      s.stroke()

      // Hub center
      s.fillStyle = C.turntableDark
      s.beginPath()
      s.arc(cx, cy, 9, 0, Math.PI * 2)
      s.fill()
      s.strokeStyle = C.baseOrangeDark
      s.lineWidth = 1.4
      s.beginPath()
      s.arc(cx, cy, 9, 0, Math.PI * 2)
      s.stroke()

      // Hub center dot (orange)
      s.fillStyle = C.baseOrange
      s.beginPath()
      s.arc(cx, cy, 3.2, 0, Math.PI * 2)
      s.fill()

      // Highlight arc on the upper-left of the housing
      s.strokeStyle = 'rgba(255,255,255,0.08)'
      s.lineWidth = 1
      s.beginPath()
      s.arc(cx, cy, housingR - 1, -Math.PI * 0.75, -Math.PI * 0.1)
      s.stroke()
    },
    [],
  )

  const drawRegimeGlowRing = useCallback(
    (s: CanvasRenderingContext2D, cx: number, cy: number, regime: string) => {
      const ringR = 40
      const color = REGIME_COLOR[regime] ?? C.accent
      // outer glow
      const glow = s.createRadialGradient(cx, cy, ringR - 4, cx, cy, ringR + 10)
      glow.addColorStop(0, color + '55')
      glow.addColorStop(0.5, color + '22')
      glow.addColorStop(1, color + '00')
      s.fillStyle = glow
      s.beginPath()
      s.arc(cx, cy, ringR + 10, 0, Math.PI * 2)
      s.fill()

      // ring
      s.strokeStyle = color
      s.lineWidth = 2.5
      s.globalAlpha = 0.85
      s.beginPath()
      s.arc(cx, cy, ringR, 0, Math.PI * 2)
      s.stroke()
      s.globalAlpha = 1

      // inner ring (dimmer)
      s.strokeStyle = color + '60'
      s.lineWidth = 1
      s.beginPath()
      s.arc(cx, cy, ringR - 6, 0, Math.PI * 2)
      s.stroke()
    },
    [],
  )

  const drawLink = useCallback(
    (s: CanvasRenderingContext2D, len: number) => {
      const wSh = 30
      const wTip = 14

      // tapered rounded path in local coords (link along +x)
      s.beginPath()
      s.moveTo(0, -wSh / 2)
      s.lineTo(len - wTip / 2, -wTip / 2)
      s.arc(len, 0, wTip / 2, -Math.PI / 2, Math.PI / 2)
      s.lineTo(0, wSh / 2)
      s.arc(0, 0, wSh / 2, Math.PI / 2, -Math.PI / 2, true)
      s.closePath()

      // orange body gradient (along length)
      const g = s.createLinearGradient(0, 0, len, 0)
      g.addColorStop(0, C.linkOrangeDark)
      g.addColorStop(0.12, C.linkOrange)
      g.addColorStop(0.35, C.linkBody)
      g.addColorStop(0.5, C.linkOrangeDark)
      g.addColorStop(0.75, C.linkOrange)
      g.addColorStop(1, C.linkOrangeDark)
      s.fillStyle = g
      s.fill()

      // outline
      s.strokeStyle = 'rgba(0,0,0,0.5)'
      s.lineWidth = 1.2
      s.stroke()

      // top highlight stripe (orange-light)
      s.save()
      s.beginPath()
      s.moveTo(4, -wSh / 2 + 2.5)
      s.lineTo(len - wTip / 2 - 2, -wTip / 2 + 1.5)
      s.lineTo(len - wTip / 2 - 2, -wTip / 2 + 4)
      s.lineTo(4, -wSh / 2 + 5)
      s.closePath()
      s.fillStyle = 'rgba(255,200,150,0.25)'
      s.fill()
      s.restore()

      // center groove
      s.strokeStyle = 'rgba(0,0,0,0.4)'
      s.lineWidth = 1
      s.setLineDash([3, 4])
      s.beginPath()
      s.moveTo(12, 0)
      s.lineTo(len - wTip / 2 - 4, 0)
      s.stroke()
      s.setLineDash([])

      // panel lines
      s.strokeStyle = 'rgba(0,0,0,0.3)'
      s.lineWidth = 0.8
      const panelN = 6
      for (let i = 1; i <= panelN; i++) {
        const x = (i / (panelN + 1)) * (len - 12) + 6
        const wHere = lerp(wSh, wTip, i / (panelN + 1))
        s.beginPath()
        s.moveTo(x, -wHere / 2 + 3)
        s.lineTo(x, wHere / 2 - 3)
        s.stroke()
      }

      // rivets (orange)
      s.fillStyle = C.baseOrangeLight
      const rivetN = 5
      for (let i = 1; i <= rivetN; i++) {
        const x = (i / (rivetN + 1)) * (len - 14) + 7
        s.beginPath()
        s.arc(x, 0, 1.4, 0, Math.PI * 2)
        s.fill()
      }

      // shoulder end cap ring (orange)
      s.strokeStyle = C.baseOrangeDark
      s.lineWidth = 1.2
      s.beginPath()
      s.arc(0, 0, wSh / 2 - 1.5, 0, Math.PI * 2)
      s.stroke()

      // tip end cap (orange)
      s.fillStyle = C.linkOrangeDark
      s.beginPath()
      s.arc(len, 0, wTip / 2 - 0.5, 0, Math.PI * 2)
      s.fill()
      s.strokeStyle = C.baseOrange
      s.lineWidth = 0.8
      s.stroke()

      // Graphic hinge / elbow knuckle near the wrist end (rigid, rotates with the arm).
      // This is the visible "hinge" — a dark knuckle band with an orange ring and
      // a small bolt, drawn as a distinct mechanical joint on the arm body.
      const hingeX = len * 0.86
      const hingeW = wSh * 0.55
      const hingeH = wSh * 0.9
      // knuckle shadow
      s.fillStyle = 'rgba(0,0,0,0.45)'
      roundRect(s, hingeX - hingeW / 2 + 2, -hingeH / 2 + 3, hingeW, hingeH, 4)
      s.fill()
      // knuckle body — dark steel
      const hg = s.createLinearGradient(hingeX - hingeW / 2, 0, hingeX + hingeW / 2, 0)
      hg.addColorStop(0, C.turntableDark)
      hg.addColorStop(0.5, C.turntableMid)
      hg.addColorStop(1, C.turntableDark)
      s.fillStyle = hg
      roundRect(s, hingeX - hingeW / 2, -hingeH / 2, hingeW, hingeH, 4)
      s.fill()
      s.strokeStyle = 'rgba(0,0,0,0.55)'
      s.lineWidth = 1.2
      roundRect(s, hingeX - hingeW / 2, -hingeH / 2, hingeW, hingeH, 4)
      s.stroke()
      // orange hinge ring
      s.strokeStyle = C.baseOrange
      s.lineWidth = 2.2
      s.beginPath()
      s.arc(hingeX, 0, hingeH / 2 - 2, 0, Math.PI * 2)
      s.stroke()
      // inner ring highlight
      s.strokeStyle = C.baseOrangeLight
      s.lineWidth = 0.8
      s.beginPath()
      s.arc(hingeX, 0, hingeH / 2 - 6, 0, Math.PI * 2)
      s.stroke()
      // hinge bolt
      s.fillStyle = 'rgba(0,0,0,0.6)'
      s.beginPath()
      s.arc(hingeX, 0, 2.4, 0, Math.PI * 2)
      s.fill()
      s.fillStyle = C.baseOrangeLight
      s.beginPath()
      s.arc(hingeX, 0, 1.4, 0, Math.PI * 2)
      s.fill()
      // hinge pin highlight (top)
      s.strokeStyle = 'rgba(255,255,255,0.15)'
      s.lineWidth = 1
      s.beginPath()
      s.arc(hingeX, 0, hingeH / 2 - 2, -Math.PI * 0.8, -Math.PI * 0.2)
      s.stroke()
    },
    [],
  )

  const drawEndEffector = useCallback(
    (s: CanvasRenderingContext2D, tipX: number, tipY: number) => {
      // wrist joint — dark with orange ring
      s.fillStyle = C.wristDark
      s.strokeStyle = C.baseOrange
      s.lineWidth = 1.2
      s.beginPath()
      s.arc(tipX, tipY, 7, 0, Math.PI * 2)
      s.fill()
      s.stroke()
      s.fillStyle = C.baseOrangeLight
      s.beginPath()
      s.arc(tipX - 1.5, tipY - 1.5, 2.2, 0, Math.PI * 2)
      s.fill()

      // tool flange / gripper body (orange)
      s.fillStyle = C.linkOrangeDark
      roundRect(s, tipX - 5.5, tipY - 5.5, 11, 11, 2.5)
      s.fill()
      s.strokeStyle = 'rgba(0,0,0,0.4)'
      s.lineWidth = 0.8
      roundRect(s, tipX - 5.5, tipY - 5.5, 11, 11, 2.5)
      s.stroke()

      // two fingers (orange, fixed opening)
      const fingerLen = 18
      const gap = 8
      const fingerW = 5
      s.fillStyle = C.linkOrange
      s.strokeStyle = 'rgba(0,0,0,0.35)'
      s.lineWidth = 0.8
      s.beginPath()
      roundRect(s, tipX - gap / 2 - fingerW, tipY - fingerLen, fingerW, fingerLen, 2)
      s.fill()
      s.stroke()
      s.beginPath()
      roundRect(s, tipX + gap / 2, tipY - fingerLen, fingerW, fingerLen, 2)
      s.fill()
      s.stroke()

      // finger tips (darker orange)
      s.fillStyle = C.linkOrangeDark
      s.fillRect(tipX - gap / 2 - fingerW, tipY - 3, fingerW, 3)
      s.fillRect(tipX + gap / 2, tipY - 3, fingerW, 3)

      // finger grip pads (darker lines)
      s.strokeStyle = 'rgba(0,0,0,0.3)'
      s.lineWidth = 0.6
      s.beginPath()
      s.moveTo(tipX - gap / 2 - fingerW + 1.5, tipY - fingerLen + 4)
      s.lineTo(tipX - gap / 2 - fingerW + 1.5, tipY - 4)
      s.moveTo(tipX + gap / 2 + fingerW - 1.5, tipY - fingerLen + 4)
      s.lineTo(tipX + gap / 2 + fingerW - 1.5, tipY - 4)
      s.stroke()
    },
    [],
  )

  const drawTargetIndicator = useCallback(
    (s: CanvasRenderingContext2D, cx: number, cy: number, qTarget: number, linkLen: number) => {
      const tc = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, qTarget))
      const tx = cx + linkLen * Math.cos(tc)
      const ty = cy + linkLen * Math.sin(tc)

      // dashed arc from horizontal to target angle
      s.strokeStyle = C.accentDim
      s.lineWidth = 1.5
      s.setLineDash([4, 5])
      s.beginPath()
      s.moveTo(cx + 24, cy)
      s.arc(cx, cy, 24, 0, tc, tc < 0)
      s.stroke()
      s.setLineDash([])

      // ghost link
      s.strokeStyle = C.accentDim
      s.lineWidth = 2
      s.setLineDash([5, 5])
      s.beginPath()
      s.moveTo(cx, cy)
      s.lineTo(tx, ty)
      s.stroke()
      s.setLineDash([])

      // crosshair at target tip
      s.strokeStyle = C.accent
      s.lineWidth = 1.5
      const cr = 9
      s.beginPath()
      s.moveTo(tx - cr, ty)
      s.lineTo(tx + cr, ty)
      s.moveTo(tx, ty - cr)
      s.lineTo(tx, ty + cr)
      s.stroke()
      s.lineWidth = 1
      s.beginPath()
      s.arc(tx, ty, cr, 0, Math.PI * 2)
      s.stroke()
      s.fillStyle = C.accent
      s.beginPath()
      s.arc(tx, ty, 2, 0, Math.PI * 2)
      s.fill()
    },
    [],
  )

  const drawMotionTrail = useCallback(
    (s: CanvasRenderingContext2D, cx: number, cy: number, linkLen: number, q: number) => {
      const now = performance.now()
      const tipX = cx + linkLen * Math.cos(q)
      const tipY = cy + linkLen * Math.sin(q)
      trailRef.current.push({ x: tipX, y: tipY, t: now })
      while (trailRef.current.length > 0 && now - trailRef.current[0].t > TRAIL_MS) {
        trailRef.current.shift()
      }
      if (trailRef.current.length > TRAIL_MAX) {
        trailRef.current.shift()
      }

      const n = trailRef.current.length
      if (n < 2) return

      for (let i = 1; i < n; i++) {
        const a = trailRef.current[i - 1]
        const b = trailRef.current[i]
        const age = (now - b.t) / TRAIL_MS
        const alpha = Math.max(0, (1 - age) * 0.5)
        s.strokeStyle = `rgba(255, 140, 66, ${alpha})`
        s.lineWidth = 2 + (1 - age) * 2
        s.beginPath()
        s.moveTo(a.x, a.y)
        s.lineTo(b.x, b.y)
        s.stroke()
      }
    },
    [],
  )

  const drawAngleArc = useCallback(
    (s: CanvasRenderingContext2D, cx: number, cy: number, q: number) => {
      const arcR = 30
      s.strokeStyle = 'rgba(255, 180, 100, 0.6)'
      s.lineWidth = 1.8
      s.beginPath()
      s.moveTo(cx + arcR, cy)
      s.arc(cx, cy, arcR, 0, q, q < 0)
      s.stroke()

      // label
      const mid = q / 2
      const lr = arcR + 14
      const lx = cx + lr * Math.cos(mid)
      const ly = cy + lr * Math.sin(mid)
      s.fillStyle = 'rgba(255, 180, 100, 0.9)'
      s.font = '600 13px ui-monospace, monospace'
      s.textAlign = 'center'
      s.textBaseline = 'middle'
      s.fillText((q * 180 / Math.PI).toFixed(1) + '°', lx, ly)
    },
    [],
  )

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const dpr = window.devicePixelRatio || 1
    const g = geomRef.current
    if (g.w === 0) return

    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.save()
    ctx.scale(dpr, dpr)

    // 1. Static background (base plate, turntable, floor, grid) — precomputed
    if (staticCanvasRef.current) {
      ctx.drawImage(staticCanvasRef.current, 0, 0)
    }

    const cx = g.cx
    const cy = g.cy
    const linkLen = g.linkLen
    const currentClamped = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, q))

    // 2. Regime glow ring around the shoulder (color from prop)
    drawRegimeGlowRing(ctx, cx, cy, regime)

    // 3. Shoulder housing + hub + ring (fixed at the pivot)
    drawShoulder(ctx, cx, cy)

    // 4. Link + end effector — rotate together about the pivot by q
    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(currentClamped)
    drawLink(ctx, linkLen)
    drawEndEffector(ctx, linkLen, 0)
    ctx.restore()

    // 5. Dashed target marker at q_target
    drawTargetIndicator(ctx, cx, cy, qTarget, linkLen)

    // 6. Fading motion trail at the tip
    drawMotionTrail(ctx, cx, cy, linkLen, currentClamped)

    // 7. Angle arc + degree readout near the shoulder
    drawAngleArc(ctx, cx, cy, currentClamped)

    ctx.restore()
  }, [q, qTarget, regime, drawRegimeGlowRing, drawShoulder, drawLink, drawEndEffector, drawTargetIndicator, drawMotionTrail, drawAngleArc])

  // Redraw on state change (q, qTarget, tau) and regime color changes.
  useEffect(() => {
    draw()
  }, [draw, regime])

  // Pointer drag — kept identical to preserve hit-testing.
  const getPos = (e: React.PointerEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return { px: 0, py: 0 }
    const dpr = window.devicePixelRatio || 1
    const px = (e.clientX - rect.left) * (canvasRef.current!.width / dpr / rect.width)
    const py = (e.clientY - rect.top) * (canvasRef.current!.height / dpr / rect.height)
    return { px, py }
  }

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    const { px, py } = getPos(e)
    onDrag(px, py)
    const canvas = canvasRef.current
    if (canvas) canvas.setPointerCapture(e.pointerId)
  }, [onDrag, getPos])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (e.buttons !== 1) return
    const { px, py } = getPos(e)
    onDrag(px, py)
  }, [onDrag, getPos])

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    const canvas = canvasRef.current
    if (canvas) canvas.releasePointerCapture(e.pointerId)
  }, [])

  return (
    <div className="canvas-wrap" ref={containerRef}>
      <canvas
        ref={canvasRef}
        className="arm-canvas"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        role="img"
        aria-label="Robot arm canvas. Drag to set target angle."
      />
    </div>
  )
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  r = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}
