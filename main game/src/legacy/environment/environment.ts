// The desktop Bannerhold environment (standard three): implements the full
// DesktopLegacyEnvironment contract on top of the shared pure build.

import * as THREE from "three";
import type { LandmarkDescriptor, LegacyEnvironmentStats, LegacySceneState } from "../../../../shared/legacy/environment-contract";
import { LEGACY_LANDMARKS } from "../../../../shared/legacy/environment-contract";
import type { LandmarkId } from "../../../../shared/legacy/types";
import type { EnvironmentBuild } from "../../../../shared/legacy/environment/build/buildBannerhold";
import type { CameraFraming } from "../../../../shared/legacy/environment/blueprint/types";
import { estimateBudget } from "../../../../shared/legacy/environment/build/budget";
import type { BudgetEstimate } from "../../../../shared/legacy/environment/build/budget";
import { atlasHeraldryFor, gateVisible, heraldryKey, markerTint, resolveSceneSlots } from "../../../../shared/legacy/environment/build/state";
import type { SceneSlotCounts } from "../../../../shared/legacy/environment/build/state";
import { fillHeraldryAtlas } from "../../../../shared/legacy/environment/heraldry/adapter";
import { HERALDRY_ATLAS_SIZE } from "../../../../shared/legacy/environment/heraldry/atlas";
import { createMaterialLibrary } from "../../../../shared/legacy/environment/materials/library";
import type { EnvironmentQuality } from "../../../../shared/legacy/environment/quality";
import type { DesktopEnvironmentQuality, DesktopLegacyEnvironment, DesktopLegacyEnvironmentOptions, ScreenAnchor } from "../environment-contract";
import { applyFog, createLightRig, skyParams, updateLights } from "./atmosphere";
import type { LightRig } from "./atmosphere";
import { BuildClient } from "./buildClient";
import { CameraRig } from "./cameraRig";
import { AgentSystem, SmokeSystem } from "./life";
import { MaterialFactory } from "./materials";
import { LandmarkPicker } from "./picking";
import { PostPipeline } from "./post";
import { assembleScene, disposeAssembled } from "./sceneAssembly";
import type { AssembledScene } from "./sceneAssembly";
import { createSharedUniforms } from "./shaderPatches";
import type { SharedUniforms } from "./shaderPatches";
import { Sky } from "./sky";
import { TextureLibrary } from "./textures";
import { SceneExplorationController } from "../../../../shared/legacy/exploration/controller";
import { bannerholdRoutes } from "../../../../shared/legacy/exploration/bannerhold";
import { createExplorationFigure } from "../../../../shared/legacy/exploration/figures.js";
import type { ExplorationPoint, LegacyExplorationSnapshot } from "../../../../shared/legacy/exploration/contract";
import { settlementBlueprint } from "../../../../shared/legacy/environment/settlement/build";
import { AUTUMN_LANDMARK_FOOTPRINTS, AUTUMN_WATER_LEVEL, settlementHeight, settlementShore } from "../../../../shared/legacy/environment/settlement/layout";
import { createSettlementSelection } from "../../../../shared/legacy/environment/settlement/selection";
import { SettlementEnvironmentController, AUTUMN_DEFAULT_PLACEMENTS, AUTUMN_SETTLEMENT_SURFACE } from "../../../../shared/legacy/environment/settlement/controller";
import type { SettlementSnapshot, SettlementTool } from "../../../../shared/legacy/settlement/contract";
import { createSettlementRenderer } from "../../../../shared/legacy/settlement/render";
import { settlementPointVisible,unobstructedSettlementPoint } from "./settlement-view";
import { createCombinedWorldKit } from '../../../../shared/legacy/worlds/combined/kit';
import type { CombinedWorldKit,CombinedWorldKitInfo } from '../../../../shared/legacy/worlds/combined/kit';
import { FramePacing } from "../frame-pacing";
import { ShadowRefresh } from "../shadow-refresh";

const PRESET_QUALITY: Record<DesktopEnvironmentQuality["preset"], EnvironmentQuality> = { low: "desktop-low", medium: "desktop-medium", high: "desktop-high" };
const PIXEL_CAP: Record<DesktopEnvironmentQuality["preset"], number> = { low: 1, medium: 1.5, high: 2 };
const TEXTURE_BASE = "assets/legacy/environment/textures/";
/** A view move this large (metres squared) can change which distance-faded trees cast shadows. */
const SHADOW_VIEW_EPSILON_SQ = 1e-6;

export interface EnvironmentDebugInfo {
  sourceKit: CombinedWorldKitInfo|null;
  buildMs: number;
  build: EnvironmentBuild["stats"] | null;
  quality: EnvironmentQuality;
  textures: number;
  staticDrawables: number;
  post: boolean;
  /** Distinct materials in the scene graph (factory materials, sky, smoke). */
  materials: number;
  /** Estimated GPU bytes of material textures, the heraldry atlas and the sky environment map. */
  textureBytes: number;
  /** Estimated GPU bytes of the key light's shadow map (0 without shadows). */
  shadowBytes: number;
  /** Shared in-view budget estimate for the current build (docs/legacy/PERFORMANCE.md). */
  budget: BudgetEstimate | null;
}

