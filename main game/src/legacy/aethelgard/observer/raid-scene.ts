import { createProceduralFireRuntime } from '../procedural-fire-runtime';
import { PROCEDURAL_FIRE_SAMPLE_GLSL } from '../../../../../shared/legacy/aethelgard/environment/procedural-fire-shader';
/**
 * A bandit raid made visible in the Elderbloom village (shared/legacy/aethelgard/observer/bandit-raid.ts decides it):
 * the band's torches coming up from beyond the village toward an outlying building, circling it while the watch meets
 * them, then falling back into the dark; and, when the building is set alight, fire on it and a column of smoke that
 * can be seen across the valley, dwindling as the neighbours carry water. When a neighbouring house answers Ealdholt's
 * beacon (neighbour-houses.ts), its riders' pale lanterns come in from that house's side of the village to meet them.
 *
 * Buildings come from the village model itself: every house has a door (S_Medieval_Modular_Door), so doors grouped
 * within a few metres give building centres, and the outermost ones are the farmsteads a band would strike. All of
 * it is GPU billboards with fixed geometry; only the few torch positions are written per frame. It adds no lights, so
 * no material in the village recompiles.
 */
import {
  AdditiveBlending, Color, Group, InstancedBufferAttribute, InstancedBufferGeometry, Matrix4, Mesh, NormalBlending, PlaneGeometry,
  Raycaster, ShaderMaterial, Vector3, type Camera, type Object3D,
} from "three";
import type { RaidBearing, RaidOutcome, RaidPhase, RaidSiteChoice } from "../../../../../shared/legacy/aethelgard/observer/bandit-raid";
import type { WorldEnvironmentState } from "../../../../../shared/legacy/aethelgard/environment/world-environment-state";

/** What the observer lends the view each frame while a raid is under way. */
export interface RaidVisual {
  readonly siteIndex: number | null;
  readonly buildingBinding?: SourceRaidSite['buildingBinding'] | null;
  readonly phase: RaidPhase;
  readonly progress: number;
  readonly outcome: RaidOutcome | null;
  readonly size: number;
  readonly seed: number;
  /** Riders of a neighbouring house answering the beacon, and the side of the village they come from. */
  readonly allies: { readonly count: number; readonly bearing: RaidBearing } | null;
}
export interface SourceRaidSite extends RaidSiteChoice {
  readonly position: readonly [number,number,number]; readonly outward: readonly [number,number,number];
  readonly buildingBinding: import("../../../../../shared/legacy/aethelgard/observer/building-damage").BuildingDamageBinding;
}
interface RaidSite { readonly buildingBinding?: SourceRaidSite['buildingBinding']; readonly index: number; readonly bearing: RaidBearing; readonly position: Vector3; readonly outward: Vector3 }

// Each fire card integrates eight depth samples; keep building overdraw bounded.
const TORCHES = 14, LANTERNS = 8, FLAMES = 8, SMOKE = 72;
const APPROACH_METRES = 75, ALLY_METRES = 110;
/** Bearings in the model's ground plane (x east, z south), as findSites names them. */
const BEARING: Readonly<Record<RaidBearing, readonly [number, number]>> = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };

const BILLBOARD_VERTEX = /* glsl */`
attribute vec4 cfPoint; // xyz centre (model-local metres), w size in metres
attribute vec4 cfSeed;
uniform float cfScale; uniform float cfTime; uniform vec3 cfWind;
varying vec2 vUv; varying vec4 vSeed; varying float vLife;
#ifdef CF_RISING
uniform float cfHeight; uniform float cfSpread; uniform float cfRate;
#endif
void main(){
  vUv=uv; vSeed=cfSeed; vec3 centre=cfPoint.xyz; float size=cfPoint.w; vLife=0.;
#ifdef CF_RISING
  float life=fract(cfTime*cfRate*(.75+cfSeed.z*.5)+cfSeed.w); vLife=life;
  centre+=vec3((cfSeed.x-.5)*cfSpread,life*cfHeight,(cfSeed.y-.5)*cfSpread)+cfWind*life*life*cfHeight*.6;
  size*=mix(.6,2.4,life);
#endif
  vec4 view=modelViewMatrix*vec4(centre,1.);
  view.xy+=position.xy*size*cfScale;
  gl_Position=projectionMatrix*view;
}`;

