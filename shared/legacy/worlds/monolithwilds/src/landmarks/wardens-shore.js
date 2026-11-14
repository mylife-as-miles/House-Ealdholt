// Kneeling Wardens — the processional landing at the water's edge (the point all five bow
// toward) and the causeway that runs from it up between the hands of the central warden.
// Small on purpose: human-scale stairs and lanterns against 190 m bodies.
//
// Authored in the site-local frame (sink matrix = site facing): +z toward the lake.

import * as THREE from 'crownfall-world-three';
import { stack } from './wardens-sink.js';
import { stairGeo } from './wardens-body.js';

/**
 * groundS(lx, lz): ground height at a site-local point.
 * opts: { handZ: site-local z of the central warden's fingertips, handTopY, thumbY }
 * Returns anchors (plant spots, viewpoint helpers).
 */
export function buildShore(sink, M, groundS, rng, opts) {
  const out = { plant: [] };
  // locate the shoreline straight ahead of the centre warden
  let zs = 300;
  while (zs < 700 && groundS(0, zs) > 0.3) zs += 2;
  const platBack = zs - 72;
  const platFront = zs - 38;
  const gPlat = Math.max(groundS(0, platBack), groundS(0, platFront - 4), groundS(-22, platFront - 4), groundS(22, platFront - 4));
  const topY = gPlat + 1.6;

  // --- landing platform: two courses of basalt with a projecting coping
  {
    const courses = [];
    let y = Math.floor((Math.min(groundS(0, platFront), groundS(-24, platFront), groundS(24, platFront)) - 3) / 1.5) * 1.5;
    while (y < topY - 0.01) {
      const y1 = Math.min(topY, y + 1.5);
      const coping = y1 >= topY - 0.01;
      courses.push({ y0: y, y1, cx: 0, cz: (platBack + platFront) / 2, hx: 25 + (coping ? 0.6 : 0), hz: (platFront - platBack) / 2 + (coping ? 0.6 : 0), e: 9, yaw: 0, tint: coping ? 0.8 : 0.95 });
      y = y1;
    }
    stack(sink, M.basalt, courses, { N: 36 });
  }
  // --- the great stair down into the lake
  {
    const bottomY = -3.5;
    const rise = topY - bottomY;
    const steps = Math.round(rise / 0.3);
    const run = 0.78;
    const len = steps * run;
    const geo = stairGeo(36, steps, rise / steps, run);
    // rises toward -z (away from the water): rotate PI, origin at the lowest step
    const m = new THREE.Matrix4().makeRotationY(Math.PI).setPosition(0, bottomY, platFront + len);
    sink.geo(M.basalt, geo, m, 0.92);
    geo.dispose();
    // cheek walls following the slope
    const slope = Math.atan2(rise, len);
    for (const sx of [-1, 1]) {
      const cx = sx * 19.2;
      const cz = platFront + len / 2;
      const cy = (topY + bottomY) / 2 + 1.1;
      sink.box(M.stone, cx, cy, cz, 2.4, 2.6, Math.hypot(len, rise) + 1, 0, 0.82, slope, 0, false);
      // newel block + lantern stele at the top of each cheek wall
      stele(sink, M, sx * 21.5, topY, platFront - 2, 16, true);
      // a broken newel at the water
      sink.box(M.stone, cx, bottomY + 4, platFront + len - 2, 3.2, 5.5, 3.2, 0.1 * sx, 0.8, 0.12 * sx, 0.05);
    }
    out.stairFoot = { z: platFront + len, y: bottomY };
  }
  // back corners of the landing: smaller steles
  for (const sx of [-1, 1]) stele(sink, M, sx * 21.5, topY, platBack + 4, 11, false);
  // threshold stone: a black inscribed slab in the middle of the landing
  sink.box(M.spine, 0, topY + 0.55, (platBack + platFront) / 2 + 3, 7, 1.1, 3.4, 0, 1);
  sink.box(M.basalt, 0, topY + 0.2, (platBack + platFront) / 2 + 3, 9, 0.4, 5, 0, 0.8);

  // --- causeway from the landing to the centre warden (up to its fingertips, or — for the
  // prostrate one — on between its hands to the crown of its resting head)
  const zEnd = opts.endZ;
  const seg = 8;
  const width = 11;
  let prevTop = topY;
  for (let z = platBack; z > zEnd; z -= seg) {
    const zc = Math.max(z - seg / 2, zEnd + seg / 2 - 0.01);
    const g = Math.min(groundS(0, zc), groundS(-width / 2, zc), groundS(width / 2, zc));
    const gAvg = (groundS(0, zc) + groundS(-width / 2, zc - 3) + groundS(width / 2, zc + 3)) / 3;
    const top = Math.max(gAvg + 0.9, prevTop - 0.5);
    prevTop = top;
    const broken = rng() < 0.08;
    const h = top - (g - 1.5);
    sink.box(M.basalt, 0, g - 1.5 + h / 2 - (broken ? 0.4 : 0), zc, width, h, seg - 0.12, rng.range(-0.004, 0.004), rng.range(0.85, 1), broken ? rng.range(-0.04, 0.04) : 0, broken ? rng.range(-0.04, 0.04) : 0);
    for (const sx of [-1, 1]) {
      if (rng() < 0.12) continue;
      sink.box(M.stone, sx * (width / 2 + 0.3), top + 0.25, zc, 0.9, 0.9, seg - 0.4, 0, 0.85);
    }
    // marker stones every 24 m (not between the hands)
    if (Math.round(z) % 24 < seg && z > opts.markersUntil) {
      for (const sx of [-1, 1]) {
        const toppled = rng() < 0.25;
        if (toppled) {
          sink.box(M.stone, sx * (width / 2 + 5), groundS(sx * (width / 2 + 5), zc) + 0.7, zc + 2, 1.6, 1.6, 5.5, rng.range(-0.6, 0.6), 0.85, 0, 0.1);
        } else {
          markerStone(sink, M, sx * (width / 2 + 4), groundS(sx * (width / 2 + 4), zc), zc, rng);
        }
      }
    }
  }
  if (opts.stairTo) {
    // stair from the causeway up between the fingers onto the thumbs' terrace
    const zTop = opts.stairTo.z;
    const gFoot = groundS(0, zEnd);
    const rise = opts.stairTo.y - gFoot;
    const steps = Math.max(4, Math.round(rise / 0.3));
    const run = (zEnd - zTop) / steps;
    const geo = stairGeo(7, steps, rise / steps, run);
    const m = new THREE.Matrix4().makeRotationY(Math.PI).setPosition(0, gFoot - 0.3, zEnd);
    sink.geo(M.basalt, geo, m, 0.9);
    geo.dispose();
    stele(sink, M, 0, opts.stairTo.y, zTop - 4, 7, true);
  } else {
    // the causeway ends at a threshold before the resting head, flanked by two lanterns
    const zt = zEnd + (opts.altar ? 5 : -3);
    const g = groundS(0, zt);
    sink.box(M.basalt, 0, g + 0.5, zt, 16, 1.2, 8, 0, 0.8);
    sink.box(M.spine, 0, g + 1.3, zt, 6, 0.5, 3, 0, 1);
    for (const sx of [-1, 1]) stele(sink, M, sx * 10, g + 0.8, zt, 6, true);
  }
  out.landing = { z: (platBack + platFront) / 2, y: topY, shoreZ: zs };
  return out;
}