export class BannerholdEnvironment implements DesktopLegacyEnvironment {
  private o: DesktopLegacyEnvironmentOptions;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private rig: CameraRig;
  private U: SharedUniforms = createSharedUniforms();
  private client = new BuildClient();
  private build: EnvironmentBuild | null = null;
  private assembled: AssembledScene | null = null;
  private factory: MaterialFactory | null = null;
  private textures: TextureLibrary | null = null;
  private texturesVariant: "high" | "512" | null = null;
  private sky = new Sky(9000);
  private lights: LightRig | null = null;
  private agents: AgentSystem | null = null;
  private smoke: SmokeSystem | null = null;
  private picker: LandmarkPicker | null = null;
  private post: PostPipeline | null = null;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private atlasData = new Uint8ClampedArray(HERALDRY_ATLAS_SIZE.width * HERALDRY_ATLAS_SIZE.height * 4);
  private atlas: THREE.DataTexture;
  private atlasKey = "";
  private state: LegacySceneState;
  private slots: SceneSlotCounts | null = null;
  private quality: DesktopEnvironmentQuality;
  private reduced: boolean;
  private paused = false;
  private disposed = false;
  private raf = 0;
  private last = 0;
  private lastRendered = 0;
  private time = 0;
  /** Intervals between frames rendered back to back, for the automatic step-down (L-01). */
  private pacing = new FramePacing();
  /** The shadow map is redrawn only when a caster or the view may have moved. */
  private shadows = new ShadowRefresh();
  private shadowEye = new THREE.Vector3(NaN, NaN, NaN);
  private shadowExploration: LegacyExplorationSnapshot | null = null;
  private contextLost = false;
  private hovered: LandmarkId | null = null;
  private highlighted: LandmarkId | null = null;
  private externalHighlight: LandmarkId | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private pointer = { down: false, x: 0, y: 0, moved: 0, id: -1, pendingPick: false, px: 0, py: 0, pan:false };
  private width = 1;
  private height = 1;
  private buildMs = 0;
  private readyCalled = false;
  private rebuildToken = 0;
  /** Development override for optional post-processing; undefined follows the preset (off on low). */
  private postPreference: boolean | undefined;
  private renderInfo = { calls: 0, triangles: 0 };
  private anchor = new THREE.Vector3();
  private loadingNation: string | null = null;
  private devFramings = new Map<string, CameraFraming>();
  private exploration: SceneExplorationController;
  private explorer: ReturnType<typeof createExplorationFigure<typeof THREE>> | null = null;
  private routeHints: THREE.LineSegments | null = null;
  private groundRay = new THREE.Raycaster();
  private groundCursor = new THREE.Vector3();
  private settlementSelection: ReturnType<typeof createSettlementSelection> | null = null;
  private estate: SettlementEnvironmentController;
  private estateRenderer: ReturnType<typeof createSettlementRenderer> | null = null;
  private estateUnsubscribe: (()=>void) | null = null;
  private estatePreview: SettlementSnapshot['preview'] = null;
  private previewVisible: boolean | null = null;
  private estateObserver:MutationObserver|null=null;
  private estateRefreshFrame=0;
  private sourceKit:CombinedWorldKit|null=null;

  constructor(o: DesktopLegacyEnvironmentOptions, opts: { post?: boolean } = {}) {
    this.o = o;
    this.state = o.state;
    this.exploration = new SceneExplorationController(o.state);
    this.estate = new SettlementEnvironmentController(o.state, 'bannerhold', AUTUMN_SETTLEMENT_SURFACE, AUTUMN_DEFAULT_PLACEMENTS);
    // Copied so a caller mutating its options object cannot hide a preset change from setQuality.
    this.quality = { ...o.quality };
    this.reduced = o.reducedMotion;
    this.postPreference = opts.post;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance", alpha: false, stencil: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = .94;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // The key light and its shadow camera are fixed: renderFrame redraws the map only when something moved.
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.info.autoReset = false;
    const canvas = this.renderer.domElement;
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.touchAction = "none";
    canvas.style.outline = "none";
    canvas.tabIndex = 0;
    canvas.setAttribute("aria-label", "The Bannerhold");
    o.container.appendChild(canvas);
    this.rig = new CameraRig(1);
    this.rig.reducedMotion = this.reduced;
    this.atlas = new THREE.DataTexture(this.atlasData, HERALDRY_ATLAS_SIZE.width, HERALDRY_ATLAS_SIZE.height, THREE.RGBAFormat);
    this.atlas.colorSpace = THREE.SRGBColorSpace;
    this.atlas.flipY = true;
    this.atlas.generateMipmaps = true;
    this.atlas.minFilter = THREE.LinearMipmapLinearFilter;
    this.atlas.magFilter = THREE.LinearFilter;
    this.atlas.anisotropy = 4;
    this.scene.add(this.sky.mesh);
    this.U.uMotionScale.value = this.reduced ? 0.35 : 1;
    this.measure();
    this.bindInput();
  }

  // --- Lifecycle -------------------------------------------------------------