function billboards(count: number, fragment: string, defines: Record<string, string>, blending: typeof AdditiveBlending | typeof NormalBlending, extra: Record<string, { value: unknown }>) {
  const geometry = new InstancedBufferGeometry();
  const quad = new PlaneGeometry(1, 1);
  geometry.index = quad.index; geometry.setAttribute("position", quad.getAttribute("position")); geometry.setAttribute("uv", quad.getAttribute("uv"));
  const points = new Float32Array(count * 4), seeds = new Float32Array(count * 4);
  for (let i = 0; i < count * 4; i++) seeds[i] = fract(Math.sin((i + 1) * 78.233) * 43758.5453);
  geometry.setAttribute("cfPoint", new InstancedBufferAttribute(points, 4));
  geometry.setAttribute("cfSeed", new InstancedBufferAttribute(seeds, 4));
  geometry.instanceCount = 0;
  const uniforms = { cfScale: { value: 1 }, cfTime: { value: 0 }, cfWind: { value: new Vector3() }, cfIntensity: { value: 0 }, cfColour: { value: new Color() }, ...extra };
  const material = new ShaderMaterial({ uniforms, defines, vertexShader: BILLBOARD_VERTEX, fragmentShader: fragment, transparent: true, depthWrite: false, blending });
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false; mesh.visible = false; mesh.raycast = () => {}; mesh.userData.iwsdkPreviewBounds = "exclude";
  return { mesh, geometry, material, uniforms, points, seeds, dispose() { geometry.dispose(); quad.dispose(); material.dispose(); } };
}
const fract = (n: number) => n - Math.floor(n);
const smooth = (a: number, b: number, v: number) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

const TORCH_FRAGMENT = /* glsl */`
uniform float cfIntensity; uniform float cfTime; varying vec2 vUv; varying vec4 vSeed;
${PROCEDURAL_FIRE_SAMPLE_GLSL}
void main(){
  vec4 flame=cfSampleCombustionFire(vUv,vSeed.x,cfIntensity);
  if(flame.a<.002)discard;
  gl_FragColor=vec4(flame.rgb/max(flame.a,.000001),flame.a);
#ifdef CF_ALLY
  gl_FragColor.rgb*=vec3(.58,.82,1.25);
#endif
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  gl_FragColor.rgb*=gl_FragColor.a;
}`;
const FIRE_FRAGMENT = /* glsl */`
uniform float cfIntensity; varying vec2 vUv; varying vec4 vSeed; varying float vLife;
${PROCEDURAL_FIRE_SAMPLE_GLSL}
void main(){
  vec4 flame=cfSampleCombustionFire(vUv,vSeed.x,cfIntensity*(1.-vLife)*smoothstep(0.,.12,vLife));
  if(flame.a<.002)discard;
  gl_FragColor=vec4(flame.rgb/max(flame.a,.000001),flame.a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  gl_FragColor.rgb*=gl_FragColor.a;
}`;
const SMOKE_FRAGMENT = /* glsl */`
uniform float cfIntensity; uniform vec3 cfColour; varying vec2 vUv; varying vec4 vSeed; varying float vLife;
void main(){
  vec2 p=vUv-.5; float r=length(p);
  float puff=smoothstep(.5,.08,r)*(.75+.25*sin(vSeed.x*30.+r*9.));
  float a=puff*smoothstep(0.,.08,vLife)*(1.-vLife)*.55*cfIntensity;
  gl_FragColor=vec4(cfColour*mix(1.25,.7,vLife),a);
  #include <colorspace_fragment>
}`;

