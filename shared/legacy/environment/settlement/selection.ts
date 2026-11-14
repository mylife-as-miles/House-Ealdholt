
export interface SettlementFootprint {
  id: string;
  center: readonly [number, number, number];
  width: number;
  depth: number;
  yaw: number;
}
/** Informational footprint selection, never a buildability or ownership claim.
 * Geometry is in metres, Y-up, anchored just above the authored plot surface.
 * The consuming platform injects its own Three namespace; no DOM or global clock.
 */
export function createSettlementSelection(T: any, plots: readonly SettlementFootprint[], options: { sampleGround?: (x: number, z: number) => number } = {}) {
  const root = new T.Group(); root.name = 'Settlement landmark selection';
  root.userData.iwsdkPreviewBounds = 'exclude';
  const geometry = new Set<any>(), materials = new Set<any>();
  const groups = new Map<string, any>();
  let selected: string | null = null, hovered: string | null = null;
  let reduced = false, elapsed = 0;
  for (const plot of plots) {
    if (![...plot.center, plot.width, plot.depth, plot.yaw].every(Number.isFinite) || plot.width <= 0 || plot.depth <= 0) continue;
    const cosine = Math.cos(plot.yaw), sine = Math.sin(plot.yaw);
    const height = (x: number, z: number) => options.sampleGround ? options.sampleGround(plot.center[0] + cosine * x + sine * z, plot.center[2] - sine * x + cosine * z) - plot.center[1] : 0;
    const group = new T.Group(); group.name = `${plot.id} footprint`; group.visible = false;
    group.position.set(...plot.center); group.position.y += .075; group.rotation.y = plot.yaw;
    group.userData.landmarkId = plot.id; group.userData.kind = 'landmark-selection';
    const fillMaterial = new T.MeshBasicMaterial({ color: '#80e7ff', transparent: true, opacity: .055, depthWrite: false, side: T.DoubleSide, toneMapped: false });
    const edgeMaterial = new T.MeshBasicMaterial({ color: '#bbf7ff', transparent: true, opacity: .92, depthWrite: false, toneMapped: false });
    const gridMaterial = new T.LineBasicMaterial({ color: '#a5edff', transparent: true, opacity: .23, depthWrite: false, toneMapped: false });
    materials.add(fillMaterial); materials.add(edgeMaterial); materials.add(gridMaterial);
    const plane = new T.PlaneGeometry(plot.width, plot.depth, Math.ceil(plot.width), Math.ceil(plot.depth)); plane.rotateX(-Math.PI / 2);
    const vertices = plane.attributes.position; for (let i = 0; i < vertices.count; i++) vertices.setY(i, height(vertices.getX(i), vertices.getZ(i)));
    plane.computeVertexNormals(); geometry.add(plane);
    const fill = new T.Mesh(plane, fillMaterial); fill.name = 'Selected plot surface'; group.add(fill);
    const points: number[] = [], x = plot.width / 2, z = plot.depth / 2;
    for (let px = -x + 1; px < x; px += 1) points.push(px, height(px, -z) + .012, -z, px, height(px, z) + .012, z);
    for (let pz = -z + 1; pz < z; pz += 1) points.push(-x, height(-x, pz) + .012, pz, x, height(x, pz) + .012, pz);
    const grid = new T.BufferGeometry(); grid.setAttribute('position', new T.Float32BufferAttribute(points, 3)); geometry.add(grid);
    const lines = new T.LineSegments(grid, gridMaterial); lines.name = 'Informational plot grid'; group.add(lines);
    const thickness = .09;
    for (const [width, depth, px, pz] of [[plot.width + thickness, thickness, 0, -z], [plot.width + thickness, thickness, 0, z], [thickness, plot.depth, -x, 0], [thickness, plot.depth, x, 0]]) {
      const shape = new T.BoxGeometry(width, .035, depth, Math.max(1, Math.ceil(width)), 1, Math.max(1, Math.ceil(depth)));
      const positions = shape.attributes.position; for (let i = 0; i < positions.count; i++) positions.setY(i, positions.getY(i) + height(positions.getX(i) + px, positions.getZ(i) + pz));
      shape.computeVertexNormals(); geometry.add(shape);
      const beam = new T.Mesh(shape, edgeMaterial); beam.position.set(px, .025, pz); beam.name = 'Luminous footprint edge'; group.add(beam);
    }
    group.traverse((object: any) => { if (object.isMesh || object.isLine) { object.raycast = () => {}; object.renderOrder = 3; } });
    group.userData.surface = fillMaterial; group.userData.edge = edgeMaterial; group.userData.grid = gridMaterial;
    groups.set(plot.id, group); root.add(group);
  }
  function refresh() {
    for (const [id, group] of groups) {
      const active = id === selected;
      group.visible = active || id === hovered;
      group.userData.surface.opacity = active ? .065 : .025;
      group.userData.grid.opacity = active ? .22 : .1;
      group.userData.edge.opacity = active ? (reduced ? .94 : .88 + .06 * Math.sin(elapsed * 2.4)) : .44;
    }
  }
  return {
    root,
    setSelected(id: string | null) { selected = groups.has(id as string) ? id : null; refresh(); },
    setHovered(id: string | null) { hovered = groups.has(id as string) ? id : null; refresh(); },
    setReducedMotion(value: boolean) { reduced = value; refresh(); },
    update(delta: number) { if (!reduced && selected) { elapsed += Math.max(0, Math.min(.1, delta)); refresh(); } },
    dispose() { root.removeFromParent(); root.clear(); groups.clear(); for (const item of geometry) item.dispose(); for (const item of materials) item.dispose(); geometry.clear(); materials.clear(); },
  };
}
