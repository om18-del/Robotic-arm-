import { memo, useCallback, useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import type { ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import {
  OrbitControls,
  Environment,
  Lightformer,
  ContactShadows,
  Grid,
} from '@react-three/drei'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import type { Regime } from '../sim/analysis'

/* ------------------------------------------------------------------ *
 * Dimensions (units where L = 0.5; the whole rig is scaled by L/0.5)
 * The single actuated DOF is the shoulder about +Z. At q = 0 the arm
 * lies along +X (horizontal), matching tau_g = m g (L/2) cos q.
 * ------------------------------------------------------------------ */
const D = {
  plinthH: 0.075,
  columnTop: 0.45,
  shoulderY: 0.66,
  /** pedestal axis sits behind the shoulder pivot, like a real manipulator */
  columnOffsetX: -0.09,
  shoulderR: 0.098,
  upperLen: 0.26,
  foreLen: 0.19,
  wristX: 0.45,
  tipX: 0.66,
  baseHalfW: 0.31,
  baseHalfD: 0.25,
}

/* ----------------------------- palette ----------------------------- */
const PAINT = '#cf5a20'
const PAINT_DARK = '#8e3b12'
const GRAPHITE = '#2a2f38'
const GRAPHITE_LIGHT = '#3a424e'
const STEEL = '#a7b0bb'
const RUBBER = '#12141a'
const YELLOW = '#e8b33a'

/* Shared materials — created once, reused across every instance. */
const M = {
  paint: new THREE.MeshStandardMaterial({ color: PAINT, metalness: 0.35, roughness: 0.38 }),
  paintDark: new THREE.MeshStandardMaterial({ color: PAINT_DARK, metalness: 0.4, roughness: 0.46 }),
  graphite: new THREE.MeshStandardMaterial({ color: GRAPHITE, metalness: 0.62, roughness: 0.42 }),
  graphiteLight: new THREE.MeshStandardMaterial({ color: GRAPHITE_LIGHT, metalness: 0.58, roughness: 0.36 }),
  steel: new THREE.MeshStandardMaterial({ color: STEEL, metalness: 0.95, roughness: 0.26 }),
  chrome: new THREE.MeshStandardMaterial({ color: '#e4ebf3', metalness: 1, roughness: 0.1 }),
  bolt: new THREE.MeshStandardMaterial({ color: '#c9d1da', metalness: 0.95, roughness: 0.32 }),
  rubber: new THREE.MeshStandardMaterial({ color: RUBBER, metalness: 0.06, roughness: 0.92 }),
  label: new THREE.MeshStandardMaterial({ color: YELLOW, metalness: 0.15, roughness: 0.55 }),
}

const ghostMat = new THREE.MeshStandardMaterial({
  color: '#ffb36b',
  emissive: '#ff8c42',
  emissiveIntensity: 0.45,
  transparent: true,
  opacity: 0.14,
  metalness: 0.1,
  roughness: 0.6,
  depthWrite: false,
})

/* --------------------------- primitives ---------------------------- */
function Bolt({
  position,
  rotation = [0, 0, 0],
  r = 0.0075,
}: {
  position: [number, number, number]
  rotation?: [number, number, number]
  r?: number
}) {
  return (
    <mesh position={position} rotation={rotation} material={M.bolt} castShadow>
      <cylinderGeometry args={[r, r * 0.85, r * 0.9, 6]} />
    </mesh>
  )
}

function BoltCircle({
  count,
  radius,
  z,
  origin = [0, 0],
  rotation = [Math.PI / 2, 0, 0],
  r = 0.0065,
}: {
  count: number
  radius: number
  z: number
  origin?: [number, number]
  rotation?: [number, number, number]
  r?: number
}) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => {
        const a = (i / count) * Math.PI * 2 + Math.PI / count
        return (
          <Bolt
            key={i}
            r={r}
            rotation={rotation}
            position={[
              origin[0] + Math.cos(a) * radius,
              origin[1] + Math.sin(a) * radius,
              z,
            ]}
          />
        )
      })}
    </>
  )
}

