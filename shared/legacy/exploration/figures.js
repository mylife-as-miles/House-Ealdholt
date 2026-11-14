// Platform-owned Three namespace: desktop and IWSDK must never mix runtimes.
// Crownfall's procedural fantasy kit supplies continuous blended gait buffers.
import { buildFigure } from '../environment/kits/figures/figure';

export function createExplorationFigure(T, { miniature = false, atlas = null } = {}) {
  const root = new T.Group(); root.name = 'Selected house envoy'; root.visible = false;
  const geometries = [], materials = [];
  const material = miniature ? new T.MeshBasicMaterial({ vertexColors: true }) : new T.MeshStandardMaterial({ vertexColors: true, roughness: .88, metalness: .08 });
  const cloth = miniature ? new T.MeshBasicMaterial({ color: '#dcc58d', map: atlas, side: T.DoubleSide }) : new T.MeshStandardMaterial({ color: '#dcc58d', map: atlas, roughness: .9, side: T.DoubleSide });
  materials.push(material, cloth);
  const source = ['stand', 'walk-a', 'walk-b'].map(pose => buildFigure('levy', pose, miniature ? 1 : 0));
  const buffers = [];
  source[0].forEach((mesh, index) => {
    const geometry = new T.BufferGeometry();
    const position = new T.BufferAttribute(mesh.positions.slice(), 3).setUsage(T.DynamicDrawUsage);
    const normal = new T.BufferAttribute(mesh.normals.slice(), 3).setUsage(T.DynamicDrawUsage);
    geometry.setAttribute('position', position); geometry.setAttribute('normal', normal);
    geometry.setAttribute('uv', new T.BufferAttribute(mesh.uvs, 2));
    if (mesh.colors) geometry.setAttribute('color', new T.BufferAttribute(mesh.colors, 3));
    geometry.setIndex(new T.BufferAttribute(mesh.indices, 1)); geometry.computeBoundingSphere(); geometries.push(geometry);
    const object = new T.Mesh(geometry, mesh.material === 'cloth-heraldry' ? cloth : material);
    object.castShadow = !miniature; object.receiveShadow = !miniature; root.add(object);
    const frames = source.map(poses => poses[index]);
    // All three owned poses use the same procedural topology. Retain stand if a
    // future kit adds a carried prop rather than corrupting unrelated vertices.
    if (frames.every(frame => frame && frame.positions.length === mesh.positions.length && frame.normals.length === mesh.normals.length)) buffers.push({ position, normal, frames });
  });
  const ringGeometry = new T.RingGeometry(.65, .8, 48), ringMaterial = new T.MeshBasicMaterial({ color: '#e5a545', side: T.DoubleSide, transparent: true, opacity: .9, depthWrite: false });
  const ring = new T.Mesh(ringGeometry, ringMaterial); ring.rotation.x = -Math.PI / 2; ring.position.y = .035; root.add(ring);
  geometries.push(ringGeometry); materials.push(ringMaterial);
  let previous = null, previousMember = null, yaw = 0, desiredYaw = 0, time = 0, blend = 0;
  return {
    root,
    update(snapshot, delta, reducedMotion = false) {
      root.visible = snapshot.enabled && snapshot.available && !!snapshot.location;
      if (!root.visible) return;
      if (snapshot.selectedMemberId !== previousMember) { previous = null; previousMember = snapshot.selectedMemberId; }
      const p = snapshot.location, dt = Math.max(0, Math.min(.1, delta));
      if (previous) { const dx = p.x - previous.x, dz = p.z - previous.z; if (Math.hypot(dx, dz) > .001) desiredYaw = Math.atan2(dx, dz); }
      let turn = (desiredYaw - yaw + Math.PI) % (Math.PI * 2); if (turn < 0) turn += Math.PI * 2; turn -= Math.PI;
      yaw += turn * (reducedMotion ? 1 : 1 - Math.exp(-dt * 12));
      root.position.set(p.x, p.y + .04, p.z); root.rotation.y = yaw;
      time += dt; const walking = snapshot.status === 'moving' && !reducedMotion;
      const priorBlend = blend;
      blend = walking ? Math.min(1, blend + dt * 7) : Math.max(0, blend - dt * 10);
      const phase = .5 + .5 * Math.sin(time * 8);
      if (blend || priorBlend) for (const { position, normal, frames } of buffers) {
        const [stand, a, b] = frames;
        for (let i = 0; i < position.array.length; i++) {
          position.array[i] = stand.positions[i] * (1 - blend) + (a.positions[i] * (1 - phase) + b.positions[i] * phase) * blend;
          normal.array[i] = stand.normals[i] * (1 - blend) + (a.normals[i] * (1 - phase) + b.normals[i] * phase) * blend;
        }
        position.needsUpdate = normal.needsUpdate = true;
      }
      previous = { x: p.x, y: p.y, z: p.z };
    },
    dispose() { root.removeFromParent(); for (const g of geometries) g.dispose(); for (const m of materials) m.dispose(); },
  };
}