export function createRaidScene(model: Object3D, camera: Camera, sourceSites?: readonly SourceRaidSite[], borrowedFire?: ReturnType<typeof createProceduralFireRuntime>) {
  const fireRuntime=borrowedFire??createProceduralFireRuntime();
  const group = new Group(); group.name = "Ealdholt bandit raid"; model.add(group);
  const torches = billboards(TORCHES, TORCH_FRAGMENT, {}, NormalBlending, fireRuntime.uniforms);
  const fire = billboards(FLAMES, FIRE_FRAGMENT, { CF_RISING: "" }, NormalBlending, { ...fireRuntime.uniforms, cfHeight: { value: 3.2 }, cfSpread: { value: 6 }, cfRate: { value: .9 } });
  const smoke = billboards(SMOKE, SMOKE_FRAGMENT, { CF_RISING: "" }, NormalBlending, { cfHeight: { value: 46 }, cfSpread: { value: 5 }, cfRate: { value: .045 } });
  const lanterns = billboards(LANTERNS, TORCH_FRAGMENT, { CF_ALLY: "" }, NormalBlending, fireRuntime.uniforms);
  for(const effect of [torches,fire,lanterns])effect.material.premultipliedAlpha=true;
  torches.mesh.renderOrder = 3; lanterns.mesh.renderOrder = 3; fire.mesh.renderOrder = 4; smoke.mesh.renderOrder = 2;
  group.add(smoke.mesh, fire.mesh, torches.mesh, lanterns.mesh);
  const stats = { active: false, sites: 0, phase: "" as RaidPhase | "", torches: 0, allies: 0, fire: 0, smoke: 0, raidSeconds: 0, combustion: fireRuntime.diagnostics };
  let sites: RaidSite[] | null = null, legacySites: RaidSite[] | null = null, boundFor="", path: Vector3[] = [], pathFor = -1, effectsFor = -1, disposed = false;
  let allyPath: Vector3[] = [], allyFor = "";
  const villageMiddle = new Vector3();
  let seconds = 0, lastAnimation = Number.NaN, lastReal = 0;
  const scratch = new Vector3(), side = new Vector3(), inverse = new Matrix4();

  /** Doors grouped within 9 m give building centres; the outer half of them are the farmsteads at the village edge. */
  function findSites(): RaidSite[] {
    model.updateWorldMatrix(true, true); inverse.copy(model.matrixWorld).invert();
    const doors: Vector3[] = [];
    model.traverse(node => { if (/Medieval_Modular_Door/i.test(node.name)) doors.push(node.getWorldPosition(new Vector3()).applyMatrix4(inverse)); });
    const clusters: { sum: Vector3; count: number; centre: Vector3 }[] = [];
    for (const door of doors) {
      const near = clusters.find(c => Math.hypot(c.centre.x - door.x, c.centre.z - door.z) < 9);
      if (near) { near.sum.add(door); near.count++; near.centre.copy(near.sum).divideScalar(near.count); }
      else clusters.push({ sum: door.clone(), count: 1, centre: door.clone() });
    }
    if (!clusters.length) return [];
    const middle = clusters.reduce((sum, c) => sum.add(c.centre), new Vector3()).divideScalar(clusters.length);
    villageMiddle.copy(middle);
    const ranked = clusters.map(c => ({ centre: c.centre, distance: Math.hypot(c.centre.x - middle.x, c.centre.z - middle.z) }))
      .sort((a, b) => b.distance - a.distance).slice(0, Math.max(3, Math.ceil(clusters.length / 2)));
    return ranked.map((c, index) => {
      const dx = c.centre.x - middle.x, dz = c.centre.z - middle.z;
      const bearing: RaidBearing = Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? "east" : "west") : (dz < 0 ? "north" : "south");
      return { index, bearing, position: c.centre.clone(), outward: new Vector3(dx, 0, dz).normalize() };
    });
  }
  function ensureLegacySites(): RaidSite[] { legacySites??=findSites();if(!sourceSites)stats.sites=legacySites.length;return legacySites; }
  function ensureSites(): RaidSite[] {
    if(sites)return sites;
    if(sourceSites){
      sites=sourceSites.map((site,index)=>{
        if(site.index!==index||site.buildingBinding.siteIndex!==index||![...site.position,...site.outward].every(Number.isFinite))throw Error("Invalid source-bound raid site.");
        return{...site,position:new Vector3().fromArray(site.position),outward:new Vector3().fromArray(site.outward)};
      });
    }else sites=ensureLegacySites();
    stats.sites=sites.length;return sites;
  }
  function sameBinding(a:SourceRaidSite['buildingBinding']|undefined,b:SourceRaidSite['buildingBinding']):boolean {
    return!!a&&a.catalogueId===b.catalogueId&&a.sourceSha256===b.sourceSha256&&a.profile===b.profile&&a.buildingId===b.buildingId&&a.siteIndex===b.siteIndex;
  }

  /** A road for torches or lanterns: from one point to another, laid on the ground where the terrain can be found. */
  function buildPath(start: Vector3, end: Vector3): Vector3[] {
    const terrain: Object3D[] = [];
    model.traverse(node => { if ((node as Mesh).isMesh && /Landscape/i.test(node.name + (node.parent?.name ?? ""))) terrain.push(node); });
    const ray = new Raycaster(), down = new Vector3(0, -1, 0), out: Vector3[] = [];
    model.updateWorldMatrix(true, true);
    for (let i = 0; i <= 12; i++) {
      const t = i / 12, point = start.clone().lerp(end, t);
      let y = end.y;
      if (terrain.length) {
        const from = point.clone().setY(end.y + 120).applyMatrix4(model.matrixWorld);
        ray.set(from, down); ray.far = 400;
        const hit = ray.intersectObjects(terrain, false)[0];
        if (hit) y = hit.point.applyMatrix4(inverse.copy(model.matrixWorld).invert()).y;
      }
      out.push(point.setY(y + 1.7));
    }
    return out;
  }
  function along(points: readonly Vector3[], s: number, target: Vector3): Vector3 {
    const f = Math.max(0, Math.min(1, s)) * (points.length - 1), i = Math.min(points.length - 2, Math.floor(f));
    return target.copy(points[i]).lerp(points[i + 1], f - i);
  }

  return {
    stats,
    get active() { return stats.active; },
    /** Outlying buildings a band may strike, for the raid to choose from. */
    sites(): readonly RaidSiteChoice[] { return ensureSites().map(site => ({ index: site.index, bearing: site.bearing, ...(site.buildingBinding ? {buildingBinding:site.buildingBinding} : {}) })); },
    update(visual: RaidVisual | null, state: WorldEnvironmentState | null, animationSeconds: number, reducedMotion: boolean) {
      if (disposed) return;
      const now = performance.now() / 1000;
      // Raid motion keeps its own time like the rain: real seconds while the village clock moves, still while it is held.
      if (!reducedMotion && Number.isFinite(lastAnimation) && animationSeconds !== lastAnimation) seconds += Math.min(.25, Math.max(0, now - lastReal));
      lastAnimation = animationSeconds; lastReal = now; stats.raidSeconds = seconds;
      if(!borrowedFire)fireRuntime.update(seconds,reducedMotion,state??undefined);
      stats.combustion=fireRuntime.diagnostics;
      const offered=visual&&visual.siteIndex!==null?(visual.buildingBinding?ensureSites():ensureLegacySites())[visual.siteIndex]:undefined;
      const site=visual?.buildingBinding&&!sameBinding(offered?.buildingBinding,visual.buildingBinding)?undefined:offered;
      const identity=site?.buildingBinding?site.buildingBinding.buildingId:'legacy:'+site?.index;
      if(identity!==boundFor){boundFor=identity;path=[];pathFor=-1;effectsFor=-1;allyPath=[];allyFor='';}
      if(site?.buildingBinding){const offeredSites=ensureSites();if(offeredSites.length)villageMiddle.copy(offeredSites.reduce((sum,s)=>sum.add(s.position),new Vector3())).divideScalar(offeredSites.length);}
      stats.active = !!site; stats.phase = visual?.phase ?? "";
      if (!visual || !site) { torches.mesh.visible = lanterns.mesh.visible = fire.mesh.visible = smoke.mesh.visible = false; stats.allies = 0; stats.fire=stats.smoke=stats.torches=0; return; }
      if (pathFor !== site.index || !path.length) { path = buildPath(site.position.clone().addScaledVector(site.outward, APPROACH_METRES), site.position); pathFor = site.index; }
      model.updateWorldMatrix(true, false);
      const scale = new Vector3().setFromMatrixScale(model.matrixWorld).x || 1, night = 1 - (state?.daylight ?? 1);
      const wind = state ? new Vector3(state.wind[0], 0, state.wind[1]).multiplyScalar(.4 + state.windStrength) : new Vector3(.4, 0, .1);
      for (const fx of [torches, lanterns, fire, smoke]) { fx.uniforms.cfScale.value = scale; fx.uniforms.cfTime.value = seconds; (fx.uniforms.cfWind.value as Vector3).copy(wind); }

      // Torches: marching in a loose file, circling the building, then falling back and going out.
      const { phase, progress } = visual, count = Math.min(TORCHES, visual.size);
      const forward = scratch.copy(path[path.length - 1]).sub(path[0]).setY(0).normalize();
      side.set(-forward.z, 0, forward.x);
      let shown = 0, torchLight = .55 + .45 * night;
      for (let i = 0; i < count; i++) {
        const seedA = torches.seeds[i * 4], seedB = torches.seeds[i * 4 + 1];
        const p = new Vector3();
        if (phase === "clash") {
          const angle = seedA * Math.PI * 2 + seconds * (seedB > .5 ? .35 : -.28), radius = 6 + 3 * Math.sin(seconds * .7 + i);
          p.copy(site.position).add(new Vector3(Math.cos(angle) * radius, 1.7 + .25 * Math.sin(seconds * 3 + i), Math.sin(angle) * radius));
        } else {
          const s = phase === "sighted" ? progress * .15 : phase === "approach" ? .15 + progress * .85 : 1 - Math.min(1, progress * 3);
          along(path, s - (seedB * 6) / APPROACH_METRES, p).addScaledVector(side, (seedA - .5) * 7);
          p.y += .2 * Math.sin(seconds * 4 + i * 1.7);
        }
        torches.points.set([p.x, p.y, p.z, 2.6], shown * 4); shown++;
      }
      if (phase === "aftermath") torchLight *= 1 - smooth(.15, .34, progress);
      torches.geometry.instanceCount = shown; (torches.geometry.getAttribute("cfPoint") as InstancedBufferAttribute).needsUpdate = true;
      torches.uniforms.cfIntensity.value = torchLight; torches.mesh.visible = shown > 0 && torchLight > .01; stats.torches = torches.mesh.visible ? shown : 0;

      // Allied riders: pale lanterns riding in from their house's side during the approach, holding a tighter ring
      // inside the fight, then riding home.
      let riders = 0, lanternLight = 0;
      if (visual.allies && phase !== "sighted") {
        const key = `${site.index}:${visual.allies.bearing}`, [bx, bz] = BEARING[visual.allies.bearing];
        if (allyFor !== key) { allyPath = buildPath(villageMiddle.clone().add(new Vector3(bx, 0, bz).multiplyScalar(ALLY_METRES)).setY(site.position.y), site.position); allyFor = key; }
        const ride = scratch.copy(allyPath[allyPath.length - 1]).sub(allyPath[0]).setY(0), length = ride.length() || 1;
        side.set(-ride.z / length, 0, ride.x / length);
        lanternLight = (.6 + .4 * night) * (phase === "aftermath" ? 1 - smooth(.25, .42, progress) : 1);
        for (let i = 0; i < Math.min(LANTERNS, visual.allies.count); i++) {
          const seedA = lanterns.seeds[i * 4], seedB = lanterns.seeds[i * 4 + 1], p = new Vector3();
          if (phase === "clash") {
            const angle = seedA * Math.PI * 2 - seconds * .5, radius = 3.2 + 1.2 * Math.sin(seconds * .9 + i * 2);
            p.copy(site.position).add(new Vector3(Math.cos(angle) * radius, 2.3 + .2 * Math.sin(seconds * 5 + i), Math.sin(angle) * radius));
          } else {
            const s = phase === "approach" ? progress : 1 - Math.min(1, progress * 2.5);
            along(allyPath, s - (seedB * 10) / length, p).addScaledVector(side, (seedA - .5) * 5);
            p.y += .6 + .25 * Math.sin(seconds * 6 + i * 1.3); // riders sit higher and bob faster than men on foot
          }
          lanterns.points.set([p.x, p.y, p.z, 2.4], riders * 4); riders++;
        }
        (lanterns.geometry.getAttribute("cfPoint") as InstancedBufferAttribute).needsUpdate = true;
      }
      lanterns.geometry.instanceCount = riders; lanterns.uniforms.cfIntensity.value = lanternLight;
      lanterns.mesh.visible = riders > 0 && lanternLight > .01; stats.allies = lanterns.mesh.visible ? riders : 0;

      // Fire and smoke over a burned building: catching late in the clash, beaten down by the water, smoke lingering.
      const burned = visual.outcome === "burned";
      const flame = !burned ? 0 : phase === "clash" ? smooth(.5, 1, progress) : phase === "aftermath" ? 1 - smooth(.15, .6, progress) : 0;
      const fumes = !burned ? 0 : phase === "clash" ? smooth(.55, 1, progress) : phase === "aftermath" ? 1 - smooth(.5, 1, progress) : 0;
      if (effectsFor !== site.index) {
        effectsFor = site.index;
        for (let i = 0; i < FLAMES; i++) fire.points.set([site.position.x, site.position.y + .4 + fire.seeds[i * 4 + 2] * 3.5, site.position.z, 1.6 + fire.seeds[i * 4 + 3] * 1.6], i * 4);
        for (let i = 0; i < SMOKE; i++) smoke.points.set([site.position.x, site.position.y + 4, site.position.z, 4.5 + smoke.seeds[i * 4 + 3] * 3], i * 4);
        fire.geometry.instanceCount = FLAMES; smoke.geometry.instanceCount = SMOKE;
        (fire.geometry.getAttribute("cfPoint") as InstancedBufferAttribute).needsUpdate = true;
        (smoke.geometry.getAttribute("cfPoint") as InstancedBufferAttribute).needsUpdate = true;
      }
      fire.uniforms.cfIntensity.value = flame; fire.mesh.visible = flame > .01; stats.fire = flame;
      const lit = .25 + .75 * (state?.daylight ?? 1);
      (smoke.uniforms.cfColour.value as Color).setRGB(.32 * lit + .18 * flame, .3 * lit + .08 * flame, .29 * lit);
      smoke.uniforms.cfIntensity.value = fumes; smoke.mesh.visible = fumes > .01; stats.smoke = fumes;
    },
    /** A new raid strikes elsewhere: forget the last building's fire and road. */
    reset() { effectsFor = -1; path = []; pathFor = -1; allyPath = []; allyFor = ""; },
    dispose() { if (disposed) return; disposed = true; group.removeFromParent(); torches.dispose(); lanterns.dispose(); fire.dispose(); smoke.dispose(); if(!borrowedFire)fireRuntime.dispose(); },
  };
}
export type RaidScene = ReturnType<typeof createRaidScene>;
