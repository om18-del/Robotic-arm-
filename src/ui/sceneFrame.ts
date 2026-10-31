import { Vector3 } from 'three'

/** Right-handed scene frame aligned to the physics convention.

+ X = forward (arm points this way out of the shoulder)
+ Y = left (positive lateral offset points left)
+ Z = up

The right-hand rule about +Z: fingers curl from +X toward +Y.
A shoulder rotation that lifts the arm up and away from +X (toward +Y)
is positive (counterclockwise when the camera looks down the +Z axis).
During dragging we assume the user's primary view direction is roughly -Z,
so a "drag right" on screen raises the arm (positive q). See
ArmScene3D.dragHandler for the exact atan2 / sign logic.
*/
export const FRAME = '+z' as const

/** The three basis vectors of the scene frame. */
export const AXES = Object.freeze({
  forward: new Vector3(1, 0, 0),
  left: new Vector3(0, 1, 0),
  up: new Vector3(0, 0, 1),
})

/** The same three vectors, in the order [forward, up, left]. */
export function axes(): readonly [Vector3, Vector3, Vector3] {
  return [AXES.forward, AXES.up, AXES.left] as const
}


