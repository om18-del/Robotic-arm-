import { describe, it, expect } from 'vitest'
import { modeCurves } from './modeCurves'
import { PRESETS } from './presets'
import type { PresetName } from './presets'
import type { SimParams } from '../hooks/useSimulation'

const PARAMS: SimParams = {
  Kp: 20,
  Ki: 4,
  m: 1,
  L: 0.5,
  g: 9.81,
  b: 0.05,
  gravityCompensation: false,
  tauMax: 6,
  delayMs: 0,
}

const RELEASE = 0.2 // rad above the target
const TARGET = 0

function curves(seconds = 12) {
  return modeCurves({ params: PARAMS, q: RELEASE, qdot: 0, qTarget: TARGET, seconds })
}

/** Crossings of the target, final error, and the motion left in the last 2 s. */
function signature(pts: Array<{ t: number; q: number }>) {
  let crossings = 0
  let sign = 1
  let tail = 0
  const end = pts[pts.length - 1].t
  for (const p of pts) {
    const s = Math.abs(p.q) > 0.002 ? Math.sign(p.q) : sign
    if (s !== sign) {
      crossings++
      sign = s
    }
    if (p.t > end - 2) tail = Math.max(tail, Math.abs(p.q))
  }
  return { crossings, final: pts[pts.length - 1].q, tail }
}

describe('the graph’s four curves are the four regimes', () => {
  it('produces a well-formed trajectory for every preset', () => {
    const c = curves(6)
    expect(Object.keys(c).sort()).toEqual(PRESETS.map((p) => p.name).sort())
    for (const { name } of PRESETS) {
      const pts = c[name as PresetName]
      expect(pts.length).toBeGreaterThan(100)
      expect(pts[0].t).toBe(0)
      expect(pts[0].q).toBe(RELEASE)
      expect(pts[pts.length - 1].t).toBeCloseTo(6, 1)
      for (let i = 1; i < pts.length; i++) expect(pts[i].t).toBeGreaterThan(pts[i - 1].t)
      expect(pts.every((p) => Number.isFinite(p.q))).toBe(true)
    }
  })

  it('draws the ringing one as ringing and the damped ones as not', () => {
    const c = curves()
    const under = signature(c.underdamped)
    const crit = signature(c['critically-damped'])
    const over = signature(c.overdamped)

    expect(under.crossings).toBeGreaterThan(3)
    expect(crit.crossings).toBeLessThanOrEqual(1)
    expect(over.crossings).toBeLessThanOrEqual(1)
    expect(under.tail).toBeGreaterThan(0.02)
    expect(crit.tail).toBeLessThan(0.005)
    expect(over.tail).toBeLessThan(0.005)
    // Same joint, less integral gain: overdamped is the slower of the two.
    expect(Math.abs(over.final)).toBeGreaterThan(Math.abs(crit.final))
  })

  it('shows the unstable mode still moving when the others have stopped', () => {
    const c = curves()
    const unstable = signature(c.unstable)
    const crit = signature(c['critically-damped'])
    expect(unstable.tail).toBeGreaterThan(0.1)
    expect(unstable.tail).toBeGreaterThan(crit.tail * 10)
  })
})
