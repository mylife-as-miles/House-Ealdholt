import type { VillageResidentAvailability } from '../../../../../shared/legacy/aethelgard/characters/village-resident-availability';
import { qualifiedResidentFollowPosition } from '../../../../../shared/legacy/aethelgard/observer/resident-watch';

type Point = { x: number; y: number; z: number };
const finite = (point: Point) => Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z);

/** Translate the existing observer view toward its real qualified resident.
 * Equal camera/target translation preserves offset, distance and orientation.
 * This changes neither simulation nor camera perspective/orbit settings. */
export function updateResidentFollowCamera(camera: Point, target: Point, focus: Point | null,
  availability: VillageResidentAvailability | null, elapsedSeconds: number, reducedMotion: boolean): boolean {
  if (!qualifiedResidentFollowPosition(availability) || !focus || !finite(focus) || !finite(camera) || !finite(target)
    || !Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) return false;
  const amount = reducedMotion ? 1 : -Math.expm1(-5 * elapsedSeconds);
  const x = (focus.x - target.x) * amount, y = (focus.y - target.y) * amount, z = (focus.z - target.z) * amount;
  if (!x && !y && !z) return false;
  camera.x += x; camera.y += y; camera.z += z;
  target.x += x; target.y += y; target.z += z;
  return true;
}