/* --------------------------- static base --------------------------- */
const Base = memo(function Base() {
  return (
    <group>
      {/* rubber isolation feet */}
      {[-1, 1].map((sx) =>
        [-1, 1].map((sz) => (
          <mesh
            key={`${sx}${sz}`}
            position={[sx * (D.baseHalfW - 0.05), 0.006, sz * (D.baseHalfD - 0.05)]}
            material={M.rubber}
            castShadow
          >
            <cylinderGeometry args={[0.032, 0.036, 0.012, 20]} />
          </mesh>
        )),
      )}

      {/* cast plinth */}
      <mesh position={[0, D.plinthH / 2 + 0.012, 0]} material={M.graphite} castShadow receiveShadow>
        <boxGeometry args={[D.baseHalfW * 2, D.plinthH, D.baseHalfD * 2]} />
      </mesh>
      {/* chamfered top plate */}
      <mesh position={[0, D.plinthH + 0.024, 0]} material={M.graphiteLight} castShadow receiveShadow>
        <boxGeometry args={[D.baseHalfW * 1.84, 0.024, D.baseHalfD * 1.82]} />
      </mesh>
      {/* machined steel deck */}
      <mesh position={[0, D.plinthH + 0.038, 0]} material={M.steel} receiveShadow>
        <cylinderGeometry args={[0.185, 0.185, 0.012, 56]} />
      </mesh>
      {/* orange safety trim on the deck edge */}
      <mesh position={[0, D.plinthH + 0.038, 0]} rotation={[Math.PI / 2, 0, 0]} material={M.paint}>
        <torusGeometry args={[0.185, 0.007, 10, 64]} />
      </mesh>

      {/* mounting bolts on the plinth corners */}
      {[-1, 1].map((sx) =>
        [-1, 1].map((sz) => (
          <Bolt
            key={`b${sx}${sz}`}
            position={[sx * (D.baseHalfW - 0.035), D.plinthH + 0.038, sz * (D.baseHalfD - 0.035)]}
            r={0.011}
          />
        )),
      )}

      {/* connector / cable gland at the rear */}
      <mesh position={[0, 0.05, -D.baseHalfD + 0.012]} rotation={[Math.PI / 2, 0, 0]} material={M.steel}>
        <cylinderGeometry args={[0.022, 0.022, 0.05, 20]} />
      </mesh>
      <mesh position={[0, 0.05, -D.baseHalfD - 0.01]} rotation={[Math.PI / 2, 0, 0]} material={M.rubber}>
        <cylinderGeometry args={[0.014, 0.02, 0.03, 16]} />
      </mesh>
    </group>
  )
})

/* -------------------------- turret column -------------------------- */
const Turret = memo(function Turret() {
  const colH = D.columnTop - 0.11
  return (
    <group>
      {/* tapered turret skirt */}
      <mesh position={[0, 0.115, 0]} material={M.graphite} castShadow receiveShadow>
        <cylinderGeometry args={[0.148, 0.178, 0.06, 48]} />
      </mesh>
      {/* rotary bearing ring */}
      <mesh position={[0, 0.148, 0]} rotation={[Math.PI / 2, 0, 0]} material={M.steel} castShadow>
        <torusGeometry args={[0.146, 0.013, 14, 56]} />
      </mesh>
      <BoltCircle count={10} radius={0.146} z={0.148} rotation={[Math.PI / 2, 0, 0]} r={0.005} />

      {/* main column */}
      <mesh position={[0, 0.15 + colH / 2, 0]} material={M.graphiteLight} castShadow receiveShadow>
        <cylinderGeometry args={[0.126, 0.134, colH, 40]} />
      </mesh>
      {/* orange identity band */}
      <mesh position={[0, 0.22, 0]} material={M.paint} castShadow>
        <cylinderGeometry args={[0.131, 0.133, 0.03, 40]} />
      </mesh>
      {/* rear cable duct */}
      <mesh position={[0, 0.15 + colH / 2, -0.132]} material={M.rubber}>
        <boxGeometry args={[0.05, colH * 0.86, 0.03]} />
      </mesh>
      {/* column top flange */}
      <mesh position={[0, D.columnTop, 0]} material={M.graphite} castShadow>
        <cylinderGeometry args={[0.13, 0.124, 0.022, 40]} />
      </mesh>
      {/* warning label */}
      <mesh position={[0.1, 0.33, 0.062]} rotation={[0, 0.9, 0]} material={M.label}>
        <boxGeometry args={[0.045, 0.024, 0.002]} />
      </mesh>
    </group>
  )
})