  async init(): Promise<void> {
    await this.load(this.state, PRESET_QUALITY[this.quality.preset]);
    this.start();
  }

  private async load(state: LegacySceneState, q: EnvironmentQuality): Promise<void> {
    const token = ++this.rebuildToken;
    this.loadingNation = state.nationId;
    const variant: "high" | "512" = q === "desktop-high" ? "high" : "512";
    const texturesPromise = this.texturesVariant === variant && this.textures ? Promise.resolve(this.textures) : TextureLibrary.load(TEXTURE_BASE, variant, this.renderer.capabilities.getMaxAnisotropy() > 8 ? 8 : 4);
    const [built, loaded] = await Promise.allSettled([this.client.build({ state, quality: q, nationId: state.nationId }), texturesPromise]);
    const stale = this.disposed || token !== this.rebuildToken;
    if (stale || built.status === "rejected" || loaded.status === "rejected") {
      if (loaded.status === "fulfilled" && loaded.value && loaded.value !== this.textures) loaded.value.dispose();
      // A superseded or disposed load ends quietly; the newest load owns the busy flag and any error.
      if (stale) return;
      this.loadingNation = null;
      throw built.status === "rejected" ? built.reason : (loaded as PromiseRejectedResult).reason;
    }
    const { build, ms } = built.value, textures = loaded.value;
    if (textures !== this.textures) {
      this.textures?.dispose();
      this.textures = textures;
      this.texturesVariant = variant;
    }
    this.buildMs = ms;
    this.install(build, state);
    this.loadingNation = null;
    await this.renderer.compileAsync(this.scene, this.rig.camera);
    if (this.disposed) return;
    this.renderFrame(1 / 60);
    if (!this.readyCalled) {
      this.readyCalled = true;
      this.o.onReady?.();
    }
  }

  private install(build: EnvironmentBuild, state: LegacySceneState): void {
    const prevBuild = this.build;
    this.explorer?.dispose();
    this.estateUnsubscribe?.();this.estateRenderer?.dispose();
    this.sourceKit?.dispose();this.sourceKit=null;
    this.settlementSelection?.dispose();
    if (this.routeHints) { this.routeHints.removeFromParent(); this.routeHints.geometry.dispose(); (this.routeHints.material as THREE.Material).dispose(); }
    // Tear down the previous world.
    if (this.assembled) disposeAssembled(this.assembled);
    this.factory?.dispose();
    if (this.lights) {
      this.scene.remove(this.lights.group);
      this.lights.key.shadow.map?.dispose();
    }
    if (this.smoke) {
      this.scene.remove(this.smoke.mesh);
      this.smoke.dispose();
    }
    this.build = build;
    const preset = this.quality.preset;
    const shadows = build.quality.shadows.enabled;
    this.renderer.shadowMap.enabled = shadows;
    this.shadows.invalidate();
    const lib = createMaterialLibrary(build.nationId);
    this.factory = new MaterialFactory({ lib, uniforms: this.U, textures: this.textures, atlas: this.atlas });
    this.assembled = assembleScene(build, this.factory, shadows);
    this.scene.add(this.assembled.root);
    this.sourceKit=createCombinedWorldKit({THREE,profile:'desktop',quality:this.quality.preset,groundAt:settlementHeight,hostManorObjects:()=>this.assembled?.root.children.filter((node:any)=>node.isMesh&&!node.isInstancedMesh&&!!node.geometry?.getAttribute('landmarkId'))??[]});this.sourceKit.setReducedMotion(this.reduced);this.assembled.root.add(this.sourceKit.root);
    this.estateRenderer=createSettlementRenderer(THREE,{groundAt:settlementHeight,previewGroundAt:(x,z)=>Math.max(settlementHeight(x,z),AUTUMN_WATER_LEVEL)+.02,materialFor:key=>this.factory!.get(key),runtimeBuildingFactory:this.sourceKit.buildBuilding});
    this.assembled.root.add(this.estateRenderer.root);this.estateUnsubscribe=this.estate.subscribeSettlement(snapshot=>{this.estatePreview=snapshot.preview;this.estateRenderer?.sync(snapshot);this.shadows.invalidate();});
    this.settlementSelection = createSettlementSelection(THREE, AUTUMN_LANDMARK_FOOTPRINTS, { sampleGround: settlementHeight });
    this.settlementSelection.setReducedMotion(this.reduced); this.assembled.root.add(this.settlementSelection.root);
    const a = build.staging.atmosphere;
    this.sky.apply(skyParams(a));
    applyFog(this.U, a);
    this.renderer.setClearColor(new THREE.Color(a.sky.horizon), 1);
    const sb = build.staging.settlementBounds;
    this.lights = createLightRig(a, sb, build.lights, build.quality.maxLights, shadows ? build.quality.shadows.mapSize : 0);
    this.scene.add(this.lights.group);
    this.makeEnvironmentMap();
    if (build.quality.smoke && build.smoke.length) {
      this.smoke = new SmokeSystem(build.smoke, this.U, new THREE.Color(a.fog.colour).lerp(new THREE.Color("#9a9096"), 0.4));
      this.scene.add(this.smoke.mesh);
    } else this.smoke = null;
    this.agents = new AgentSystem(build.agents, this.assembled.instanced, build.field, this.rig.camera);
    this.picker = new LandmarkPicker(build.colliders, build.landmarks);
    const routes = bannerholdRoutes(state, build.colliders, settlementBlueprint(state.nationId), settlementHeight, (x,z)=>x<settlementShore(z)?AUTUMN_WATER_LEVEL:NaN);
    this.exploration.configure(state, routes);
    this.explorer = createExplorationFigure(THREE, { atlas: this.atlas });
    this.scene.add(this.explorer.root);
    const points = routes.graph.edges.flatMap(edge => {
      const a = routes.graph.nodes.find(n => n.id === edge.from)!.position, b = routes.graph.nodes.find(n => n.id === edge.to)!.position;
      return [a.x, a.y + .045, a.z, b.x, b.y + .045, b.z];
    });
    const hintGeometry = new THREE.BufferGeometry(); hintGeometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
    this.routeHints = new THREE.LineSegments(hintGeometry, new THREE.LineBasicMaterial({ color: "#c29c58", transparent: true, opacity: .3, depthWrite: false }));
    this.routeHints.visible = false; this.scene.add(this.routeHints);
    const keepView = prevBuild && prevBuild.nationId === build.nationId;
    this.rig.setWorld(build.staging.cameras, build.colliders, build.field);
    this.rig.setAerialMode(true);
    this.devFramings.forEach((f) => this.rig.addFraming(f));
    if (!keepView) this.rig.focus(state.draft && !state.founded ? "founding" : "establishing", true);
    else this.rig.focus(this.rig.activeId, true);
    this.estate.setPreviewGuard(placement=>this.placementVisible(placement.x,placement.z)?null:'Bring this plot into view before placing.');
    this.atlasKey = "";
    this.applyState(state);
    this.setupPost(preset);
    this.measure();
  }

