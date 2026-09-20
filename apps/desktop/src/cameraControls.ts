import { Box3, Ray, Vector3 } from "three";

const MINIMUM_ORBIT_DISTANCE = 1;

export interface OrbitTargetAfterFlightOptions {
  cameraPosition: Vector3;
  viewDirection: Vector3;
  contentBounds: Box3 | null;
  previousOrbitDistance: number;
}

/**
 * Keeps the camera looking in exactly the same direction while restoring a
 * useful orbit pivot after free flight. When the build is in view, the pivot
 * is placed at the build's depth instead of an arbitrary distance in front of
 * the camera. Looking away from the build retains the previous orbit radius.
 */
export function calculateOrbitTargetAfterFlight(
  options: OrbitTargetAfterFlightOptions,
  target = new Vector3(),
): Vector3 {
  const direction = options.viewDirection.clone();
  if (direction.lengthSq() === 0) direction.set(0, 0, -1);
  direction.normalize();

  const previousDistance = Number.isFinite(options.previousOrbitDistance)
    ? Math.max(MINIMUM_ORBIT_DISTANCE, options.previousOrbitDistance)
    : MINIMUM_ORBIT_DISTANCE;
  let targetDistance = previousDistance;

  const bounds = options.contentBounds;
  if (bounds !== null && !bounds.isEmpty()) {
    const size = bounds.getSize(new Vector3());
    const margin = Math.max(0.5, size.length() * 0.05);
    const expandedBounds = bounds.clone().expandByScalar(margin);
    const viewRay = new Ray(options.cameraPosition, direction);

    if (viewRay.intersectsBox(expandedBounds)) {
      const boundsCenter = bounds.getCenter(new Vector3());
      const depth = boundsCenter.sub(options.cameraPosition).dot(direction);
      if (depth >= MINIMUM_ORBIT_DISTANCE) targetDistance = depth;
    }
  }

  return target.copy(options.cameraPosition).addScaledVector(direction, targetDistance);
}