/* ------------------------------ yoke ------------------------------- */
const Yoke = memo(function Yoke() {
  const plateY = (D.columnTop + D.shoulderY) / 2 + 0.02
  const plateH = D.shoulderY - D.columnTop + 0.16
  return (
    <group>
      {[-1, 1].map((sz) => (
        <group key={sz}>
          <mesh position={[0, plateY, sz * 0.092]} material={M.paint} castShadow receiveShadow>
            <boxGeometry args={[0.118, plateH, 0.042]} />
          </mesh>
          {/* machined pad around the bearing */}
          <mesh
            position={[0, D.shoulderY, sz * 0.114]}
            rotation={[Math.PI / 2, 0, 0]}
            material={M.steel}
            castShadow
          >
            <cylinderGeometry args={[0.062, 0.062, 0.014, 32]} />
          </mesh>
          <BoltCircle
            count={8}
            radius={0.05}
            z={sz * 0.122}
            origin={[0, D.shoulderY]}
            rotation={[Math.PI / 2, 0, 0]}
            r={0.0055}
          />
        </group>
      ))}
      {/* cross brace tying the plates to the turret column */}
      <mesh
        position={[D.columnOffsetX / 2, D.columnTop + 0.045, 0]}
        material={M.graphite}
        castShadow
      >
        <boxGeometry args={[0.16, 0.06, 0.19]} />
      </mesh>
    </group>
  )
})

/* --------------------------- shoulder unit ------------------------- */
const ShoulderUnit = memo(function ShoulderUnit() {
  return (
    <group>
      {/* main shoulder housing, bearing axis along Z */}
      <mesh rotation={[Math.PI / 2, 0, 0]} material={M.paint} castShadow receiveShadow>
        <cylinderGeometry args={[D.shoulderR, D.shoulderR, 0.17, 48]} />
      </mesh>
      {/* end caps */}
      {[-1, 1].map((sz) => (
        <mesh
          key={sz}
          position={[0, 0, sz * 0.088]}
          rotation={[Math.PI / 2, 0, 0]}
          material={M.graphite}
          castShadow
        >
          <cylinderGeometry args={[D.shoulderR * 0.72, D.shoulderR * 0.78, 0.018, 36]} />
        </mesh>
      ))}
      {/* seam line around the housing */}
      <mesh rotation={[Math.PI / 2, 0, 0]} material={M.paintDark}>
        <torusGeometry args={[D.shoulderR + 0.001, 0.004, 8, 56]} />
      </mesh>
      {/* motor/gearbox boss at the back of the arm */}
      <mesh position={[-0.075, -0.03, 0]} rotation={[0, 0, Math.PI / 2]} material={M.graphite} castShadow>
        <cylinderGeometry args={[0.052, 0.058, 0.09, 28]} />
      </mesh>
      <mesh position={[-0.12, -0.03, 0]} rotation={[0, 0, Math.PI / 2]} material={M.steel} castShadow>
        <cylinderGeometry args={[0.045, 0.045, 0.012, 28]} />
      </mesh>
    </group>
  )
})

