/**
 * Where a villager's voice comes from when their figure is not in the village (no population site configured): the
 * place their routine has them at, found in the village model itself. Doors give the buildings, the camp fires the
 * forge, the troughs and benches the yards; the church, well and pond are where the village's own views look
 * (shared/legacy/aethelgard/village-views.ts). Places beyond the houses (fields, pasture, mill) lie outward from the
 * middle. Each villager stands a little apart from the others at the same place, so their bubbles do not stack.
 *
 * Nothing here is measured truth about who lives where: homes are shared out among the buildings in a fixed order.
 * Once villagers have real positions (the population site), those are used instead and this is only a fallback.
 * Points are in the model's own frame, at head height.
 */
import { Raycaster, Vector3, type Mesh, type Object3D } from "three";
import { EALDHOLT_VILLAGE_VIEWS } from "../../../../../shared/legacy/aethelgard/village-views";

const HEAD_METRES = 2.3;
function hash01(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function createVillageAnchors(model: Object3D) {
  let ready = false;
  const places = new Map<string, { readonly point: Vector3; readonly spread: number }>();
  const homes: Vector3[] = [], lanes: Vector3[] = [], middle = new Vector3(), terrain: Object3D[] = [];
  const cache = new Map<string, Vector3>(), ray = new Raycaster(), down = new Vector3(0, -1, 0), scratch = new Vector3();

  function locals(pattern: RegExp, apart: number): Vector3[] {
    const found: Vector3[] = [];
    model.traverse(node => {
      if (!pattern.test(node.name)) return;
      const point = model.worldToLocal(node.getWorldPosition(new Vector3()));
      if (!found.some(other => Math.hypot(other.x - point.x, other.z - point.z) < apart)) found.push(point);
    });
    return found;
  }
  const nearest = (points: readonly Vector3[], to: Vector3, skip: ReadonlySet<Vector3> = new Set()) =>
    points.filter(point => !skip.has(point)).sort((a, b) => Math.hypot(a.x - to.x, a.z - to.z) - Math.hypot(b.x - to.x, b.z - to.z))[0] as Vector3 | undefined;
  const viewTarget = (id: string) => { const view = EALDHOLT_VILLAGE_VIEWS.find(pose => pose.id === id); return view ? model.worldToLocal(new Vector3().fromArray(view.target)) : null; };

  function prepare(): void {
    ready = true;
    model.updateWorldMatrix(true, true);
    model.traverse(node => { if ((node as Mesh).isMesh && /Landscape/i.test(node.name + (node.parent?.name ?? ""))) terrain.push(node); });
    const buildings = locals(/Medieval_Modular_Door/i, 2.5), fires = locals(/Campfire/i, 2), troughs = locals(/Trough/i, 2), benches = locals(/Bench/i, 2);
    if (!buildings.length) return;
    middle.copy(buildings.reduce((sum, point) => sum.add(point), new Vector3()).divideScalar(buildings.length));
    const set = (id: string, point: Vector3 | null | undefined, spread = 1.6) => { if (point) places.set(id, { point: point.clone(), spread }); };
    const toward = (from: Vector3, to: Vector3, metres: number) => from.clone().add(scratch.copy(to).sub(from).setY(0).normalize().multiplyScalar(metres));
    const out = (x: number, z: number, metres: number) => middle.clone().add(new Vector3(x, 0, z).normalize().multiplyScalar(metres));

    const taken = new Set<Vector3>();
    const churchLook = viewTarget("churchyard"), well = viewTarget("well") ?? nearest(troughs, middle) ?? middle, pond = viewTarget("lakeside");
    const church = nearest(buildings, churchLook ?? middle); if (church) taken.add(church);
    const forge = nearest(fires, well) ?? well, smithy = nearest(buildings, forge, taken); if (smithy) taken.add(smithy);
    const hall = nearest(buildings, middle, taken); if (hall) taken.add(hall);
    set("proposed-church", church, 2.4); set("churchyard", church ? toward(church, middle, 6) : null, 3);
    set("proposed-green", church ? toward(church, middle, 13) : null, 4);
    set("village-well", well, 2.2); set("village-pond", pond ?? out(-1, -1, 40), 3);
    set("village-courtyard", nearest(benches, middle) ?? middle, 4.5);
    set("smithy-forge", forge, 1.4); set("smithy-house", smithy);
    set("proposed-house-hall", hall, 2.4); set("proposed-guard-yard", hall ? toward(hall, middle, 8) : null, 3.5);
    // Beyond the houses, by the lie of the land: the river and the approach to the south, fields and woods to the north.
    const river = viewTarget("riverside"), south = river ? scratch.copy(river).sub(middle).setY(0).normalize().clone() : new Vector3(0, 0, 1);
    const southward = (metres: number, across: number) => middle.clone().addScaledVector(south, metres).add(new Vector3(-south.z, 0, south.x).multiplyScalar(across));
    set("proposed-watch-post", southward(46, 0), 2.5); set("riverside-bank", southward(64, -14), 6); set("proposed-mill", southward(62, 16), 3);
    set("proposed-tannery", southward(70, 30), 3); set("proposed-fields", out(1, -1, 60), 12); set("proposed-pasture", out(-1, .2, 62), 12);
    set("proposed-hedgerows", out(.2, -1, 58), 9); set("woodland-edge", out(-1, -1, 66), 8);
    for (const building of buildings) { if (!taken.has(building)) homes.push(building); lanes.push(building.clone().lerp(middle, .5)); }
    if (!homes.length) homes.push(...buildings);
  }

  /** The ground under a point, where the terrain can be found. */
  function grounded(point: Vector3): Vector3 {
    if (terrain.length) {
      ray.set(scratch.copy(point).setY(point.y + 150).applyMatrix4(model.matrixWorld), down); ray.far = 500;
      const hit = ray.intersectObjects(terrain, false)[0];
      if (hit) point.y = model.worldToLocal(hit.point).y;
    }
    return point;
  }

  return {
    /** Where this villager's voice comes from at this place (model frame, head height); null for an unknown place. */
    anchor(placeId: string, residentId: string): Vector3 | null {
      if (!ready) prepare();
      const key = `${placeId}|${residentId}`, cached = cache.get(key);
      if (cached) return cached;
      let base: Vector3 | undefined, spread = 1.4, indoors = false;
      const place = places.get(placeId);
      if (place) { base = place.point; spread = place.spread; }
      else if (placeId === "proposed-lanes") { base = lanes[Math.floor(hash01(`lane|${residentId}`) * lanes.length)]; spread = 3; }
      else if (placeId === "proposed-road-beyond") return null;
      else if (homes.length) {
        // Homes and the workshops kept in them (bakehouse, herb garden): shared out among the buildings in a fixed order.
        base = homes[Math.floor(hash01(`home|${placeId}`) * homes.length)]; indoors = true; spread = 1.2;
      }
      if (!base) return null;
      const angle = hash01(`angle|${key}`) * Math.PI * 2, radius = Math.sqrt(hash01(`radius|${key}`)) * spread;
      const point = new Vector3(base.x + Math.cos(angle) * radius, base.y, base.z + Math.sin(angle) * radius);
      // A doorway keeps its own height; open ground is found under the point.
      if (!indoors && spread > 2.5) grounded(point);
      point.y += HEAD_METRES + (indoors ? .5 : 0);
      cache.set(key, point);
      return point;
    },
  };
}
export type VillageAnchors = ReturnType<typeof createVillageAnchors>;
