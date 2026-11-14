// THE LOOM OF HOURS — a 620 m stone ring standing upright across the northern valley, hovering
// 30 m above the floor, held by nothing but eight taut tethers (it seems to want to rise).
// Thousands of threads hang from its upper arc: warp-weighted with stone spools and great loom
// weights, snapped in places, gathered into an unfinished stone tapestry in the upper-left
// sectors. Its 24 hour-blocks make it a clock; the block of the current hour glows. Midnight
// has fallen out of the bottom; a plumb line of threads drops through the gap to the ground.
//
// Files: loom-ring.js (the ring), loom-warp.js (threads, weights, tethers, coils),
//        loom-weave.js (tapestry, shuttle, cloth beam), loom-threads.js (thread shader/mesh).

import * as THREE from 'crownfall-world-three';
import { makeInstanced } from '../core/builder.js';
import { RING, Tris, arcBlock, buildRingLocal, createHourGlowMaterial, geoTris, boxTris, addCrownTrees } from './loom-ring.js';
import { ThreadSet, createThreadMaterial, makeSwayingMaterial, setInstanceSway, LOOM_SWAY_GLSL } from './loom-threads.js';
import { buildWarp, spoolGeometry, spoolBandGeometry, weightGeometry } from './loom-warp.js';
import { buildTapestry, buildClothBeam } from './loom-weave.js';
import { yieldToMain as nextFrame } from '../core/yield.js';