/** Slender stele: a square shaft with a glyph band and (optionally) a lantern cage on top. */
function stele(sink, M, x, y, z, h, lamp) {
  sink.box(M.basalt, x, y + 0.6, z, 3.6, 1.2, 3.6, 0, 0.85);
  sink.box(M.stone, x, y + 1.2 + h * 0.5, z, 1.9, h, 1.9, 0, 0.92);
  sink.box(M.spine, x, y + 1.2 + h * 0.62, z, 2.05, h * 0.18, 2.05, 0, 1);
  sink.box(M.stone, x, y + 1.2 + h + 0.3, z, 2.6, 0.6, 2.6, 0, 0.85);
  if (lamp) {
    sink.box(M.lamp, x, y + 1.2 + h + 1.3, z, 1.3, 1.4, 1.3, 0, 1);
    for (const [ox, oz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) sink.box(M.basalt, x + ox * 0.95, y + 1.2 + h + 1.3, z + oz * 0.95, 0.3, 1.6, 0.3, 0, 0.7);
    sink.box(M.stone, x, y + 1.2 + h + 2.3, z, 2.4, 0.5, 2.4, 0, 0.85);
    // point cap
    sink.box(M.stone, x, y + 1.2 + h + 3.0, z, 1.2, 1.2, 1.2, Math.PI / 4, 0.8, 0.6, 0.6);
  }
}

function markerStone(sink, M, x, g, z, rng) {
  const h = rng.range(3.5, 5.5);
  sink.box(M.stone, x, g + h / 2 - 0.5, z, 1.4, h, 1.4, rng.range(-0.1, 0.1), rng.range(0.82, 0.95), rng.range(-0.05, 0.05), rng.range(-0.05, 0.05));
  // most still carry a small lantern cup: at night the causeway is a dotted line of light
  if (rng() < 0.7) {
    sink.box(M.basalt, x, g + h - 0.3, z, 1.8, 0.4, 1.8, 0, 0.8);
    sink.box(M.lamp, x, g + h + 0.25, z, 0.8, 0.7, 0.8, 0, 1);
  }
}
