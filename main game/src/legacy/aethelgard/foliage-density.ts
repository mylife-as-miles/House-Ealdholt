import { Box3, InstancedMesh, Matrix4, Sphere, type Object3D } from 'three';
import { createEaldholtFoliageDensityWithAdapter, type EaldholtFoliageDensity, type EaldholtFoliageQuality } from '../../../../shared/legacy/aethelgard/environment/foliage-density';
export type { EaldholtFoliageDensity, EaldholtFoliageQuality } from '../../../../shared/legacy/aethelgard/environment/foliage-density';

/** Instance-owned clones only. Untagged actors remain untouched. HIGH-pool
 * bounds are built without writing shared geometry or matrix buffers. Keep the
 * full authored pool in comfort/framing measurements before selecting a tier. */
export function createEaldholtFoliageDensity(root: Object3D, initialQuality: EaldholtFoliageQuality): EaldholtFoliageDensity {
  const matrix = new Matrix4(), localBox = new Box3(), instanceBox = new Box3();
  const originalVisible = new WeakMap<InstancedMesh, boolean>();
  return createEaldholtFoliageDensityWithAdapter(root, initialQuality, {
    children: node => node.children,
    metadata: node => node.userData.crownfallFoliageDensity,
    component: node => node instanceof InstancedMesh ? node : null,
    drawable(node) {
      const item = node as Object3D & { isMesh?: boolean; isLine?: boolean; isPoints?: boolean; isSprite?: boolean };
      return !!(item.isMesh || item.isLine || item.isPoints || item.isSprite);
    },
    inspect(mesh, high) {
      const geometry = mesh.geometry, position = geometry.getAttribute('position');
      const full = geometry.index?.count ?? position?.count ?? 0;
      let complete = !!position && Number.isSafeInteger(full) && full > 0 && full % 3 === 0
        && geometry.drawRange.start === 0 && (geometry.drawRange.count === Infinity || geometry.drawRange.count === full)
        && !geometry.isInstancedBufferGeometry && !geometry.morphAttributes.position?.length && !mesh.morphTexture;
      let draws = 1;
      if (Array.isArray(mesh.material)) {
        const groups = [...geometry.groups].sort((a, b) => a.start - b.start); let covered = 0;
        for (const group of groups) {
          if (!Number.isSafeInteger(group.start) || !Number.isSafeInteger(group.count) || group.start !== covered
            || group.count <= 0 || group.count % 3 !== 0 || !Number.isSafeInteger(group.materialIndex)
            || !mesh.material[group.materialIndex!]) complete = false;
          covered += group.count;
        }
        if (covered !== full || !groups.length) complete = false;
        draws = groups.length;
      }
      if (mesh.instanceMatrix.itemSize !== 16 || !Number.isSafeInteger(mesh.instanceMatrix.count)
        || high > mesh.instanceMatrix.count) complete = false;
      if (complete) {
        for (let i = 0; i < high; i++) {
          mesh.getMatrixAt(i, matrix);
          if (!matrix.elements.every(Number.isFinite) || matrix.elements[3] !== 0 || matrix.elements[7] !== 0 || matrix.elements[11] !== 0 || matrix.elements[15] !== 1) { complete = false; break; }
        }
        localBox.setFromBufferAttribute(position);
        if (localBox.isEmpty() || ![...localBox.min.toArray(), ...localBox.max.toArray()].every(Number.isFinite)) complete = false;
        for (const box of [geometry.boundingBox, mesh.boundingBox]) if (box && !box.isEmpty() && ![...box.min.toArray(), ...box.max.toArray()].every(Number.isFinite)) complete = false;
        const sphere = mesh.boundingSphere;
        if (sphere && !sphere.isEmpty() && (!Number.isFinite(sphere.radius) || !sphere.center.toArray().every(Number.isFinite))) complete = false;
      }
      return { capacity: mesh.instanceMatrix.count, initialCount: mesh.count, trianglesPerActor: full / 3, draws, completeGeometry: complete };
    },
    snapshot(mesh) {
      originalVisible.set(mesh, mesh.visible);
      return { count: mesh.count, visible: mesh.visible, box: mesh.boundingBox, sphere: mesh.boundingSphere };
    },
    primeHighBounds(mesh, high) {
      localBox.setFromBufferAttribute(mesh.geometry.getAttribute('position'));
      if (mesh.geometry.boundingBox && !mesh.geometry.boundingBox.isEmpty()) localBox.union(mesh.geometry.boundingBox);
      const highBox = new Box3();
      for (let i = 0; i < high; i++) { mesh.getMatrixAt(i, matrix); instanceBox.copy(localBox).applyMatrix4(matrix); highBox.union(instanceBox); }
      // Bounding boxes stage real geometry; a normal culling sphere must not
      // become an empty cube that expands model comfort/framing bounds.
      if (mesh.boundingBox && !mesh.boundingBox.isEmpty()) highBox.union(mesh.boundingBox);
      const highSphere = highBox.getBoundingSphere(new Sphere());
      // Preserve optional sphere padding separately, without touching its owner.
      if (mesh.boundingSphere && !mesh.boundingSphere.isEmpty()) highSphere.union(mesh.boundingSphere);
      mesh.boundingBox = highBox;
      mesh.boundingSphere = highSphere;
    },
    select(mesh, count) { mesh.count = count; mesh.visible = originalVisible.get(mesh) === true && count > 0; },
    restore(mesh, snapshot) {
      mesh.count = snapshot.count; mesh.visible = snapshot.visible;
      mesh.boundingBox = snapshot.box; mesh.boundingSphere = snapshot.sphere;
    },
  });
}
