/** Original Crownfall settlement architecture. Pure renderer-neutral geometry;
 * no reference-game models, textures, identities or gameplay rules are used. */
import { MeshBuilder } from '../kernel/builder';
import type { MeshBuffer } from '../kernel/mesh';
import { box, opening } from '../kernel/primitives';
import { roof } from '../kernel/roofs';
import { settlementHeight } from './layout';
import type { SettlementBuilding } from './layout';

const TIMBER = 'settlement-timber';
const PLASTER = 'settlement-plaster';
const STONE = 'settlement-stone';
const WINDOW = 'settlement-window';

/** A square-section timber between two local points. */
function beam(b: MeshBuilder, a: readonly [number, number, number], c: readonly [number, number, number], thickness: number): void {
  const dx = c[0] - a[0], dy = c[1] - a[1], dz = c[2] - a[2];
  const horizontal = Math.hypot(dx, dz), length = Math.hypot(horizontal, dy);
  if (length < .001) return;
  b.push();
  b.transform((a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2, Math.atan2(dx, dz), -Math.atan2(dy, horizontal));
  box(b, 0, -thickness / 2, 0, thickness, thickness, length);
  b.pop();
}

function window(b: MeshBuilder, x: number, y: number, z: number, yaw: number, width: number, height: number): void {
  b.push();
  b.transform(x, y, z, yaw);
  b.color(1, 1, 1);
  opening(b, {
    outline: [[-width / 2, 0], [width / 2, 0], [width / 2, height], [-width / 2, height]],
    glassMaterial: WINDOW, frameMaterial: TIMBER,
    frame: .11, proud: .16, sill: true, mullion: true,
  });
  b.material(TIMBER);
  box(b, 0, height * .53, .15, width, .075, .075);
  // Narrow projecting shutters add depth without suggesting another opening.
  for (const side of [-1, 1]) box(b, side * (width / 2 + .16), -.01, .035, .15, height + .02, .09);
  b.pop();
}

function door(b: MeshBuilder, width: number, height: number, z: number): void {
  b.push();
  b.translate(0, .36, z);
  opening(b, {
    outline: [[-width / 2, 0], [width / 2, 0], [width / 2, height - .25], [0, height], [-width / 2, height - .25]],
    glassMaterial: TIMBER, frameMaterial: TIMBER,
    glassTint: [.55, .55, .55], frame: .16, proud: .19,
  });
  b.material(TIMBER).color(.75, .75, .75);
  for (const x of [-width * .26, 0, width * .26]) box(b, x, .12, .035, .035, height - .45, .035);
  b.color(1, 1, 1);
  box(b, width * .24, height * .43, .11, .09, .09, .1);
  b.pop();
  b.material(STONE);
  box(b, 0, .04, z + .38, width + .65, .21, .85);
}

/** Broad staggered courses keep the coloured roof readable at aerial distance. */
function roofCourses(b: MeshBuilder, width: number, depth: number, eaves: number, rise: number, overhang: number, verge: number): void {
  const half = width / 2 + overhang, ridge = eaves + rise;
  const low = eaves - overhang * rise / (width / 2), front = depth / 2 + verge;
  const rows = Math.max(6, Math.min(11, Math.round(rise / .6)));
  for (let row = 0; row < rows; row++) {
    const t0 = row / rows, t1 = (row + 1) / rows;
    const x0 = half * t0, x1 = half * t1;
    const y0 = ridge + (low - ridge) * t0 + .026;
    const y1 = ridge + (low - ridge) * t1 + .026;
    const tint = row % 3 === 0 ? .92 : row % 3 === 1 ? 1.04 : .99;
    b.color(tint, tint, tint);
    b.flatQuad(x1, y1, front, x1, y1, -front, x0, y0, -front, x0, y0, front);
    b.color(tint * .94, tint * .97, tint);
    b.flatQuad(-x1, y1, -front, -x1, y1, front, -x0, y0, front, -x0, y0, -front);
  }
  b.color(1, 1, 1);
}

interface MassShape {
  width: number; depth: number; eaves: number; roofHeight: number;
  roof: SettlementBuilding['roof']; hall?: boolean; barn?: boolean;
  stoneGroundFloor?: boolean;
  overhang?: number; verge?: number;
}

function emitMass(b: MeshBuilder, shape: MassShape): void {
  const { width: w, depth: d, eaves: e, roofHeight: rise } = shape;
  const hall = shape.hall === true, barn = shape.barn === true;
  const halfW = w / 2, halfD = d / 2;
  const overhang = shape.overhang ?? .5, verge = shape.verge ?? .35;
  const roofMaterial = `settlement-roof-${shape.roof}`;
  // The masonry plinth extends below grade, so gently sloping plots do not float.
  b.material(STONE).color(.91, .91, .88);
  box(b, 0, -.7, 0, w + .22, 1.06, d + .22);
  b.color(1, 1, 1);
  box(b, 0, .22, 0, w + .38, .2, d + .38);
  if (shape.stoneGroundFloor) {
    // The same structural envelope gains a fortified lower storey; upper
    // timber/plaster, openings and roof stay in their existing positions.
    const division = Math.min(e - .65, Math.max(2.5, e * .49));
    b.material(STONE).color(.79, .81, .80);
    box(b, 0, .35, 0, w, division - .35, d);
    b.color(.96, .96, .93);
    box(b, 0, division - .06, 0, w + .04, .12, d + .04);
    b.material(PLASTER).color(.92, .92, .89);
    box(b, 0, division, 0, w, e - division, d);
    b.color(1, 1, 1);
  } else {
    b.material(PLASTER);
    box(b, 0, .35, 0, w, e - .35, d);
  }

  // Timber sill, corners, wall plate and intermediate rails form a clear frame.
  b.material(TIMBER);
  for (const x of [-halfW + .08, halfW - .08]) {
    for (const z of [-halfD + .08, halfD - .08]) box(b, x, .35, z, .24, e - .35, .24);
  }
  const railHeights = hall ? [.45, e * .49, e - .21] : [.45, e - .21];
  for (const y of railHeights) {
    for (const z of [-halfD, halfD]) box(b, 0, y, z, w + .13, .19, .19);
    for (const x of [-halfW, halfW]) box(b, x, y, 0, .19, .19, d + .13);
  }
  for (const side of [-1, 1]) {
    // Front/back bays and high knee braces leave the glazed panels clear.
    const z = side * (halfD + .055);
    for (const x of [-w * .18, w * .18]) box(b, x, .4, z, .17, e - .4, .17);
    for (const sign of [-1, 1]) {
      beam(b, [sign * (halfW - .16), e - 1.05, z], [sign * (halfW - 1.03), e - .23, z], .16);
    }
    const bays = Math.max(2, Math.round(d / 2.9));
    for (let i = 1; i < bays; i++) box(b, side * halfW, .4, -halfD + d * i / bays, .19, e - .4, .19);
  }

  roof(b, {
    form: barn ? 'half-hip' : 'steep-gable', axis: 'z', plan: 'rect', w, d,
    eaveY: e, ridgeY: e + rise, overhang, verge, thickness: .16,
    roofMaterial, gableMaterial: PLASTER, trimMaterial: TIMBER,
    soffitMaterial: TIMBER, slopeTints: [[1, 1, 1], [.91, .95, 1]],
  });
  b.material(roofMaterial);
  if (!barn) roofCourses(b, w, d, e, rise, overhang, verge);
  b.material(TIMBER);
  const lowEave = e - overhang * rise / halfW;
  for (const side of [-1, 1]) {
    const z = side * (halfD + verge + .035);
    if (!barn) {
      beam(b, [-halfW - overhang, lowEave, z], [0, e + rise, z], .16);
      beam(b, [0, e + rise, z], [halfW + overhang, lowEave, z], .16);
    }
    const wallZ = side * (halfD + .025);
    const frameTop = e + rise * (barn ? .54 : 1) - .35;
    beam(b, [0, e, wallZ], [0, frameTop, wallZ], .16);
    for (const sign of [-1, 1]) beam(b, [sign * halfW * .85, e + .05, wallZ], [sign * (barn ? halfW * .35 : 0), frameTop, wallZ], .14);
    if (barn) beam(b, [-halfW * .38, frameTop, wallZ], [halfW * .38, frameTop, wallZ], .16);
  }

  const doorWidth = barn ? Math.min(2.5, w * .32) : hall ? 2.15 : 1.25;
  door(b, doorWidth, barn ? 2.7 : hall ? 2.85 : 2.25, halfD + .025);
  const windowWidth = hall ? 1.1 : .85, windowHeight = hall ? 1.4 : 1.1;
  const sill = hall ? 1.35 : 1.15;
  for (const x of [-w * .32, w * .32]) {
    window(b, x, sill, halfD + .025, 0, windowWidth, windowHeight);
    window(b, x, sill, -halfD - .025, Math.PI, windowWidth, windowHeight);
    if (hall) {
      window(b, x, e * .55, halfD + .025, 0, windowWidth, windowHeight);
      window(b, x, e * .55, -halfD - .025, Math.PI, windowWidth, windowHeight);
    }
  }
  for (const side of [-1, 1]) {
    for (const z of [-d * .24, d * .24]) {
      window(b, side * (halfW + .025), sill, z, side * Math.PI / 2, windowWidth, windowHeight);
      if (hall) window(b, side * (halfW + .025), e * .55, z, side * Math.PI / 2, windowWidth, windowHeight);
    }
    window(b, 0, e + rise * .16, side * (halfD + .035), side > 0 ? 0 : Math.PI, hall ? 1.25 : .8, Math.min(1.3, rise * .3));
  }

  // An offset masonry flue breaks the roof silhouette; a dark inset reads as its opening.
  const chimneyX = -w * .25, chimneyZ = -d * .2;
  const roofAtChimney = e + rise * .5, chimneyTop = roofAtChimney + (hall ? 1.5 : 1.15);
  b.material(STONE).color(.86, .84, .79);
  box(b, chimneyX, roofAtChimney - .55, chimneyZ, .65, chimneyTop - roofAtChimney + .55, .72);
  b.color(1, 1, 1);
  box(b, chimneyX, chimneyTop - .12, chimneyZ, .87, .2, .94);
  b.material(TIMBER).color(.3, .3, .3);
  box(b, chimneyX, chimneyTop + .085, chimneyZ, .48, .015, .55);
  b.color(1, 1, 1);
}

/** A recessed covered entrance stays inside the original protected lot. */
function porch(b: MeshBuilder, width: number, back: number, front: number, roofMaterial: string): void {
  const depth = front - back, centre = (front + back) / 2;
  b.material(STONE).color(.92, .9, .84);
  box(b, 0, .1, centre, width, .24, depth);
  b.material(TIMBER).color(1, 1, 1);
  const low = 2.45, high = 3.15;
  for (const x of [-width / 2 + .13, width / 2 - .13]) {
    box(b, x, .34, front - .15, .19, low - .34, .19);
    beam(b, [x, low - .6, front - .15], [x, low - .03, front - .72], .12);
    box(b, x, .7, centre, .13, .12, depth - .25);
  }
  box(b, 0, low - .13, front - .15, width, .18, .18);
  b.push().translate(0, 0, centre);
  roof(b, { form: 'lean-to', axis: 'x', plan: 'rect', w: width, d: depth,
    eaveY: low, ridgeY: high, overhang: .06, verge: .06, thickness: .12,
    roofMaterial, gableMaterial: TIMBER, trimMaterial: TIMBER, soffitMaterial: TIMBER });
  b.pop();
}

/**
 * Original bounded silhouettes: a compound hall, working barn and porch cottage.
 * Inputs and renderer-neutral output remain identical for saved user placements.
 * All structural masses fit the same protected width/depth; details retain only
 * the previous cottage kit's small eave/step allowance.
 */
export function buildSettlementBuilding(building: SettlementBuilding): MeshBuffer[] {
  const { width: w, depth: d, eaves: e, roofHeight: rise } = building;
  const b = new MeshBuilder();
  b.part(building.landmark ? `landmark:${building.landmark}` : 'settlement', building.landmark).variant(building.id);
  b.uvMode = 'world';
  b.transform(building.x, settlementHeight(building.x, building.z), building.z, building.yaw);
  const hall = building.landmark === 'banner-hall' || w >= 13;
  const barn = building.landmark === 'muster-grounds' || ['cottage-02', 'cottage-10'].includes(building.id) || (w >= 9 && rise <= 4.5);
  const porchCottage = ['herald-lodge', 'cottage-06', 'cottage-07'].includes(building.id);
  const mass = (x: number, z: number, shape: MassShape) => {
    b.push().translate(x, 0, z);
    emitMass(b, shape);
    b.pop();
  };
  if (hall) {
    mass(-w * .16, 0, { width: w * .62, depth: d * .84, eaves: e, roofHeight: rise, roof: building.roof, hall: true, stoneGroundFloor: true, overhang: .34, verge: .3 });
    mass(w * .29, -d * .15, { width: w * .34, depth: d * .56, eaves: e * .64, roofHeight: rise * .52, roof: building.roof, stoneGroundFloor: true, overhang: .28, verge: .22 });
    // A low stone threshold and paired landing edges clarify the main entrance
    // inside the existing lot, leaving the separate open court shelter clear.
    const entrance = -w * .16;
    b.material(STONE).color(.9, .92, .91);
    box(b, entrance, -.06, d * .47, 3.6, .14, .7);
    box(b, entrance, .075, d * .45, 3.15, .15, .72);
    for (const side of [-1, 1]) {
      const x = entrance + side * 2.25;
      box(b, x, -.08, d * .46, .44, .65, .6);
      box(b, x, .57, d * .46, .55, .14, .68);
    }
    b.color(1, 1, 1);
    // Entry-court bench occupies the recess, never a walkable road or new lot.
    b.material(TIMBER).color(1, 1, 1);
    box(b, w * .31, .64, d * .32, w * .25, .16, .57);
    for (const x of [w * .22, w * .4]) box(b, x, .2, d * .32, .18, .5, .44);
  } else if (barn) {
    mass(0, -d * .08, { width: w * .9, depth: d * .76, eaves: e, roofHeight: rise, roof: building.roof, barn: true, overhang: .25, verge: .16 });
    porch(b, w * .77, d * .3, d * .47, `settlement-roof-${building.roof}`);
  } else if (porchCottage) {
    mass(0, -d * .115, { width: w * .86, depth: d * .67, eaves: e, roofHeight: rise, roof: building.roof, overhang: .28, verge: .2 });
    porch(b, w * .82, d * .22, d * .47, `settlement-roof-${building.roof}`);
  } else {
    mass(0, 0, { width: w, depth: d, eaves: e, roofHeight: rise, roof: building.roof });
  }
  return b.finish();
}
