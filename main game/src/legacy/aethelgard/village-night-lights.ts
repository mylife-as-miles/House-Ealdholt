import {
  Box3, Frustum, Group, InstancedMesh, Matrix4, Mesh, PointLight, Sphere, Vector3,
  type Camera, type Object3D,
} from "three";
import { EALDHOLT_FIRE_ANCHORS } from '../../../../shared/legacy/aethelgard/environment/village-fire';
import { villageNightLightStrength } from '../../../../shared/legacy/aethelgard/environment/village-lights';
import type { WorldEnvironmentState } from '../../../../shared/legacy/aethelgard/environment/world-environment-state';

/** Source-door lights, not invented window meshes. A constant small pool avoids
 * changing every PBR program at dusk. No shadows, collision, geometry or timers.
 * The Native range and inverse-square power follow miniature world scale. */
export function createVillageNightLights(source: Object3D, options: {isExtinguished?(sourcePosition:readonly[number,number,number]):boolean} = {}) {
  const object = new Group(); object.name = 'Ealdholt clock-driven doorway lights';
  object.userData.iwsdkPreviewBounds = 'exclude';
  const inverse = new Matrix4(), matrix = new Matrix4(), instance = new Matrix4();
  const point = new Vector3(), eye = new Vector3(), scaleVector = new Vector3();
  const projection = new Matrix4(), frustum = new Frustum(), sphere = new Sphere();
  const bounds = new Box3(), positions: Vector3[] = [];
  source.updateWorldMatrix(true, true); inverse.copy(source.matrixWorld).invert();
  source.traverse(node => {
    if (!(node instanceof Mesh) || !/Medieval_Modular_Door/i.test(node.name)) return;
    const geometry = node.geometry; if (!geometry.boundingBox) geometry.computeBoundingBox();
    if (!geometry.boundingBox || geometry.boundingBox.isEmpty()) return;
    const count = node instanceof InstancedMesh ? node.count : 1;
    for (let index = 0; index < count && positions.length < 32; index++) {
      matrix.multiplyMatrices(inverse, node.matrixWorld);
      if (node instanceof InstancedMesh) { node.getMatrixAt(index, instance); matrix.multiply(instance); }
      bounds.copy(geometry.boundingBox).applyMatrix4(matrix); bounds.getCenter(point);
      point.y = bounds.min.y + (bounds.max.y - bounds.min.y) * .75;
      if (![point.x, point.y, point.z].every(Number.isFinite)) continue;
      if (!positions.some(p => p.distanceToSquared(point) < 4)) positions.push(point.clone());
    }
  });
  const sourceDoors = positions.length;
  if (!sourceDoors) for (const anchor of EALDHOLT_FIRE_ANCHORS) {
    positions.push(new Vector3(...anchor.position).add(new Vector3(0, anchor.height * .42, 0)));
  }
  const points = positions.map(position => ({ position, sourcePosition:[position.x,position.y,position.z] as const, world: new Vector3(), score: Infinity, selected: false }));
  const lights = Array.from({ length: 4 }, (_, index) => {
    const light = new PointLight(0xffb66d, 0, 9, 2);
    light.name = 'Ealdholt night light slot ' + index; light.castShadow = false;
    light.userData.crownfallNightLight = true; object.add(light); return light;
  });
  const stats = { source: sourceDoors ? 'actual-source-door-centres' : 'actual-source-hearth-fallback',
    emitters: points.length, sourceDoors, pool: lights.length, active: 0, strength: 0, worldScale: 1,
    clock: 'existing-persisted-village-clock', shadowLights: 0 };
  let disposed = false;
  return {
    object, lights, stats,
    update(state: WorldEnvironmentState | null, camera: Camera, quality: 'low' | 'medium' | 'high'): boolean {
      if (disposed) return false;
      const strength = villageNightLightStrength(state);
      source.updateWorldMatrix(true, false); source.getWorldScale(scaleVector);
      const scale = Math.max(Math.abs(scaleVector.x), Math.abs(scaleVector.y), Math.abs(scaleVector.z));
      camera.updateWorldMatrix(true, false); camera.getWorldPosition(eye);
      projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(projection);
      let parentVisible = true;
      for (let node: Object3D | null = source; node; node = node.parent) if (!node.visible) parentVisible = false;
      for (const entry of points) {
        entry.selected = false; entry.world.copy(entry.position).applyMatrix4(source.matrixWorld);
        sphere.center.copy(entry.world); sphere.radius = 9 * scale;
        entry.score = parentVisible && strength > 0 && !options.isExtinguished?.(entry.sourcePosition) && Number.isFinite(scale) && scale > 0
          && frustum.intersectsSphere(sphere) ? eye.distanceToSquared(entry.world) : Infinity;
      }
      const limit = quality === 'low' ? 1 : quality === 'high' ? 4 : 2;
      let changed = stats.strength !== strength || stats.worldScale !== scale, active = 0;
      for (let slot = 0; slot < lights.length; slot++) {
        let selected: typeof points[number] | undefined;
        if (slot < limit) for (const entry of points) {
          if (!entry.selected && Number.isFinite(entry.score) && (!selected || entry.score < selected.score)) selected = entry;
        }
        const light = lights[slot], intensity = selected ? 12 * scale * scale * strength : 0;
        if (selected) { selected.selected = true; changed ||= !light.position.equals(selected.position); light.position.copy(selected.position); active++; }
        changed ||= light.intensity !== intensity || light.distance !== 9 * scale;
        light.intensity = intensity; light.distance = 9 * scale;
        // Always visible, including at zero intensity: keep light-count shader defines stable.
      }
      stats.active = active; stats.strength = strength; stats.worldScale = scale;
      return changed;
    },
    dispose() { if (disposed) return; disposed = true; for (const light of lights) light.intensity = 0; stats.active = 0; object.removeFromParent(); object.clear(); },
  };
}
export type VillageNightLights = ReturnType<typeof createVillageNightLights>;
