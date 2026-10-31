import { useEffect, useRef } from 'react'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import type { SimParams } from '../hooks/useSimulation'
import type { Pole } from '../sim/analysis'

interface MathPanelProps {
  params: SimParams
  J: number
  qTarget: number
  omegaN: number
  zetaMech: number
  poles: [Pole, Pole, Pole]
  kEff: number
  KiCrit: number
  routhMargin: number
  stable: boolean
  regime: string
}

const FLASH_MS = 250
const FLASH_THRESHOLD = 0.005

/**
 * One equation: the closed-loop ODE that governs the arm.
 *
 * Substituting the PI law into the plant's torque balance and differentiating
 * once leaves this third-order equation for the deviation δ = q − q*. Every
 * motion in the 3D view is a solution of it, and whether a disturbance decays
 * is decided by these four coefficients. The symbolic structure is fixed; only
 * the \htmlId slots are patched with live values.
 */
const LATEX = String.raw`\htmlId{val-J}{0.083}\,\dddot{\delta} \;+\; \htmlId{val-b}{0.050}\,\ddot{\delta} \;+\; \htmlId{val-keff}{20.000}\,\dot{\delta} \;+\; \htmlId{val-ki}{4.000}\,\delta \;=\; 0,\qquad \delta = q - q^\ast`

const CAPTION = ''
/** Format a pole for display: "−6.300 ± 14.153j" or a single real number. */
function poleStr(s: Pole): string {
  if (Math.abs(s.im) < 1e-6) return s.re.toFixed(3)
  return `${s.re.toFixed(3)} ${s.im >= 0 ? '+' : '−'} ${Math.abs(s.im).toFixed(3)}j`
}

export default function MathPanel({
  params,
  J,
  qTarget,
  omegaN,
  zetaMech,
  poles,
  kEff,
  KiCrit,
  routhMargin,
  stable,
  regime,
}: MathPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const placeholderRefs = useRef<Record<string, HTMLElement | null>>({})
  const renderedRef = useRef(false)
  const flashTimers = useRef<Record<string, ReturnType<typeof setTimeout> | null>>({})

  // Render the equation once; numbers are patched in place afterwards.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    container.innerHTML = ''
    placeholderRefs.current = {}
    const div = document.createElement('div')
    div.className = 'katex-block'
    div.setAttribute('data-eq', 'governing')
    container.appendChild(div)
    try {
      katex.render(LATEX, div, {
        throwOnError: false,
        trust: true,
        displayMode: false,
        strict: 'ignore',
        // HTML only: MathML would be a second, static copy of every number, so
        // the accessibility tree would keep reading the initial values.
        output: 'html',
      })
    } catch {
      div.textContent = LATEX
    }
    const nodeList = div.querySelectorAll('[id]') as NodeListOf<HTMLElement>
    for (let i = 0; i < nodeList.length; i++) {
      const el = nodeList[i]
      if (el.id) placeholderRefs.current[el.id] = el
    }
    const cap = document.createElement('div')
    cap.className = 'eq-caption'
    cap.textContent = CAPTION
    container.appendChild(cap)
    renderedRef.current = true
  }, [])

  // Patch the live numbers into the rendered equation.
  useEffect(() => {
    if (!renderedRef.current) return

    const flash = (el: HTMLElement, changed: boolean) => {
      if (!changed) return
      const pending = flashTimers.current[el.id]
      if (pending) clearTimeout(pending)
      el.classList.remove('flash')
      void el.offsetWidth
      el.classList.add('flash')
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        el.classList.remove('flash')
      } else {
        flashTimers.current[el.id] = setTimeout(() => {
          el.classList.remove('flash')
          flashTimers.current[el.id] = null
        }, FLASH_MS)
      }
    }

    const setVal = (id: string, value: number) => {
      const el = placeholderRefs.current[id]
      if (!el) return
      const text = Number.isFinite(value) ? value.toFixed(3) : '∞'
      const oldText = (el.textContent ?? '').trim()
      if (oldText === text) return
      const oldNum = parseFloat(oldText)
      el.textContent = text
      const relChange = Number.isNaN(oldNum) ? 1 : Math.abs(value - oldNum) / Math.max(1e-6, Math.abs(value))
      flash(el, relChange > FLASH_THRESHOLD)
    }

    setVal('val-J', J)
    setVal('val-b', params.b)
    setVal('val-keff', kEff)
    setVal('val-ki', params.Ki)
  }, [J, params.b, params.Ki, kEff])

  const regimeLabel: Record<string, string> = {
    underdamped: 'Underdamped — rings, then settles',
    'critically-damped': 'Critically damped — repeated real pole, no ringing',
    overdamped: 'Overdamped — real poles, slower, no ringing',
    unstable: 'Unstable — a pole sits right of the imaginary axis',
  }

//   return (
//     <section className="math-panel" aria-label="The differential equation behind the arm">
//       <header className="math-panel-head">
//         <h2 className="panel-title">The arm as a differential equation</h2>
//         <p className="panel-lede">
//           A robot arm cannot be told to “go to 30°”. It can only be told a torque, and torque decides an
//           acceleration — so the arm's position is the <em>solution</em> of an ODE. This is the one the
//           simulation on the left is stepping, live.
//         </p>
//       </header>
// 
//       <div ref={containerRef} className="katex-container" />
// 
//       <div className="regime-line">
//         <span className="regime-label">Stability</span>
//         <span className={`regime-value regime-${regime}`}>{regimeLabel[regime] ?? regime}</span>
//       </div>
// 
//       <div className={`verdict ${stable ? 'verdict-ok' : 'verdict-bad'}`}>
//         <span className="verdict-dot" aria-hidden="true" />
//         {stable ? (
//           <span>
//             Stable: the Routh margin b·k_eff − J·K_i = {routhMargin.toFixed(3)} is positive, so every pole sits
//             left of the imaginary axis and disturbances decay.
//           </span>
//         ) : (
//           <span>
//             Unstable: the Routh margin is {routhMargin.toFixed(3)} (or k_eff ≤ 0 / K_i ≤ 0). A pole sits in the
//             right half-plane, so the simulation diverges — there is no equilibrium to hold.
//           </span>
//         )}
//       </div>
// 
//       <div className="param-note">
//         q* = {(qTarget * 180 / Math.PI).toFixed(2)}° · J = {J.toFixed(4)} kg·m² · b = {params.b.toFixed(3)} N·m·s/rad
//         · k_eff = {kEff.toFixed(2)} N·m/rad · K_i = {params.Ki.toFixed(2)} of K_i,crit = {KiCrit.toFixed(2)}
//       </div>
//       <div className="param-note">
//         ωₙ = {omegaN.toFixed(2)} rad/s · ζ_mech = {Number.isFinite(zetaMech) ? zetaMech.toFixed(3) : '∞'} ·
//         slowest pole s = {poleStr(poles[0])} · all three: {poles.map(poleStr).join(', ')}
//       </div>
// 
//       <p className="panel-fineprint">
//         Analysed in continuous time. The 480 Hz control hold adds about 2 ms of delay that is not in this
//         equation, so a setting sitting exactly on the boundary can still drift in the live simulation — and a
//         real drive delay (Actuator options) moves that boundary sharply inward. Torque saturation is not in the
//         equation either: an unstable loop that would run away in the model instead settles into a bounded,
//         sustained oscillation when the motor clips at τ_max.
//       </p>
//     </section>
//   )
}