/* ---------------------------- upper arm ---------------------------- */
const UpperArm = memo(function UpperArm() {
  const cx = 0.055 + (D.upperLen - 0.055) / 2
  const len = D.upperLen - 0.055
  return (
    <group>
      {/* cast link body */}
      <mesh position={[cx, 0, 0]} material={M.paint} castShadow receiveShadow>
        <boxGeometry args={[len, 0.118, 0.096]} />
      </mesh>
      {/* top and bottom ribs */}
      {[-1, 1].map((sy) => (
        <mesh key={sy} position={[cx, sy * 0.064, 0]} material={M.paintDark} castShadow>
          <boxGeometry args={[len * 0.84, 0.014, 0.062]} />
        </mesh>
      ))}
      {/* machined mating faces at both ends */}
      {[0.06, D.upperLen - 0.018].map((x, i) => (
        <mesh key={i} position={[x, 0, 0]} material={M.graphiteLight} castShadow>
          <boxGeometry args={[0.028, 0.122, 0.1]} />
        </mesh>
      ))}
      {/* cable conduit along the front face */}
      <mesh position={[cx, -0.012, 0.058]} rotation={[0, 0, Math.PI / 2]} material={M.rubber}>
        <cylinderGeometry args={[0.012, 0.012, len * 0.9, 14]} />
      </mesh>
      {[0.1, 0.19].map((x, i) => (
        <mesh key={i} position={[x, -0.012, 0.058]} rotation={[0, 0, Math.PI / 2]} material={M.graphite}>
          <cylinderGeometry args={[0.016, 0.016, 0.012, 14]} />
        </mesh>
      ))}
      {/* counterweight lump opposite the elbow drive */}
      <mesh position={[0.075, 0.072, 0]} material={M.graphite} castShadow>
        <boxGeometry args={[0.05, 0.026, 0.07]} />
      </mesh>
    </group>
  )
})

/* ------------------------------ elbow ------------------------------ */
const Elbow = memo(function Elbow() {
  return (
    <group position={[D.upperLen, 0, 0]}>
      <mesh rotation={[Math.PI / 2, 0, 0]} material={M.paintDark} castShadow receiveShadow>
        <cylinderGeometry args={[0.072, 0.072, 0.15, 40]} />
      </mesh>
      {[-1, 1].map((sz) => (
        <group key={sz}>
          <mesh
            position={[0, 0, sz * 0.079]}
            rotation={[Math.PI / 2, 0, 0]}
            material={M.steel}
            castShadow
          >
            <cylinderGeometry args={[0.05, 0.05, 0.014, 30]} />
          </mesh>
          <BoltCircle
            count={6}
            radius={0.038}
            z={sz * 0.087}
            rotation={[Math.PI / 2, 0, 0]}
            r={0.0045}
          />
        </group>
      ))}
      {/* wrist drive servo slung under the elbow */}
      <mesh position={[0.02, -0.082, 0]} rotation={[0, 0, Math.PI / 2]} material={M.graphite} castShadow>
        <cylinderGeometry args={[0.038, 0.038, 0.08, 24]} />
      </mesh>
      <mesh position={[-0.022, -0.082, 0]} rotation={[0, 0, Math.PI / 2]} material={M.steel}>
        <cylinderGeometry args={[0.03, 0.03, 0.01, 24]} />
      </mesh>
    </group>
  )
})

/* ----------------------------- forearm ----------------------------- */
const Forearm = memo(function Forearm() {
  const start = D.upperLen + 0.01
  const len = D.wristX - start - 0.01
  const cx = start + len / 2
  return (
    <group>
      <mesh position={[cx, 0, 0]} material={M.paint} castShadow receiveShadow>
        <boxGeometry args={[len, 0.088, 0.074]} />
      </mesh>
      {[-1, 1].map((sy) => (
        <mesh key={sy} position={[cx, sy * 0.048, 0]} material={M.paintDark} castShadow>
          <boxGeometry args={[len * 0.9, 0.012, 0.05]} />
        </mesh>
      ))}
      {/* cable run on top of the forearm */}
      <mesh position={[cx, 0.056, 0]} rotation={[0, 0, Math.PI / 2]} material={M.rubber}>
        <cylinderGeometry args={[0.009, 0.009, len * 0.95, 12]} />
      </mesh>
      {/* wrist camera / tool sensor */}
      <mesh position={[cx + 0.02, -0.052, 0]} material={M.graphite} castShadow>
        <boxGeometry args={[0.042, 0.024, 0.042]} />
      </mesh>
      <mesh position={[cx + 0.02, -0.058, 0.014]} material={M.chrome}>
        <sphereGeometry args={[0.007, 12, 12]} />
      </mesh>
    </group>
  )
})

