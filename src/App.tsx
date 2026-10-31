import { useCallback, useMemo, useState } from 'react'
import { useSimulation } from './hooks/useSimulation'
import ArmScene3D from './ui/ArmScene3D'
import ArmCanvas2D from './ui/ArmCanvas2D'
import MathPanel from './ui/MathPanel'
import PythonPanel from './ui/PythonPanel'
import ModeGraph from './ui/ModeGraph'
import { PRESETS } from './sim/presets'
import type { PresetName } from './sim/presets'

function App() {
  const {
    state,
    params,
    qTarget,
    paused,
    setTarget,
    setQTarget,
    setParams,
    setPaused,
    applyDisturbance,
    simResult,
    presets,
    snapToCritical,
    qRef,
    qTargetRef,
    regimeRef,
    LRef,
  } = useSimulation()

  const [optionsOpen, setOptionsOpen] = useState(false)
  const [activePreset, setActivePreset] = useState<PresetName | null>(null)

  const hasWebGL = useMemo(() => {
    try {
      const c = document.createElement('canvas')
      return !!(c.getContext('webgl2') ?? c.getContext('webgl'))
    } catch {
      return false
    }
  }, [])

  const handlePreset = useCallback((name: PresetName) => presets(name), [presets])

  // Stable identity: the 3D scene is memoised, and an inline arrow here would
  // defeat that by giving it fresh props on every 30 Hz readout render.
  const handleSetTarget = useCallback((q: number) => setQTarget(q), [setQTarget])

  const qDeg = state.q * 180 / Math.PI
  const qTargetDeg = qTarget * 180 / Math.PI
  const errorDeg = qTargetDeg - qDeg
  const usagePct = simResult.KiCrit > 0 ? (params.Ki / simResult.KiCrit) * 100 : 0

  return (
    <div className="app">
      <main className="main-grid">
        {/* ---------------------------------------------------------- scene */}
        <section className="left-panel">
          <div className="scene-host">
            {hasWebGL ? (
              <ArmScene3D
                qRef={qRef}
                qTargetRef={qTargetRef}
                regimeRef={regimeRef}
                onSetTarget={handleSetTarget}
                LRef={LRef}
              />
            ) : (
              <ArmCanvas2D
                q={state.q}
                qTarget={qTarget}
                tau={state.tau}
                regime={simResult.regime}
                onDrag={setTarget}
              />
            )}
            <div className="scene-overlay" aria-hidden="true">
              <div className="canvas-label">θ = {qDeg.toFixed(1)}°</div>
              <div className="canvas-target-label">θ* = {qTargetDeg.toFixed(1)}°</div>
              <div className="canvas-error-label">error = {errorDeg.toFixed(1)}°</div>
            </div>
            {hasWebGL && (
              <div className="scene-hint" aria-hidden="true">
                drag to aim · presets nudge the arm · right-drag to orbit · scroll to zoom
              </div>
            )}
            <div className="scene-badge-stack">
              <span className={`scene-badge regime-${simResult.regime}`}>
                {simResult.regime === 'critically-damped' ? 'critically damped' : simResult.regime}
              </span>
              <span className="scene-badge muted">τ = {state.tau.toFixed(2)} N·m</span>
            </div>
          </div>

          <div className="readout-strip">
            <div className="readout">
              <span className="readout-key">θ</span>
              <span className="readout-val">{qDeg.toFixed(2)}°</span>
            </div>
            <div className="readout">
              <span className="readout-key">θ*</span>
              <span className="readout-val accent">{qTargetDeg.toFixed(2)}°</span>
            </div>
            <div className="readout">
              <span className="readout-key">error</span>
              <span className="readout-val">{errorDeg.toFixed(2)}°</span>
            </div>
            <div className="readout">
              <span className="readout-key">K_i,crit</span>
              <span className="readout-val">{simResult.KiCrit.toFixed(2)}</span>
            </div>
            <div className="readout">
              <span className="readout-key">K_i / K_i,crit</span>
              <span className={`readout-val ${usagePct >= 95 ? 'bad' : ''}`}>{usagePct.toFixed(0)}%</span>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------- equations */}
        <section className="right-panel">
          <MathPanel
            params={params}
            J={simResult.J}
            qTarget={qTarget}
            omegaN={simResult.omegaN}
            zetaMech={simResult.zetaMech}
            poles={simResult.poles}
            kEff={simResult.kEff}
            KiCrit={simResult.KiCrit}
            routhMargin={simResult.routhMargin}
            stable={simResult.stable}
            regime={simResult.regime}
          />

          <div className="controls-card">
            <div className="controls-head">
              <h2 className="panel-title">Controller</h2>
              <div className="preset-row">
                {PRESETS.map((p) => (
                  <button
                    key={p.name}
                    className={`preset-btn ${p.name === 'unstable' ? 'unstable' : ''} ${
                      activePreset === p.name || (!activePreset && simResult.regime === p.name) ? 'active' : ''
                    }`}
                    onClick={() => { setActivePreset(p.name); handlePreset(p.name) }}
                    title={p.detail}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="slider-row">
              <label className="slider-label" htmlFor="kp">
                K_p
              </label>
              <input
                id="kp"
                type="range"
                min={0}
                max={80}
                step={0.1}
                value={params.Kp}
                onChange={(e) => { setActivePreset(null); setParams({ Kp: parseFloat(e.target.value) }) }}
                className="slider"
              />
              <span className="slider-value">{params.Kp.toFixed(1)} N·m/rad</span>
            </div>

            <div className="slider-row">
              <label className="slider-label" htmlFor="ki">
                K_i
              </label>
              <input
                id="ki"
                type="range"
                min={0}
                max={40}
                step={0.05}
                value={params.Ki}
                onChange={(e) => { setActivePreset(null); setParams({ Ki: parseFloat(e.target.value) }) }}
                className="slider"
              />
              <span className="slider-value">{params.Ki.toFixed(2)} N·m·s/rad</span>
            </div>
            <div className="slider-hint">
              Gain here is integral, not derivative: it removes the offset instead of adding damping. Stable
              while K_i &lt; K_i,crit = {simResult.KiCrit.toFixed(2)}.
            </div>

            <div className="action-row">
              <button className="icon-btn" onClick={() => setPaused(!paused)}>
                {paused ? 'Play' : 'Pause'}
              </button>
              <button className="icon-btn" onClick={() => setQTarget(state.q)}>
                Reset target
              </button>
              <button className="icon-btn" onClick={snapToCritical}>
                Snap to K_i,crit
              </button>
              <button className="icon-btn highlight" onClick={applyDisturbance}>
                Disturbance
              </button>
            </div>

            <button
              className="options-toggle"
              onClick={() => setOptionsOpen((v) => !v)}
              aria-expanded={optionsOpen}
            >
              {optionsOpen ? 'Hide actuator options' : 'Actuator options'}
            </button>

            {optionsOpen && (
              <div className="options-content">
                <label className="toggle-row">
                  <input
                    type="checkbox"
                    checked={params.gravityCompensation}
                    onChange={(e) => setParams({ gravityCompensation: e.target.checked })}
                  />
                  <span className="toggle-label">Gravity compensation</span>
                </label>
                <label className="toggle-row">
                  <input
                    type="checkbox"
                    checked={params.tauMax > 0}
                    onChange={(e) => setParams({ tauMax: e.target.checked ? 6 : 0 })}
                  />
                  <span className="toggle-label">Torque saturation (τ_max = 6 N·m)</span>
                </label>
                <div className="slider-row">
                  <label className="slider-label" htmlFor="delay">
                    Delay
                  </label>
                  <input
                    id="delay"
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={params.delayMs}
                    onChange={(e) => setParams({ delayMs: parseFloat(e.target.value) })}
                    className="slider"
                  />
                  <span className="slider-value">{params.delayMs.toFixed(0)} ms</span>
                </div>
              </div>
            )}
          </div>

          <ModeGraph
            params={params}
            q={state.q}
            qdot={state.qdot}
            qTarget={qTarget}
            history={simResult.history}
            active={activePreset}
          />

          <PythonPanel
            params={params}
            qTarget={qTarget}
            J={simResult.J}
            kEff={simResult.kEff}
            KiCrit={simResult.KiCrit}
          />
        </section>
      </main>
    </div>
  )
}

export default App