  private makeEnvironmentMap(): void {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    const skyClone = new THREE.Mesh(this.sky.mesh.geometry, this.sky.material);
    envScene.add(skyClone);
    this.envRT?.dispose();
    this.envRT = pmrem.fromScene(envScene, 0, 1, 12000);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = 0.5;
    pmrem.dispose();
  }

  private setupPost(preset: DesktopEnvironmentQuality["preset"]): void {
    this.post?.dispose();
    this.post = null;
    // Post is optional: never on low, on for medium/high unless a development override says no.
    if (preset === "low" || this.postPreference === false) return;
    const pr = this.renderer.getPixelRatio();
    this.post = new PostPipeline(this.renderer, this.scene, this.rig.camera, Math.max(1, Math.floor(this.width * pr)), Math.max(1, Math.floor(this.height * pr)), preset === "high");
    this.post.setSize(this.width, this.height, pr);
  }

  private start(): void {
    const loop = (now: number): void => {
      if (this.disposed) return;
      this.raf = requestAnimationFrame(loop);
      if (this.paused || document.hidden || !this.build || this.contextLost) {
        this.last = now;
        this.pacing.interrupt();
        return;
      }
      const limit = this.quality.frameLimit;
      if (limit > 0 && now - this.lastRendered < 1000 / limit - 1) return;
      const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 1 / 60;
      this.last = now;
      const t0 = performance.now();
      this.renderFrame(dt);
      this.lastRendered = now;
      // The step-down reads the interval between rendered frames (a slow graphics card stretches it);
      // the JavaScript submission cost is kept beside it.
      this.pacing.rendered(now, performance.now() - t0);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private renderFrame(dt: number): void {
    if (!this.build) return;
    this.time += dt;
    this.U.uTime.value = this.time;
    if (this.pointer.pendingPick) this.doHover();
    this.exploration.update(dt);
    const exploration = this.exploration.getSnapshot();
    this.explorer?.update(exploration, dt, this.reduced);
    if (this.routeHints) this.routeHints.visible = exploration.enabled && exploration.available;
    this.settlementSelection?.update(dt);
    this.rig.apply(dt);
    this.sourceKit?.update(dt,this.rig.camera);
    if(this.estatePreview){const visible=this.placementVisible(this.estatePreview.x,this.estatePreview.z);if(visible!==this.previewVisible){this.previewVisible=visible;this.estate.refreshPreview();}}else this.previewVisible=null;
    this.sky.update(this.rig.camera, this.time);
    if (this.lights) updateLights(this.lights, this.time);
    this.agents?.update(this.reduced ? 0 : this.time);
    this.refreshShadows(exploration);
    const info = this.renderer.info;
    info.reset();
    if (this.post) this.post.render(dt);
    else this.renderer.render(this.scene, this.rig.camera);
    this.renderInfo.calls = info.render.calls;
    this.renderInfo.triangles = info.render.triangles;
  }

  /**
   * Figures and wind move every frame unless motion is reduced; a walking explorer and a moving view
   * (distance-faded vegetation casts shadows) move them too. Otherwise the map stays as drawn.
   */
  private refreshShadows(exploration: LegacyExplorationSnapshot): void {
    const map = this.renderer.shadowMap;
    if (!map.enabled) return;
    const eye = this.rig.camera.position;
    const viewMoved = eye.distanceToSquared(this.shadowEye) > SHADOW_VIEW_EPSILON_SQ || !Number.isFinite(this.shadowEye.x);
    if (viewMoved) this.shadowEye.copy(eye);
    const explorerChanged = exploration !== this.shadowExploration || exploration.status === "moving";
    this.shadowExploration = exploration;
    if (this.shadows.frame(!this.reduced || viewMoved || explorerChanged)) map.needsUpdate = true;
  }

  /** A rebuild after creation (nation or preset change) reports a failure instead of leaving the screen busy. */
  private rebuild(state: LegacySceneState, q: EnvironmentQuality): void {
    this.load(state, q).catch((error: unknown) => this.fail(error instanceof Error ? error : new Error(String(error))));
  }

  private fail(error: Error): void {
    if (this.disposed) return;
    if (this.o.onError) this.o.onError(error);
    else console.warn(`My Legacy: the Bannerhold environment stopped (${error.message}).`);
  }

  private onContextLost = (event: Event): void => {
    // Rendering stops here; the caller's failure state offers Retry, which builds a fresh context.
    event.preventDefault();
    if (this.contextLost) return;
    this.contextLost = true;
    this.pacing.interrupt();
    this.fail(new Error("The graphics context was lost."));
  };

  // --- State -------------------------------------------------------------------

  setState(state: LegacySceneState): void {
    const prev = this.state;
    this.state = state;
    this.exploration.setState(state);this.estate.setState(state);
    if (!this.build) return;
    if (state.nationId !== this.build.nationId) {
      this.rebuild(state, PRESET_QUALITY[this.quality.preset]);
      return;
    }
    if (state.draft && !state.founded && !(prev.draft && !prev.founded)) this.rig.focus("founding");
    else if (!state.draft && prev.draft && this.rig.activeId === "founding") this.rig.focus("establishing");
    this.applyState(state);
  }

  private applyState(state: LegacySceneState): void {
    const build = this.build;
    const a = this.assembled;
    if (!build || !a) return;
    const slots = resolveSceneSlots(state, build.slotCapacities);
    this.slots = slots;
    for (const g of a.gated) g.object.visible = gateVisible(g.gate, slots);
    const setCount = (name: string, n: number): void => {
      const list = a.instanced.get(name);
      if (list) for (const m of list) m.count = Math.min(n, m.instanceMatrix.count);
    };
    setCount(build.slots.pawn, slots.pawn);
    setCount(build.slots.injured, slots.injured);
    setCount(build.slots.levy, slots.levy);
    setCount(build.slots.honours, slots.honours);
    setCount(build.slots.notices, slots.notices);
    const markers = a.instanced.get(build.slots.recordMarkers);
    if (markers) {
      for (const m of markers) {
        m.count = Math.min(slots.recordMarkers.length, m.instanceMatrix.count);
        if (m.instanceColor) {
          const arr = m.instanceColor.array as Float32Array;
          slots.recordMarkers.forEach((o, i) => arr.set(markerTint(o), i * 3));
          m.instanceColor.needsUpdate = true;
        }
      }
    }
    const h = atlasHeraldryFor(state, build.staging.atmosphere);
    const key = heraldryKey(h);
    if (key !== this.atlasKey) {
      this.atlasKey = key;
      fillHeraldryAtlas(this.atlasData, h);
      this.atlas.needsUpdate = true;
    }
    this.shadows.invalidate();
  }

  // --- Camera and landmarks -----------------------------------------------------

  focusLandmark(id: LandmarkId | null): void {
    this.settlementSelection?.setSelected(id);
  }

  highlightLandmark(id: LandmarkId | null): void {
    this.externalHighlight = id;
    this.refreshHighlight();
  }

  private refreshHighlight(): void {
    const id = this.externalHighlight ?? this.hovered;
    this.highlighted = id;
    this.U.uHighlight.value = id ? LEGACY_LANDMARKS.indexOf(id) + 1 : 0;
    this.settlementSelection?.setHovered(id);
  }

  getLandmarks(): readonly LandmarkDescriptor[] {
    if (!this.build) return [];
    return this.build.landmarks.map((l) => ({ id: l.id, label: l.label, position: l.anchor }));
  }

  nudgeOrbit(yaw: number, pitch: number, zoom = 0): void {
    this.rig.nudge(yaw, pitch, zoom);
  }

  resetView(): void {
    this.rig.focus("establishing");
  }

  inspectRepresentative(): void {
    this.rig.focus("representative");
  }

  /** Development: add a harness-only framing (district close-ups). */
  defineFraming(f: CameraFraming): void {
    this.devFramings.set(f.id, f);
    this.rig.addFraming(f);
  }

  /** Development: frame any authored camera id (used by the harness and capture script). */
  focusFraming(id: string, instant = false): boolean {
    if (!this.rig.has(id)) return false;
    this.rig.focus(id, instant);
    return true;
  }

  projectLandmark(id: LandmarkId): ScreenAnchor | null {
    const l = this.build?.landmarks.find((x) => x.id === id);
    if (!l) return null;
    this.anchor.set(l.anchor[0], l.anchor[1], l.anchor[2]).project(this.rig.camera);
    const visible = this.anchor.z < 1 && this.anchor.z > -1 && Math.abs(this.anchor.x) <= 1.05 && Math.abs(this.anchor.y) <= 1.05;
    return { x: (this.anchor.x * 0.5 + 0.5) * this.width, y: (-this.anchor.y * 0.5 + 0.5) * this.height, visible };
  }

  // --- Settings -------------------------------------------------------------------

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.exploration.setPaused(paused);
  }

  getSettlementSnapshot():SettlementSnapshot{return this.estate.getSettlementSnapshot();}
  getSettlementRenderInfo(){return this.estateRenderer?.getRenderInfo()??{placements:[],preview:null};}
  getSettlementSourceInfo(){return this.sourceKit?.getInfo()??null;}
  projectSettlementPoint(x:number,z:number,worldY?:number):ScreenAnchor|null {if(!this.build||![x,z].every(Number.isFinite)||(worldY!==undefined&&!Number.isFinite(worldY)))return null;this.anchor.set(x,worldY??settlementHeight(x,z)+.1,z).project(this.rig.camera);return{x:(this.anchor.x*.5+.5)*this.width,y:(-.5*this.anchor.y+.5)*this.height,visible:this.anchor.z>=-1&&this.anchor.z<=1&&Math.abs(this.anchor.x)<=1&&Math.abs(this.anchor.y)<=1};}
  private placementVisible(x:number,z:number):boolean{return settlementPointVisible(this.renderer.domElement,this.projectSettlementPoint(x,z));}
  focusSettlementPreview():void {const preview=this.estate.getSettlementSnapshot().preview,free=unobstructedSettlementPoint(this.renderer.domElement);if(!preview||!free)return;this.rig.frameTarget({x:preview.x,y:settlementHeight(preview.x,preview.z),z:preview.z});this.rig.panPixels(free.x-this.width/2,free.y-this.height/2,this.height);this.previewVisible=null;}
  private queueEstateRefresh():void {if(this.estateRefreshFrame||this.disposed)return;this.estateRefreshFrame=requestAnimationFrame(()=>{this.estateRefreshFrame=0;this.estate.refreshPreview();});}
  subscribeSettlement(listener:(snapshot:SettlementSnapshot)=>void){return this.estate.subscribeSettlement(listener);}
  setSettlementTool(tool:SettlementTool|null){return this.estate.setSettlementTool(tool);}
  setSettlementCursor(x:number,z:number){return this.estate.setSettlementCursor(x,z);}
  moveSettlementCursor(dx:number,dz:number){return this.estate.moveSettlementCursor(dx,dz);}
  rotateSettlementPreview(){return this.estate.rotateSettlementPreview();}
  commitSettlementPlacement(){return this.estate.commitSettlementPlacement();}
  cancelSettlementPlacement(){this.estate.cancelSettlementPlacement();}
  selectSettlementPlacement(id:string|null){return this.estate.selectSettlementPlacement(id);}
  deleteSettlementPlacement(id?:string){return this.estate.deleteSettlementPlacement(id);}
  getExplorationSnapshot(): LegacyExplorationSnapshot { return this.exploration.getSnapshot(); }
  setExplorationMember(id: string): boolean { return this.exploration.setMember(id); }
  travelToLandmark(id: LandmarkId): boolean { return this.exploration.travel(id); }
  moveToPoint(point: ExplorationPoint): boolean { return this.exploration.moveToPoint(point); }
  fastTravelToLandmark(id: LandmarkId): boolean { const moved = this.exploration.fastTravel(id); if (moved) { const point = this.exploration.getSnapshot().location; if (point) this.rig.frameTarget(point, true); } return moved; }
  cancelTravel(): void { this.exploration.cancel(); }
  setExplorationEnabled(enabled: boolean): void { this.exploration.setEnabled(enabled); }
  subscribeExploration(listener: (snapshot: LegacyExplorationSnapshot) => void): () => void { return this.exploration.subscribe(listener); }

  setQuality(q: DesktopEnvironmentQuality): void {
    const prev = this.quality;
    this.quality = { ...q };
    this.measure();
    if (prev.preset !== q.preset) this.rebuild(this.state, PRESET_QUALITY[q.preset]);
  }

  /** Development: enable or disable optional post-processing. */
  setPost(enabled: boolean): void {
    this.postPreference = enabled;
    this.setupPost(this.quality.preset);
  }

  setReducedMotion(reduced: boolean): void {
    this.reduced = reduced;
    this.settlementSelection?.setReducedMotion(reduced);
    this.sourceKit?.setReducedMotion(reduced);
    this.rig.reducedMotion = reduced;
    this.U.uMotionScale.value = reduced ? 0.35 : 1;
    this.shadows.invalidate();
  }

  getStats(): LegacyEnvironmentStats & { shadowRedraws: { frames: number; redraws: number } } {
    const mem = this.renderer.info.memory;
    return {
      triangles: this.renderInfo.triangles,
      drawCalls: this.renderInfo.calls,
      geometries: mem.geometries,
      textures: mem.textures,
      programs:this.renderer.info.programs?.length??0,
      frameTimesMs: this.pacing.frameIntervals(),
      frameTimesMeasure: "frame-interval",
      submissionTimesMs: this.pacing.submissionTimes(),
      shadowRedraws: this.shadows.counts(),
    };
  }

  /** Development diagnostics for the harness and capture script. */
  debugInfo(): EnvironmentDebugInfo {
    const materials = new Set<THREE.Material>();
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(m)) m.forEach((x) => materials.add(x));
      else if (m) materials.add(m);
    });
    const atlasBytes = HERALDRY_ATLAS_SIZE.width * HERALDRY_ATLAS_SIZE.height * 4 * (this.atlas.generateMipmaps ? 4 / 3 : 1);
    // PMREM cube-UV target: half-float RGBA.
    const envBytes = this.envRT ? this.envRT.width * this.envRT.height * 8 : 0;
    const key = this.lights?.key;
    const shadowBytes = key && key.castShadow ? key.shadow.mapSize.x * key.shadow.mapSize.y * 4 : 0;
    return {
      sourceKit:this.sourceKit?.getInfo()??null,
      buildMs: this.buildMs,
      build: this.build ? this.build.stats : null,
      quality: PRESET_QUALITY[this.quality.preset],
      textures: this.textures?.count() ?? 0,
      staticDrawables: this.assembled?.staticDrawables ?? 0,
      post: !!this.post,
      materials: materials.size,
      textureBytes: Math.round((this.textures?.gpuBytes() ?? 0) + atlasBytes + envBytes),
      shadowBytes,
      budget: this.build ? estimateBudget(this.build) : null,
    };
  }

  /** Development: render one frame immediately (captures) and wait for transitions. */
  renderNow(dt = 1 / 60): void {
    this.shadows.invalidate();
    this.renderFrame(dt);
  }

  /** Development: the build the scene was made from. */
  get currentBuild(): EnvironmentBuild | null {
    return this.build;
  }

  get busy(): boolean {
    return this.loadingNation !== null || this.rig.transitioning || !this.build;
  }

  get programs(): number {
    return this.renderer.info.programs?.length ?? 0;
  }

  resize(): void {
    this.measure();
  }

  private measure(): void {
    const r = this.o.container.getBoundingClientRect();
    this.width = Math.max(1, Math.floor(r.width));
    this.height = Math.max(1, Math.floor(r.height));
    const pr = Math.min(window.devicePixelRatio || 1, PIXEL_CAP[this.quality.preset]) * Math.min(1, Math.max(0.5, this.quality.renderScale / 100));
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(this.width, this.height, false);
    this.rig.resize(this.width / this.height);
    this.queueEstateRefresh();
    this.post?.setSize(this.width, this.height, pr);
  }

  // --- Input --------------------------------------------------------------------------

  private bindInput(): void {
    const el = this.renderer.domElement;
    el.addEventListener("pointerdown", this.onDown);
    el.addEventListener("pointermove", this.onMove);
    el.addEventListener("pointerup", this.onUp);
    el.addEventListener("pointercancel", this.onCancel);
    el.addEventListener("pointerleave", this.onLeave);
    el.addEventListener("wheel", this.onWheel, { passive: false });
    el.addEventListener("contextmenu", this.onContextMenu);
    el.addEventListener("webglcontextlost", this.onContextLost);
    const screen=this.o.container.closest('.legacy-screen');
    if(screen&&typeof MutationObserver!=='undefined'){this.estateObserver=new MutationObserver(()=>this.queueEstateRefresh());this.estateObserver.observe(screen,{subtree:true,childList:true,attributes:true,attributeFilter:['class','style','hidden','aria-hidden']});}
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => this.measure());
      this.resizeObserver.observe(this.o.container);
    }
  }

  private onDown = (e: PointerEvent): void => {
    this.pointer.down = true;
    this.pointer.x = e.clientX;
    this.pointer.y = e.clientY;
    this.pointer.moved = 0;
    this.pointer.id = e.pointerId;
    this.pointer.pan = e.button !== 0 || e.shiftKey;
    this.renderer.domElement.setPointerCapture(e.pointerId);
  };

  private onMove = (e: PointerEvent): void => {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.px = e.clientX - rect.left;
    this.pointer.py = e.clientY - rect.top;
    if (this.pointer.down && e.pointerId === this.pointer.id) {
      const dx = e.clientX - this.pointer.x, dy = e.clientY - this.pointer.y;
      this.pointer.x = e.clientX;
      this.pointer.y = e.clientY;
      this.pointer.moved += Math.abs(dx) + Math.abs(dy);
      if(this.pointer.pan)this.rig.panPixels(dx,dy,this.height);else this.rig.orbitBy(-dx * 0.18, dy * 0.12);
    } else {
      if(this.estate.getSettlementSnapshot().tool){const point=this.pointerGround(e);if(point)this.estate.setSettlementCursor(point.x,point.z);}
      this.pointer.pendingPick = true;
    }
  };

  private pointerGround(event:PointerEvent):THREE.Vector3|null {
    const rect=this.renderer.domElement.getBoundingClientRect();
    this.groundRay.setFromCamera(new THREE.Vector2((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1),this.rig.camera);
    const ray=this.groundRay.ray;if(Math.abs(ray.direction.y)<.05)return null;
    let distance=(3-ray.origin.y)/ray.direction.y;
    for(let i=0;i<7;i++){this.groundCursor.copy(ray.direction).multiplyScalar(distance).add(ray.origin);distance=(settlementHeight(this.groundCursor.x,this.groundCursor.z)-ray.origin.y)/ray.direction.y;}
    if(distance<=0)return null;
    return this.groundCursor.copy(ray.direction).multiplyScalar(distance).add(ray.origin);
  }

  private onUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointer.id) return;
    this.pointer.down = false;
    this.renderer.domElement.releasePointerCapture(e.pointerId);
    if(e.button!==0){if(e.button===2&&this.pointer.moved<6&&this.estate.getSettlementSnapshot().tool)this.estate.cancelSettlementPlacement();return;}
    if (this.pointer.moved < 6 && !this.pointer.pan) {
      const point=this.pointerGround(e),estate=this.estate.getSettlementSnapshot();
      if(estate.tool){if(point){this.estate.setSettlementCursor(point.x,point.z);this.estate.commitSettlementPlacement();}return;}
      const renderedPlacement=this.estateRenderer?.pick(this.groundRay);
      if(renderedPlacement){this.estate.selectSettlementPlacement(renderedPlacement);this.settlementSelection?.setSelected(null);return;}
      if(point){const placement=estate.placements.find(p=>{const dx=point.x-p.x,dz=point.z-p.z,yaw=p.rotation*Math.PI/2,c=Math.cos(yaw),s=Math.sin(yaw);return Math.abs(c*dx-s*dz)<=p.width/2&&Math.abs(s*dx+c*dz)<=p.depth/2;});if(placement){this.estate.selectSettlementPlacement(placement.id);this.settlementSelection?.setSelected(null);return;}}
      const rect = this.renderer.domElement.getBoundingClientRect();
      const id = this.picker?.pick(this.rig.camera, e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height) ?? null;
      if (this.exploration.getSnapshot().enabled) {
        if (id) this.travelToLandmark(id);
        else if (this.assembled) {
          this.groundRay.setFromCamera(new THREE.Vector2((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1), this.rig.camera);
          const hit = this.groundRay.intersectObject(this.assembled.root, true)[0];
          if (hit) this.moveToPoint({ x: hit.point.x, y: hit.point.y, z: hit.point.z });
        }
      } else if (id) this.o.onLandmarkSelect(id);
    }
  };

  private onCancel = (): void => {
    this.pointer.down = false;
  };
  private onContextMenu = (event:MouseEvent):void => {event.preventDefault();};

  private onLeave = (): void => {
    if (this.hovered) {
      this.hovered = null;
      this.refreshHighlight();
      this.o.onLandmarkHover(null);
    }
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.rig.orbitBy(0, 0, Math.exp(Math.max(-1, Math.min(1, e.deltaY * 0.0015))));
  };

  private doHover(): void {
    this.pointer.pendingPick = false;
    if (!this.picker || this.pointer.down) return;
    const id = this.picker.pick(this.rig.camera, this.pointer.px, this.pointer.py, this.width, this.height);
    if (id !== this.hovered) {
      this.hovered = id;
      this.refreshHighlight();
      this.o.onLandmarkHover(id);
      this.renderer.domElement.style.cursor = id ? "pointer" : "";
    }
  }

  // --- Disposal -------------------------------------------------------------------------

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.exploration.dispose(); this.explorer?.dispose();this.estate.dispose();
    this.estateUnsubscribe?.();this.estateRenderer?.dispose();
    this.sourceKit?.dispose();this.sourceKit=null;
    this.settlementSelection?.dispose();
    if (this.routeHints) { this.routeHints.geometry.dispose(); (this.routeHints.material as THREE.Material).dispose(); }
    cancelAnimationFrame(this.raf);
    const el = this.renderer.domElement;
    el.removeEventListener("pointerdown", this.onDown);
    el.removeEventListener("pointermove", this.onMove);
    el.removeEventListener("pointerup", this.onUp);
    el.removeEventListener("pointercancel", this.onCancel);
    el.removeEventListener("pointerleave", this.onLeave);
    el.removeEventListener("wheel", this.onWheel);
    el.removeEventListener("contextmenu", this.onContextMenu);
    el.removeEventListener("webglcontextlost", this.onContextLost);
    this.resizeObserver?.disconnect();
    this.estateObserver?.disconnect();cancelAnimationFrame(this.estateRefreshFrame);
    this.client.dispose();
    if (this.assembled) disposeAssembled(this.assembled);
    this.factory?.dispose();
    this.textures?.dispose();
    this.lights?.key.shadow.map?.dispose();
    this.smoke?.dispose();
    this.sky.dispose();
    this.post?.dispose();
    this.envRT?.dispose();
    this.atlas.dispose();
    this.scene.environment = null;
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    el.remove();
    this.build = null;
    this.assembled = null;
  }
}