/* ------------------------- wrist and gripper ------------------------ */
const WristTool = memo(function WristTool() {
  return (
    <group>
      {/* wrist roll housing */}
      <mesh position={[D.wristX + 0.028, 0, 0]} rotation={[0, 0, Math.PI / 2]} material={M.steel} castShadow>
        <cylinderGeometry args={[0.042, 0.042, 0.056, 32]} />
      </mesh>
      <mesh position={[D.wristX + 0.008, 0, 0]} rotation={[0, 0, Math.PI / 2]} material={M.graphite}>
        <cylinderGeometry args={[0.046, 0.046, 0.012, 32]} />
      </mesh>
      {/* tool flange */}
      <mesh position={[D.wristX + 0.06, 0, 0]} rotation={[0, 0, Math.PI / 2]} material={M.chrome} castShadow>
        <cylinderGeometry args={[0.034, 0.034, 0.012, 32]} />
      </mesh>

      {/* parallel two-finger gripper */}
      <group position={[D.wristX + 0.085, 0, 0]}>
        <mesh material={M.graphite} castShadow receiveShadow>
          <boxGeometry args={[0.05, 0.078, 0.082]} />
        </mesh>
        <mesh position={[0.028, 0, 0]} material={M.label} castShadow>
          <boxGeometry args={[0.012, 0.03, 0.06]} />
        </mesh>
        {/* jaws */}
        {[-1, 1].map((sz) => (
          <group key={sz}>
            <mesh position={[0.062, 0, sz * 0.032]} material={M.steel} castShadow>
              <boxGeometry args={[0.088, 0.052, 0.014]} />
            </mesh>
            <mesh position={[0.087, 0, sz * 0.024]} material={M.rubber} castShadow>
              <boxGeometry args={[0.036, 0.034, 0.006]} />
            </mesh>
            {/* tapered finger tip */}
            <mesh position={[0.108, 0, sz * 0.032]} rotation={[0, 0, -0.24]} material={M.steel} castShadow>
              <boxGeometry args={[0.026, 0.04, 0.012]} />
            </mesh>
          </group>
        ))}
        {/* jaw actuator */}
        <mesh position={[0.012, 0.046, 0]} rotation={[0, 0, Math.PI / 2]} material={M.graphite} castShadow>
          <cylinderGeometry args={[0.018, 0.018, 0.05, 18]} />
        </mesh>
      </group>
    </group>
  )
})

/* ------------------- status ring (regime coloured) ------------------ */


/* ------------------- status ring (regime coloured) ------------------ */
function StatusRing({ regimeRef }: { regimeRef: { current: string } }) {
  const mat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#5aff8a',
        emissive: new THREE.Color('#5aff8a'),
        emissiveIntensity: 1.4,
        metalness: 0.2,
        roughness: 0.5,
      }),
    [],
  )
  const colors: Record<Regime, string> = {
    underdamped: '#5aff8a',
    'critically-damped': '#ffd24a',
    overdamped: '#ff8c42',
    unstable: '#ff4d4d',
  }
  useFrame(() => {
    const c = colors[(regimeRef.current as Regime) ?? 'underdamped'] ?? '#5aff8a'
    if (mat.emissive.getHexString() !== c.slice(1)) {
      mat.emissive.set(c)
      mat.color.set(c)
    }
  })
  return (
    <mesh position={[0, 0, 0.101]} material={mat}>
      <torusGeometry args={[0.05, 0.006, 10, 48]} />
    </mesh>
  )
}

/* ------------------------- target ghost arm ------------------------ */
const GhostArm = memo(function GhostArm() {
  return (
    <group>
      <mesh position={[0.16, 0, 0]} material={ghostMat}>
        <boxGeometry args={[0.24, 0.1, 0.085]} />
      </mesh>
      <mesh position={[0.36, 0, 0]} material={ghostMat}>
        <boxGeometry args={[0.2, 0.078, 0.066]} />
      </mesh>
      <mesh position={[D.wristX + 0.03, 0, 0]} material={ghostMat}>
        <boxGeometry args={[0.08, 0.05, 0.05]} />
      </mesh>
      <mesh position={[D.tipX - 0.02, 0, 0]} material={ghostMat}>
        <boxGeometry args={[0.1, 0.06, 0.05]} />
      </mesh>
    </group>
  )
})