/** Unlit amber glow for spool bands, swaying with the spool (instanced). */
function createSwayGlowMaterial(ctx) {
  const uniforms = { uLoomTime: { value: ctx.atmo.time } };
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffb35c') });
  mat.name = 'loom-spool-glow';
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${LOOM_SWAY_GLSL}\nattribute vec3 aSway;\nvarying float vPh;`)
      .replace(
        '#include <project_vertex>',
        `vec4 mvPosition = vec4( transformed, 1.0 );
        #ifdef USE_INSTANCING
          mvPosition = instanceMatrix * mvPosition;
        #endif
        mvPosition.xyz += loomSway(aSway.x, aSway.y, aSway.z);
        vPh = aSway.y;
        mvPosition = modelViewMatrix * mvPosition;
        gl_Position = projectionMatrix * mvPosition;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec4 uLoomTime;\nvarying float vPh;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        diffuseColor.rgb *= mix(0.12, 3.2, uLoomTime.y) * (0.65 + 0.35 * sin(uLoomTime.x * 0.3 + vPh * 5.0));`,
      );
  };
  mat.customProgramCacheKey = () => 'loom-spool-glow-v1';
  return mat;
}

export async function build(ctx, site) {
  const rng = ctx.noise.createRng('loom');
  const scene = ctx.scene;
  const t0 = performance.now();
  const marks = [];
  const mark = (n) => marks.push(`${n}:${Math.round(performance.now() - t0)}`);

  // -------------------------------------------------------------------------
  // placement: centred on the valley axis, turned slightly to face the lake
  // -------------------------------------------------------------------------
  // turned ~26° west of south: faces the lake/basin and catches the low western sun on its face
  const yaw = (site.facing || 0) - 0.45;
  const cx = 350;
  const cz = site.z;
  const LOW = 283; // lowest point below centre (crown beside the fallen midnight block)
  let floor = -Infinity;
  for (let s = -90; s <= 90; s += 15) {
    const x = cx + Math.cos(yaw) * s;
    const z = cz - Math.sin(yaw) * s;
    for (let d = -25; d <= 25; d += 25) floor = Math.max(floor, ctx.heightAt(x + Math.sin(yaw) * d, z + Math.cos(yaw) * d));
  }
  const cy = floor + 30 + LOW;
  const M = new THREE.Matrix4().makeRotationY(yaw).setPosition(cx, cy, cz);
  const cyw = Math.cos(yaw);
  const syw = Math.sin(yaw);
  const frame = {
    cx, cy, cz, yaw, M,
    toWorld: (x, y, z) => [cx + x * cyw + z * syw, cy + y, cz - x * syw + z * cyw],
  };
  const W = frame.toWorld;

  const root = new THREE.Group();
  root.name = 'landmark:loom';

  // -------------------------------------------------------------------------
  // the ring + tapestry (ring-local sinks)
  // -------------------------------------------------------------------------
  const ring = buildRingLocal(rng);
  const L = ring.sinks;
  addCrownTrees(L.basalt, ctx.noise.createRng('loom-trees'));
  mark('ring');
  const tap = buildTapestry(rng, L);
  mark('tapestry');

  // world-space sinks: debris, anchors, beam
  const S = { stone: new Tris(), basalt: new Tris(), glyph: new Tris(), bronze: new Tris() };

  await nextFrame();

  // -------------------------------------------------------------------------
  // threads
  // -------------------------------------------------------------------------
  const threads = new ThreadSet();
  const warp = buildWarp(ctx, frame, ring, rng, threads, S);
  mark('warp');

  // tapestry: the weft cable from the ragged edge to the shuttle
  {
    const sh = tap.shuttle;
    const c = tap.cols[1];
    const a = W(c.x, c.edge + 1, 0.9);
    const b = W(sh.x - 7, sh.y + 0.5, 0);
    threads.add(
      [0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => {
        const t = i / 8;
        return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - 9 * 4 * t * (1 - t), a[2] + (b[2] - a[2]) * t];
      }),
      { radius: 0.55, sway: () => 0, color: [0.5, 0.45, 0.37], twist: 2.2 },
    );
    // two slings holding the shuttle from the comb above
    for (const dx of [-14, 12]) {
      const top = Math.sqrt(234.8 * 234.8 - (sh.x + dx) ** 2);
      const p0 = W(sh.x + dx, top, 8.5 * Math.sign(dx));
      const p1 = W(sh.x + dx * 0.8, sh.y + 2.6, 0);
      threads.add([p0, [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2], p1], { radius: 0.4, sway: () => 0, color: [0.2, 0.17, 0.15] });
    }
  }

  // -------------------------------------------------------------------------
  // debris on the valley floor
  // -------------------------------------------------------------------------
  const dropAt = (theta, r = 262) => W(r * Math.cos(theta), r * Math.sin(theta), 0);
  const scatterFragments = (wx, wz, count, spread, big, tintBase = 1) => {
    for (let i = 0; i < count; i++) {
      const ang = rng.range(0, Math.PI * 2);
      const d = spread * Math.sqrt(rng());
      const x = wx + Math.cos(ang) * d;
      const z = wz + Math.sin(ang) * d;
      const gy = ctx.heightAt(x, z);
      const size = big ? rng.range(0.5, 1) : rng.range(0.12, 0.35);
      // a chunk of the ring section: a short chamfered wedge, dropped at an angle
      const r0 = RING.R_CORE0 + rng.range(0, 10);
      const r1 = r0 + 28 * size * rng.range(0.5, 1);
      const a0 = rng.range(-19, 0) * size;
      const a1 = a0 + 39 * size * rng.range(0.5, 1);
      const dt = (9 * size * rng.range(0.6, 1.2)) / 262;
      const tmp = new Tris();
      arcBlock(tmp, r0, r1, a0, a1, -dt / 2, dt / 2, 0.4 * size + 0.1, [tintBase, tintBase, tintBase]);
      const g = tmp.geometry();
      g.translate(-(r0 + r1) / 2, 0, -(a0 + a1) / 2);
      const sunk = (r1 - r0) * rng.range(0.12, 0.3);
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(x, gy + (r1 - r0) * 0.3 - sunk, z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(rng.range(-1.2, 1.2), rng.range(0, 6.28), rng.range(-1.5, 1.5))),
        new THREE.Vector3(1, 1, 1),
      );
      geoTris(S.stone, g, m, [tintBase * rng.range(0.85, 1.05), tintBase * rng.range(0.85, 1.0), tintBase * rng.range(0.8, 0.95)]);
      g.dispose();
    }
    // rubble
    const rub = new THREE.DodecahedronGeometry(1, 0);
    for (let i = 0; i < count * 5; i++) {
      const ang = rng.range(0, Math.PI * 2);
      const d = spread * 1.3 * Math.sqrt(rng());
      const x = wx + Math.cos(ang) * d;
      const z = wz + Math.sin(ang) * d;
      const s = rng.range(0.6, 3.2);
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(x, ctx.heightAt(x, z) + s * 0.25, z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(rng() * 6, rng() * 6, rng() * 6)),
        new THREE.Vector3(s * rng.range(0.8, 1.6), s * rng.range(0.5, 0.9), s),
      );
      geoTris(S.stone, rub, m, [0.9, 0.86, 0.8]);
    }
    rub.dispose();
  };
  // under the gaps
  for (const k of [59.5, 115.5, 172.5]) {
    const th = ring.slotAngle(k);
    const p = dropAt(th);
    scatterFragments(p[0], p[2], k === 59.5 ? 9 : 5, k === 59.5 ? 34 : 24, true);
    scatterFragments(p[0], p[2], 6, 30, false);
  }

  // the fallen midnight hour-block: broken in two, lying in front of the ring
  {
    const makeHalf = (lo, hi) => {
      const tmp = new Tris();
      const hs = RING.SLOT;
      arcBlock(tmp, 240.5, 285.5, -RING.A_HOUR, RING.A_HOUR, lo * hs, hi * hs, 0.9, [0.95, 0.95, 0.95]);
      if (hi > 0) {
        arcBlock(tmp, 285, 293, -17, 17, Math.max(lo, -0.78) * hs, 0.78 * hs, 0.6, [0.95, 0.95, 0.95]);
        arcBlock(tmp, 292.5, 302, -12.5, 12.5, Math.max(lo, -0.52) * hs, 0.52 * hs, 0.5, [0.95, 0.95, 0.95]);
      }
      const g = tmp.geometry();
      g.translate(-263, 0, 0);
      return g;
    };
    // one half leans with an edge buried, the other lies nearly flat; weathered basalt (the
    // world-space glyph bands of the hour stone would stay horizontal on a toppled piece)
    const pieces = [
      { g: makeHalf(-1, -0.12), at: [-14, 58], rot: [0.15, 0.7, 0.55], sink: 6 },
      { g: makeHalf(0.05, 1), at: [24, 86], rot: [-0.2, 2.1, 0.12], sink: 9.5 },
    ];
    for (const pc of pieces) {
      const w = W(pc.at[0], 0, pc.at[1]);
      const gy = ctx.heightAt(w[0], w[2]);
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(w[0], gy + 12 - pc.sink, w[2]),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(pc.rot[0], pc.rot[1] + yaw, pc.rot[2])),
        new THREE.Vector3(1, 1, 1),
      );
      geoTris(S.basalt, pc.g, m, [1.25, 1.2, 1.1]);
      pc.g.dispose();
    }
    const w = W(4, 0, 70);
    scatterFragments(w[0], w[2], 7, 42, false, 0.55);
  }

  // fallen tapestry slats and spools under the weave / broken sector
  {
    for (const f of tap.fallen) {
      if (!rng.chance(0.55)) continue;
      const w = W(f[0] + rng.range(-6, 6), 0, rng.range(-18, 18));
      const gy = ctx.heightAt(w[0], w[2]);
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(w[0], gy + 0.3, w[2]),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(rng.range(-0.3, 0.3), rng.range(0, 6.28), Math.PI / 2 + rng.range(-0.3, 0.3))),
        new THREE.Vector3(1, 1, 1),
      );
      boxTris(rng.chance(0.3) ? S.basalt : S.stone, 4.85, 1.9, 0.72, m, [0.95, 0.92, 0.85]);
    }
  }

  // tether anchors: stepped basalt plinths with a bronze eye, sunk into the slope
  for (const a of warp.anchors) {
    const [x, , z] = a.pos;
    const gy = a.ground;
    const yawA = Math.atan2(a.dir[0], a.dir[2]);
    const base = new THREE.Matrix4().compose(new THREE.Vector3(x, gy - 3, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yawA, 0)), new THREE.Vector3(1, 1, 1));
    const b1 = new THREE.Matrix4().makeTranslation(0, 3, 0);
    boxTris(S.basalt, 20, 8, 20, base.clone().multiply(b1), [0.9, 0.9, 0.9]);
    boxTris(S.basalt, 13, 6, 13, base.clone().multiply(new THREE.Matrix4().makeTranslation(0, 9.5, 0)), [0.95, 0.95, 0.95]);
    boxTris(S.glyph, 8, 3, 8, base.clone().multiply(new THREE.Matrix4().makeTranslation(0, 13.5, 0)), [1, 1, 1]);
    // bronze eye facing the cable
    const eye = new THREE.TorusGeometry(2.2, 0.7, 8, 16);
    const dl = Math.hypot(a.dir[0], a.dir[1], a.dir[2]);
    const dirN = new THREE.Vector3(a.dir[0] / dl, a.dir[1] / dl, a.dir[2] / dl);
    const side = new THREE.Vector3().crossVectors(dirN, new THREE.Vector3(0, 1, 0)).normalize();
    const qe = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), side);
    geoTris(S.bronze, eye, new THREE.Matrix4().compose(new THREE.Vector3(x, a.pos[1], z), qe, new THREE.Vector3(1, 1, 1)), [1, 1, 1]);
    eye.dispose();
  }

  mark('debris');
  // the cloth beam behind the ring
  buildClothBeam(ctx, frame, rng, S);
  mark('beam');

  await nextFrame();

  // -------------------------------------------------------------------------
  // merge static geometry by material
  // -------------------------------------------------------------------------
  const mats = {
    stone: ctx.materials.get('stoneSmooth'),
    basalt: ctx.materials.get('basaltSmooth'),
    // dimmer by day than the library glyph stone (reads as carving, not lit windows)
    glyph: ctx.materials.create('glyphStone', { color: '#5c544b', glyphs: { cell: 1.5, band: 7.5, height: 2.3, intensity: 1.15, color: '#ffb35c' } }),
    bronze: ctx.materials.get('bronze'),
  };
  // Each material's local (ring) and world sinks become ONE mesh — no further merging needed.
  const staticGroup = new THREE.Group();
  staticGroup.name = 'loom';
  for (const key of Object.keys(mats)) {
    const all = new Tris(L[key].n + S[key].n + 16);
    all.append(L[key], M);
    all.append(S[key]);
    if (!all.n) continue;
    const g = all.geometry();
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, mats[key]);
    mesh.name = `loom:${key}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    staticGroup.add(mesh);
  }
  root.add(staticGroup);
  mark('meshes');

  // hour discs (the clock)
  {
    const g = L.glow.geometry();
    g.applyMatrix4(M);
    const mesh = new THREE.Mesh(g, createHourGlowMaterial(ctx));
    mesh.name = 'loom:hours';
    mesh.matrixAutoUpdate = false;
    root.add(mesh);
  }

  // threads
  const threadMat = createThreadMaterial(ctx);
  const threadGeo = threads.build();
  const threadMesh = new THREE.Mesh(threadGeo, threadMat.material);
  threadMesh.name = 'loom:threads';
  threadMesh.castShadow = false;
  threadMesh.receiveShadow = true;
  threadMesh.matrixAutoUpdate = false;
  threadMesh.renderOrder = 2;
  root.add(threadMesh);

  // hanging spools and loom weights (instanced, swaying with their threads)
  const swayStone = makeSwayingMaterial(ctx, ctx.materials.create('stoneSmooth', { local: true, color: '#a89c88' }), 'stone');
  const inst = (list, geo, name, mat, scaleMul = 1) => {
    if (!list.length) return null;
    const mats4 = list.map((s) =>
      new THREE.Matrix4().compose(
        new THREE.Vector3(s.pos[0], s.pos[1], s.pos[2]),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, s.rot, 0)),
        new THREE.Vector3(s.scale * scaleMul, s.scale * scaleMul, s.scale * scaleMul),
      ),
    );
    const mesh = makeInstanced(geo, mat, mats4, { name });
    setInstanceSway(mesh, list.map((s) => s.sway));
    // sway moves instances a few metres: pad the culling sphere instead of disabling culling
    mesh.computeBoundingSphere();
    mesh.boundingSphere.radius += 12;
    root.add(mesh);
    return mesh;
  };
  const spoolGeo = spoolGeometry();
  const weightGeo = weightGeometry();
  inst(warp.spools, spoolGeo, 'loom:spools', swayStone, 0.9);
  inst(warp.weights, weightGeo, 'loom:weights', swayStone);
  const glowList = warp.spools.filter((s) => s.glow);
  const bandGeo = spoolBandGeometry();
  inst(glowList, bandGeo, 'loom:spool-glow', createSwayGlowMaterial(ctx), 0.9);
  spoolGeo.dispose();
  weightGeo.dispose();
  bandGeo.dispose();

  // -------------------------------------------------------------------------
  // the Eye: an 86 m carved stone disc threaded edgewise on the plumb line at the exact centre
  // of the ring, turning about the line once every three minutes — seen from the lake it slowly
  // opens (face-on: concentric circles inside the ring) and closes (edge-on: a single stroke).
  // -------------------------------------------------------------------------
  const whorl = new THREE.Group();
  whorl.name = 'loom:eye';
  {
    const c = W(0, 0, 0);
    whorl.position.set(c[0], c[1], c[2]);
    // half profile (r, half-thickness): hub, two raised carved rings, a rolled rim
    const half = [
      [0.01, 6], [7.5, 6], [8, 4.6], [19.5, 4.4], [20, 5.4], [21.6, 5.4], [22.1, 4.2], [32.5, 3.9],
      [33, 5.0], [34.6, 5.0], [35.1, 3.6], [40, 3.4], [40.6, 4.7], [42.4, 4.3], [43, 0],
    ];
    const prof = [...half.map(([r, h]) => new THREE.Vector2(r, h)), ...half.slice(0, -1).reverse().map(([r, h]) => new THREE.Vector2(r, -h))];
    const lg = new THREE.LatheGeometry(prof, 72).toNonIndexed();
    lg.rotateX(Math.PI / 2); // symmetry axis -> local z
    lg.computeVertexNormals();
    swayStone.defaultAttributeValues = { ...(swayStone.defaultAttributeValues || {}), aSway: [0, 0, 0] };
    const body = new THREE.Mesh(lg, swayStone);
    body.castShadow = true;
    body.receiveShadow = true;
    whorl.add(body);
    // bronze: hub bosses, bore sleeves where the plumb line enters/leaves, inlaid rings
    const bz = new Tris();
    const rotX = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    geoTris(bz, new THREE.CylinderGeometry(6.2, 7.4, 15, 24, 1), rotX, [1, 1, 1]);
    geoTris(bz, new THREE.CylinderGeometry(3.4, 4.2, 5, 16, 1), new THREE.Matrix4().makeTranslation(0, 43.5, 0), [1, 1, 1]);
    geoTris(bz, new THREE.CylinderGeometry(4.2, 3.4, 5, 16, 1), new THREE.Matrix4().makeTranslation(0, -43.5, 0), [1, 1, 1]);
    for (const zz of [-1, 1]) {
      geoTris(bz, new THREE.TorusGeometry(20.8, 0.9, 6, 72), new THREE.Matrix4().makeTranslation(0, 0, zz * 5.3), [1, 1, 1]);
      geoTris(bz, new THREE.TorusGeometry(33.8, 0.9, 6, 96), new THREE.Matrix4().makeTranslation(0, 0, zz * 4.9), [1, 1, 1]);
    }
    const bronzeLocal = ctx.materials.create('bronze', { local: true });
    const shaft = new THREE.Mesh(bz.geometry(), bronzeLocal);
    shaft.castShadow = true;
    whorl.add(shaft);
    // a thin amber seam between the carved rings, awake at night
    const gl = new Tris();
    for (const zz of [-1, 1]) geoTris(gl, new THREE.TorusGeometry(27.3, 0.45, 5, 96), new THREE.Matrix4().makeTranslation(0, 0, zz * 4.1), [1, 1, 1]);
    const seam = new THREE.Mesh(gl.geometry(), ctx.materials.glow('#ffb35c', { day: 0.08, night: 3.4 }));
    whorl.add(seam);
    whorl.rotation.y = yaw + 0.25; // starts nearly face-on to the lake
  }
  root.add(whorl);

  // for scatter modules / debugging: ring frame and the tether anchor footprints (outside `clear`)
  root.userData.loom = { center: [cx, cy, cz], yaw, anchors: warp.anchors.map((a) => [a.pos[0], a.pos[2], 16]) };
  scene.add(root);

  // -------------------------------------------------------------------------
  // per frame: keep the thread shader's pixel footprint in sync with the camera
  // -------------------------------------------------------------------------
  const size = new THREE.Vector2();
  const update = (dt = 0) => {
    whorl.rotation.y += dt * 0.035;
    ctx.renderer.getDrawingBufferSize(size);
    threadMat.uniforms.uLoomPx.value = (2 * Math.tan((ctx.camera.fov * Math.PI) / 360)) / Math.max(1, size.y);
  };
  update();

  // -------------------------------------------------------------------------
  // curated views
  // -------------------------------------------------------------------------
  const F = floor - cy; // valley floor in ring-local y
  const clear = (p, h = 3) => {
    p[1] = Math.max(p[1], ctx.heightAt(p[0], p[2]) + h);
    return p;
  };
  const viewpoints = [
    // from above the north shore of the lake: the ring standing in its valley, mountains behind
    { label: 'establishing', pos: clear([60, 310, -380]), look: W(0, -60, 0) },
    // ~700 m up the valley: the Eye, the hovering gap, the fallen midnight block, the tethers
    { label: 'approach', pos: clear(W(280, -190, 660), 20), look: W(-10, -70, 0) },
    // from the eastern slope into the low sun: it sets through the ring, behind the warp
    { label: 'dramatic', pos: clear([830, 300, -1690], 30), look: [330, 380, -1770] },
    // on the valley floor in front: the ring overhead, the Eye face-on, the plumb line
    { label: 'below', pos: clear(W(60, F + 3, 330), 2.5), look: W(-10, 60, 0) },
    // among the threads beside the hanging shuttle
    { label: 'intimate', pos: W(-26, 90, 55), look: W(-40, 110, 0) },
    // the unfinished tapestry, its ragged edge and the dangling weft
    { label: 'weave', pos: W(-60, 20, 120), look: W(-140, 70, 0) },
    // behind the ring: the snapped cloth beam and its unrolled weave on the valley floor
    { label: 'beam', pos: clear(W(-230, F + 32, -430), 14), look: W(60, F + 40, -230) },
  ];

  if (ctx.params.debug) {
    console.log(`[loom] build ${Math.round(performance.now() - t0)} ms (${marks.join(' ')}), threads ${threads.threads}, spools ${warp.spools.length}, weights ${warp.weights.length}, verts ${threads.vcount}`);
  }

  return { object: root, viewpoints, update };
}