/* --------------------------- drag handling -------------------------- */
function useAim(
  onSetTarget: (q: number) => void,
  shoulderY: number,
  getControls: () => { enabled: boolean } | null,
) {
  const dragging = useRef(false)
  const tmpNormal = useMemo(() => new THREE.Vector3(), [])
  const tmpPoint = useMemo(() => new THREE.Vector3(), [])
  const tmpOrigin = useMemo(() => new THREE.Vector3(0, shoulderY, 0), [shoulderY])
  const plane = useMemo(() => new THREE.Plane(), [])
  const { camera } = useThree()

  const aim = useCallback(
    (ray: THREE.Ray) => {
      camera.getWorldDirection(tmpNormal)
      plane.setFromNormalAndCoplanarPoint(tmpNormal, tmpOrigin)
      if (!ray.intersectPlane(plane, tmpPoint)) return
      const dx = tmpPoint.x
      const dy = tmpPoint.y - shoulderY
      if (Math.hypot(dx, dy) < 1e-4) return
      const lim = Math.PI / 2
      onSetTarget(Math.max(-lim, Math.min(lim, Math.atan2(dy, dx))))
    },
    [camera, onSetTarget, plane, shoulderY, tmpNormal, tmpOrigin, tmpPoint],
  )

  useEffect(() => {
    const release = () => {
      if (!dragging.current) return
      dragging.current = false
      const c = getControls()
      if (c) c.enabled = true
    }
    window.addEventListener('pointerup', release)
    window.addEventListener('pointercancel', release)
    return () => {
      window.removeEventListener('pointerup', release)
      window.removeEventListener('pointercancel', release)
    }
  }, [getControls])

  const onPointerDown = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      const ev = e.nativeEvent
      const primary = ev.pointerType === 'touch' ? true : ev.button === 0
      if (!primary) return
      dragging.current = true
      const c = getControls()
      if (c) c.enabled = false
      e.stopPropagation()
      aim(e.ray)
    },
    [aim, getControls],
  )

  const onPointerMove = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (!dragging.current) return
      e.stopPropagation()
      aim(e.ray)
    },
    [aim],
  )

  return { onPointerDown, onPointerMove }
}

/* ------------------------------- scene ------------------------------ */
interface SceneProps {
  qRef: { current: number }
  qTargetRef: { current: number }
  regimeRef: { current: string }
  LRef: { current: number }
  onSetTarget: (q: number) => void
}

function Rig({ qRef, qTargetRef, regimeRef, LRef, onSetTarget }: SceneProps) {
  const s = (LRef.current || 0.5) / 0.5
  const shoulderY = D.shoulderY * s

  const armRef = useRef<THREE.Group>(null)
  const ghostRef = useRef<THREE.Group>(null)
  const controlsRef = useRef<OrbitControlsImpl | null>(null)

  const getControls = useCallback(() => controlsRef.current, [])
  const { onPointerDown, onPointerMove } = useAim(onSetTarget, shoulderY, getControls)

  useFrame(() => {
    if (armRef.current) armRef.current.rotation.z = qRef.current
    if (ghostRef.current) ghostRef.current.rotation.z = qTargetRef.current
  })

  // Local to the (rotated) ghost group, so it always lands on the ghost's tool tip.
  const tipX = D.tipX - 0.03
  const tipMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#ffc36b' }), [])

  return (
    <group scale={s} onPointerDown={onPointerDown} onPointerMove={onPointerMove}>
      {/* ---------------------------- lighting --------------------------- */}
      <hemisphereLight args={['#a8bcdd', '#171b22', 0.6]} />
      <directionalLight
        position={[1.8, 2.6, 1.6]}
        intensity={2.6}
        color="#fff3e6"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-camera-left={-1.4}
        shadow-camera-right={1.4}
        shadow-camera-top={1.6}
        shadow-camera-bottom={-0.6}
        shadow-camera-near={0.1}
        shadow-camera-far={8}
      />
      <directionalLight position={[-2.2, 1.4, -1.4]} intensity={0.9} color="#8fb2ff" />
      <spotLight
        position={[0.4, 2.2, 1.8]}
        angle={0.7}
        penumbra={1}
        intensity={14}
        distance={7}
        color="#ffcf9e"
      />

      <Environment resolution={128} frames={1}>
        <Lightformer intensity={1.6} position={[0, 2, 1.2]} scale={[3, 3, 1]} />
        <Lightformer intensity={0.9} position={[-2, 1, -1]} scale={[2, 2, 1]} color="#9dc4ff" />
        <Lightformer intensity={0.5} position={[2, 0.4, -1.4]} scale={[2, 2, 1]} color="#ffb37a" />
      </Environment>

      {/* ----------------------------- ground --------------------------- */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <circleGeometry args={[1.9, 72]} />
        <meshStandardMaterial color="#0b0e14" metalness={0.15} roughness={0.88} />
      </mesh>
      <Grid
        args={[4, 4]}
        cellSize={0.1}
        cellThickness={0.5}
        cellColor="#1b2331"
        sectionSize={0.5}
        sectionThickness={1}
        sectionColor="#26324a"
        fadeDistance={3.2}
        fadeStrength={1.4}
        infiniteGrid
        position={[0, 0.001, 0]}
      />
      <ContactShadows
        position={[0, 0.002, 0]}
        opacity={0.62}
        scale={1.9}
        blur={2.4}
        far={0.7}
        resolution={512}
        frames={1}
      />

      {/* --------------------------- structure -------------------------- */}
      <group position={[D.columnOffsetX, 0, 0]}>
        <Base />
        <Turret />
      </group>
      <Yoke />

      {/* --------------------------- actuated arm ----------------------- */}
      <group ref={armRef} position={[0, D.shoulderY, 0]}>
        <ShoulderUnit />
        <StatusRing regimeRef={regimeRef} />
        <UpperArm />
        <Elbow />
        <Forearm />
        <WristTool />
      </group>

      {/* ------------------------- goal pose ghost ---------------------- */}
      <group ref={ghostRef} position={[0, D.shoulderY, 0]}>
        <GhostArm />
        <mesh position={[tipX, 0, 0]} material={tipMat}>
          <sphereGeometry args={[0.02, 16, 16]} />
        </mesh>
        <mesh position={[tipX, 0, 0]} material={ghostMat}>
          <sphereGeometry args={[0.04, 16, 16]} />
        </mesh>
      </group>

      {/* invisible backdrop so drags anywhere on the canvas aim the arm */}
      <mesh position={[0.1, 0.4, 0]}>
        <planeGeometry args={[3.4, 3]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
      </mesh>

      <OrbitControls
        ref={controlsRef}
        makeDefault
        enableDamping
        dampingFactor={0.07}
        enablePan={false}
        minDistance={1.4 * s}
        maxDistance={4.4 * s}
        minPolarAngle={0.18 * Math.PI}
        maxPolarAngle={0.49 * Math.PI}
        target={[0.2 * s, 0.62 * s, 0]}
        rotateSpeed={0.85}
        zoomSpeed={1}
      />
    </group>
  )
}

/* ------------------------------- public ----------------------------- */
// Memoised: App re-renders ~30 times a second to refresh the readouts, and
// without this the whole scene graph was reconciled every time — the dropped
// frames that made the arm look like it stuttered. Every prop is a stable ref
// or callback, so this now only re-renders if one of them changes.
export default memo(function ArmScene3D(props: SceneProps) {
  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      camera={{ position: [1.15, 1.3, 2.1], fov: 42, near: 0.01, far: 50 }}
    >
      <color attach="background" args={['#080a0f']} />
      <fog attach="fog" args={['#080a0f', 2.8, 6]} />
      <Rig {...props} />
    </Canvas>
  )
})
