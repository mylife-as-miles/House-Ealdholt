declare const __EALDHOLT_SITE_BYTES__: number | undefined;
import { createEaldholtOpenWater } from './open-water-runtime';
import {createEaldholtGardenPlanting} from './garden-planting';
import {createEaldholtGardenLife,createGardenSoundscape} from './garden-life';
import type {MenuEffectsOutput} from '../../../../shared/menu/audio';
import {createBuildingDamageVisuals, type BuildingDamageVisuals} from './building-damage';
import {createBuildingEmergencySitesAsync,type BuildingEmergencySites} from './building-emergency-sites';
import {prepareVillageWorkplaces,type VillageWorkplaces} from './village-workplaces';
import {createDefaultCrowdLoader} from './characters/crowd-residents';
import {createBuildingDisasterEffects,type BuildingDisasterEffects} from './building-disaster-effects';
import {createEmergencyActionVisuals,type EmergencyActionVisuals,type EmergencyActionVisualRecord} from './emergency-action-visuals';
import type {BuildingDisasterViewSource} from '../../../../shared/legacy/aethelgard/observer/building-disaster-view';
import {buildingDamageKey,type BuildingDamageBinding} from '../../../../shared/legacy/aethelgard/observer/building-damage';
import type {BuildingPhysicalDisasterRecord} from '../../../../shared/legacy/aethelgard/observer/building-collapse';
import type {BuildingFireRecord} from '../../../../shared/legacy/aethelgard/observer/building-conflagration';
import type {ResidentBuildingIncident} from '../../../../shared/legacy/aethelgard/characters/resident-building-emergency';
import type {VillagePopulationRuntime} from '../../../../shared/legacy/aethelgard/characters/village-population-runtime';
import {createWorldResourceRetirementFence} from './world-resource-retirement';
import type {BuildingConditionRecord} from '../../../../shared/legacy/aethelgard/observer/building-damage';
import {createVillageNightLights, type VillageNightLights} from './village-night-lights';
import {NATURAL_RIPARIAN_ASSET_PATH,naturalRiparianAsset} from '../../../../shared/legacy/aethelgard/environment/natural-riparian-policy';
import {SCANNED_SHRUB_ASSETS,SCANNED_SHRUB_ASSET_PATH,scannedShrubAssetMetadataMatches} from '../../../../shared/legacy/aethelgard/environment/scanned-shrub-assets';
import {borrowForest01TreeSource,borrowRealisticTreeSource,normalizeRealisticTreeSource} from './realistic-tree-source';
import { getHouseholdArtSet } from '../../../../shared/legacy/aethelgard/characters/household-art-sets';
import {REGIONAL_VEGETATION_PROFILES} from '../../../../shared/legacy/aethelgard/environment/regional-vegetation-profiles';
import {appendRegionalVoxelSource} from '../../../../shared/legacy/aethelgard/environment/regional-voxel-source';
import {REGIONAL_VEGETATION_PROTOTYPES} from '../../../../shared/legacy/aethelgard/environment/regional-assets';
import {createWorldEnvironment,type WorldEnvironment} from './world-environment';
import {createWorldPresentationClock} from '../../../../shared/legacy/aethelgard/environment/world-presentation-clock';
import {createEaldholtEnvironmentAssetLoader,type EaldholtEnvironmentAssetLoader} from './environment-asset-loader';
import {createWorldRain,type WorldRain} from './world-rain';
import {createRaidScene,type RaidScene,type RaidVisual} from './observer/raid-scene';
import {createVillageAnchors,type VillageAnchors} from './observer/village-anchors';
import type {RaidSiteChoice} from '../../../../shared/legacy/aethelgard/observer/bandit-raid';
import {getVillagePopulationTime,getVillagePopulationObservationStatus,type VillagePopulationSample} from '../../../../shared/legacy/aethelgard/characters/village-population-runtime';
import {createVillagePopulationObservationPump} from '../../../../shared/legacy/aethelgard/characters/village-population-observation-pump';
import type {WorldEnvironmentOverride} from '../../../../shared/legacy/aethelgard/environment/world-environment-state';
import {createRegionalForest,type RegionalForest} from './regional-forest';
import {createRegionalLandmarks,type RegionalLandmarks} from './regional-landmarks';
import {REGIONAL_ASSET_PATH} from '../../../../shared/legacy/aethelgard/environment/regional-assets';
import {TextureLoader} from 'three';
import {initialWoodlandProgress,initialWoodlandReadiness} from '../../../../shared/legacy/aethelgard/environment/initial-woodland';
import type {EaldholtLoadingReport,EaldholtLoadingStage} from '../../../../shared/legacy/aethelgard/loading-progress';
import {readResponseBytes} from './download-progress';
import {loadChunkedVillageModel} from './chunked-village-model';
import {loadEaldholtRegionalWoodland,type EaldholtRegionalWoodland} from './regional-woodland';
import {
  ACESFilmicToneMapping, Box3, CanvasTexture, Color, DirectionalLight,
  EquirectangularReflectionMapping, Fog, Frustum, HemisphereLight, InstancedMesh,
  Matrix4, Mesh, Object3D, PCFSoftShadowMap, PerspectiveCamera, PMREMGenerator, PointLight,
  Scene, Sphere, Spherical, SRGBColorSpace, Texture, Vector2, Vector3, WebGLRenderer, type Camera,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EALDHOLT_VILLAGE_VIEWS, type EaldholtViewId } from "../../../../shared/legacy/aethelgard/village-views";
import { ealdholtRepresentativePlantDiameter, selectEaldholtGroundcoverCells, type EaldholtGroundcoverCell } from "../../../../shared/legacy/aethelgard/environment/groundcover-visibility";
import { ealdholtPlantTriangleBudget } from "../../../../shared/legacy/aethelgard/environment/plant-triangle-budget";
import { createEaldholtVillageFire, type EaldholtVillageFire } from "./village-fire";
import { alphaCoverage, preserveAlphaCoverage } from "./alpha-coverage";
import { createEaldholtAtmosphere, type EaldholtAtmosphere } from "./village-atmosphere";
import { createEaldholtRiverValley, type EaldholtRiverValley } from "./river-valley";
import { createEaldholtWoodlandVisibility, type EaldholtWoodlandVisibility } from './woodland-visibility';
import {createEaldholtTreeHlod, type EaldholtTreeHlod} from './vegetation-hlod';
import {createVegetationPreparationWorker} from './vegetation-worker';
import {createVegetationPrototypeResources, type VegetationPrototypeResources} from './vegetation-prototype';
import {createVegetationCellHlod, readVegetationSourceTriangles, type VegetationCellHlod} from './vegetation-cell-hlod';
import {createGrassGroundLook, type GrassGroundLook} from './grass-ground-look';
import {identifySourceVegetation} from '../../../../shared/legacy/aethelgard/environment/source-vegetation-kind';
import {createWorldGpuFrameGate} from './world-gpu-frame';
import {createWorldGlDiagnostics} from './world-gl-diagnostics';
import {createObservationDemandRender} from './observation-demand-render';
import {pendingVillageResidentAvailability,type VillageResidentAvailability} from '../../../../shared/legacy/aethelgard/characters/village-resident-availability';
import {qualifiedResidentFollowPosition} from '../../../../shared/legacy/aethelgard/observer/resident-watch';
import {updateResidentFollowCamera} from './observer/resident-follow-camera';
import {describeResidentFollowTrace} from './observer/resident-follow-trace';
import {createWorldPreparationQueue} from '../../../../shared/legacy/aethelgard/environment/world-preparation-queue';
import {createWorldPreparationPump} from '../../../../shared/legacy/aethelgard/environment/world-preparation-pump';
import {createWorldEnvironmentChangeHandler} from '../../../../shared/legacy/aethelgard/environment/environment-change';
import {createAuthoredTerrainStream, type AuthoredTerrainStream} from './terrain-stream';
import {createAuthoredArchitectureSuffixVisibility, type AuthoredArchitectureSuffixVisibility} from './architecture-suffix-visibility';
import {createEaldholtRegionalHorizonView} from './regional-horizon-view';
import {createWorldVoxelGI, type WorldVoxelGI} from './voxel-gi';
import {collectVoxelRegionSource} from './voxel-source';
import type {VoxelLiveLight} from './voxel-radiance';
import { createEaldholtRiverWoodland, type EaldholtRiverWoodland } from "./river-woodland";
import { createEaldholtBankLandform, type EaldholtBankLandform } from "./bank-landform";
import { createEaldholtCoastalContinuity, type EaldholtCoastalContinuity } from "./coastal-continuity";
import { createEaldholtOuterContinuation, type EaldholtOuterContinuation } from "./outer-continuation";
import { createEaldholtFarSurround, createEaldholtFarSurroundBridge, type EaldholtFarSurround, type EaldholtFarSurroundBridge } from "./far-surround";
import { createEaldholtFarWoodland, createEaldholtBorrowedFarWoodlandPrototype, collectEaldholtWoodlandSurfaces, markEaldholtFarWoodlandMaterialIdentity, type EaldholtFarWoodland } from "./far-woodland";
import type { EaldholtFarWoodlandLod } from "./far-woodland-lod";
import type { EaldholtFarProjectionPacket } from "../../../../shared/legacy/aethelgard/environment/far-surround";
import { EALDHOLT_NATIVE_FAR_PROJECTION_READY } from "../../../../shared/legacy/aethelgard/environment/far-surround-projection";
import { createEaldholtRiverMargin, type EaldholtRiverMargin } from "./river-margin";
import { createEaldholtWoodlandUnderstory, type EaldholtWoodlandUnderstory } from "./woodland-understory";
import { createEaldholtFoliageDensity, type EaldholtFoliageDensity } from "./foliage-density";
import { applyEaldholtFoliageCoverageMips, type EaldholtFoliageCoverageMips } from "./foliage-coverage-mips";
import { applyEaldholtNeutralFill, type EaldholtNeutralFill } from "./neutral-fill";
import { applyEaldholtPondShore, type EaldholtPondShore } from "./pond-shore";
import { applyEaldholtWaterLook, type EaldholtWaterLook } from "./water-look";
import { applyEaldholtGroundAo, type EaldholtGroundLook } from "./ground-look";
import { loadEaldholtGroundAlbedoDetail, type EaldholtGroundAlbedoDetail } from "./ground-albedo-detail";
import { loadEaldholtValleyGroundSet, type EaldholtValleyGroundSet } from "./woodland-ground";
import { ealdholtPondProbeValleyArtStatus } from "../../../../shared/legacy/aethelgard/environment/woodland-ground";
import { applyEaldholtExportRepairs, type EaldholtExportRepairHandle } from "./export-repairs";
export type { EaldholtViewId } from "../../../../shared/legacy/aethelgard/village-views";
import type { DesktopEnvironmentQuality } from "../environment-contract";
import type { EaldholtPondProbeCapture } from "./pond-probe-authoring";
import type { EaldholtDistantCoastPreview } from "./distant-coast-preview";
import { readEaldholtPondProbeConfig } from "../../../../shared/legacy/aethelgard/environment/pond-probe-config";
import { desktopReleaseVillage } from "../release-village";
import { applyEaldholtBorrowedPondProbe, type EaldholtPondProbeBinding } from "./pond-probe-texture";
import { loadEaldholtOwnedPondProbe, type EaldholtOwnedPondProbe } from "./pond-probe-runtime";
import { EALDHOLT_LOCAL_POND_NORMAL_STRENGTH, EALDHOLT_LOCAL_POND_ROUGHNESS } from "../../../../shared/legacy/aethelgard/environment/pond-probe";
import { createEaldholtPlanarPond, createEaldholtPondRedraw, type EaldholtPlanarPond } from './pond-planar-reflection';
import { readEaldholtResidentPreviewInput, loadVerifiedResidentPreviewGlb,
  type EaldholtResidentPreviewInput } from '../../../../shared/legacy/aethelgard/resident-preview-input';
import { loadEaldholtStandingResidentPreview, ealdholtResidentPreviewSourceBounds,
  assertEaldholtResidentPreviewContained, type EaldholtStandingResidentPreview } from './resident-preview';
import { assertResidentPreviewTextures } from '../../../../shared/legacy/aethelgard/resident-preview-textures';
import { EALDHOLT_VILLAGE_DAYLIGHT as DAYLIGHT } from '../../../../shared/legacy/aethelgard/environment/daylight';
import { readEaldholtPopulationSiteInput, loadEaldholtPopulationSite, type EaldholtPopulationSiteInput } from '../../../../shared/legacy/aethelgard/characters/population-site-input';
import { createEaldholtVillageSite, validateVillageSiteRigidClearance, applyVillageSiteRigidClearance, sameVillageSiteNavigationAllocation, validateVillageSiteWorkplaceAnchors, type VillageSiteLayout, type VillageSiteOptions } from '../../../../shared/legacy/aethelgard/characters/village-site';
import { parsePopulationMotionEvidence } from '../../../../shared/legacy/aethelgard/characters/population-motion-clearance';
import { createVillagePopulationStore, type VillagePopulationStore } from '../../../../shared/legacy/aethelgard/characters/village-population-store';
import { sampleVillagePopulationRuntime } from '../../../../shared/legacy/aethelgard/characters/village-population-runtime';
import { EALDHOLT_POPULATION_ASSET_SHA256 } from '../../../../shared/legacy/aethelgard/characters/population-asset-integrity';
import { createEaldholtPopulationDiagnosticsCache, createEaldholtVillagePopulationView, type EaldholtVillagePopulationView } from './village-population-view';
import { verifyResidentPreviewGlb } from '../../../../shared/legacy/aethelgard/resident-preview-input';
import { populationPaintSignature } from './population-paint';
import { createPopulationPreparationWindow } from './population-preparation';
import type { VillageWorldStatus } from '../../../../shared/legacy/aethelgard/environment/world-status';
import { sunShadowNeedsRefresh } from '../../../../shared/legacy/aethelgard/environment/sun-shadow-refresh';
import {createLegacyMainPassDrawDiagnostics} from '../../../../shared/legacy/draw-diagnostics';
import{createBankMaterialDrawDiagnostics}from'../../../../shared/legacy/aethelgard/environment/bank-material-diagnostics';
import { createVillageDiagnosticsReporter, createVillageFrameGuard, villageFrameInterval, villageFrameLimit, VILLAGE_CAMERA_SETTLE_MS } from './village-frame';

export interface EaldholtVillageView {
  setActive(active: boolean): void;
  setInteractive(interactive: boolean): void;
  setReducedMotion(reduced: boolean): void;
  setQuality(quality: DesktopEnvironmentQuality): void;
  setPanelMode(mode: "intro" | "banner" | "village"): void;
  setView(view: EaldholtViewId): void;
  orbit(yaw: number, pitch: number, zoom?: number): void;
  resetView(): void;
  /** Null until a real inherited entry has been confirmed. */
  setPopulationEntry(worldKey: string | null): void;
  /** My Legacy's observer: its clock and sky laid over the village's own; null gives the village back. */
  setObserver(observer: VillageObserverLink | null): void;
  /** Everyone's place in their day as the observer sees it; positions only where the population site is configured. */
  sampleResidents(): VillagePopulationSample | null;
  readCanonicalPopulation(): VillagePopulationRuntime | null;
  readObservedPopulation(): VillagePopulationRuntime | null;
  buildingDisasterSource(incidents:readonly ResidentBuildingIncident[]): BuildingDisasterViewSource | null;
  inspectBuilding(binding:BuildingDamageBinding):boolean;
  /** Actual pre-cull placement/motion qualification and current body submission,
   * independent of the resident's canonical life or a promise of visible pixels. */
  residentAvailability(residentId: string): VillageResidentAvailability;
  /** Follows a qualified source location; false selections still follow life in the panel. True does not promise a drawn body. */
  follow(residentId: string | null): boolean;
  /** Outlying buildings a bandit raid may strike (found from the model's doors); empty until the world is ready. */
  raidSites(): readonly RaidSiteChoice[];
  /** Projects a point in the village model's frame to pixels in the host (speech bubbles); false when behind the camera. */
  project(point: readonly [number, number, number], out: { x: number; y: number; distance: number }): boolean;
  /** Where a villager's voice comes from at a place while their figure is not in the village (observer/village-anchors.ts). */
  voiceAnchor(placeId: string, residentId: string): readonly [number, number, number] | null;
  dispose(): void;
}

/** What the observer (shared/legacy/aethelgard/observer) lends the view: the observed clock and the sky it commands. */
export interface VillageObserverLink {
  simulatedMilliseconds(storeMilliseconds: number): number;
  override(absoluteMinute?: number): WorldEnvironmentOverride | undefined;
  speed?(): number;
  safetySignals?(absoluteMinute: number): readonly import('../../../../shared/legacy/aethelgard/characters/resident-safety').ResidentSafetySignal[];
  /** A bandit raid under way, drawn as torches, fire and smoke (observer/raid-scene.ts). */
  raid?(absoluteMinute?: number): RaidVisual | null;
  buildingConditions?():readonly BuildingConditionRecord[];
  /** Completed coupled fire/NPC snapshot. While linked, the old independent projection is bypassed. */
  runtimeSnapshot?():VillagePopulationRuntime|null;
  buildingDisasterConditions?():readonly BuildingPhysicalDisasterRecord[];
  buildingFires?():readonly BuildingFireRecord[]|null;
}

interface VillageViewOptions {
  audioOutput?():MenuEffectsOutput|null;
  host: HTMLElement;
  modelUrl: string;
  quality: DesktopEnvironmentQuality;
  active: boolean;
  reducedMotion: boolean;
  panelMode: "intro" | "banner" | "village";
  label: string;
  onReady(): void;
  onError(): void;
  /** The named stage the load has reached, for My Legacy's loading screen. Presentation only: it changes nothing the loader does. */
  onProgress?(report: EaldholtLoadingReport): void;
  onWorldStatus?(status: VillageWorldStatus): void;
  /** DEV-only isolated reflection control; leaves the normal product unchanged. */
  diagnosticFlatPond?: true;
  diagnosticFlatPondRoughness?: number;
  /** Desktop High only; same-view pond reflection remains opt-in for review. */
  diagnosticPlanarPond?: true;
  /** DEV-only Desktop geometry diagnostic; the normal product stays unchanged. */
  diagnosticDistantCoast?: true;
  /** DEV-only comparison override; normal runtime and probe captures retain coverage. */
  diagnosticCoverageMips?: boolean;
  /** DEV-only authored shallow/damp appearance; disabled for probe authoring. */
  diagnosticPondShore?: true;
  /** One-shot DEV authoring callback on a separate non-XR renderer. This
   * exports radiance data without exposing the scene or renderer to callers. */
  authorPondProbe?: {
    profile: "desktop" | "quest";
    modelSha256: string;
    lightingVersion: string;
    onCapture(result: EaldholtPondProbeCapture): void;
    onError(error: unknown): void;
  };
}

/** Original procedural daylight radiance: no downloaded HDR or scene asset.
 * The directional light supplies HDR sunlight; this panorama supplies broad
 * sky/ground reflection and diffuse fill through PMREM. */
function daylightPanorama(): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 1024; canvas.height = 512;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Daylight environment could not be prepared.");
  const pixels = context.createImageData(canvas.width, canvas.height);
  const mix = (a: number, b: number, t: number) => a + (b - a) * t;
  const top = [110, 158, 202], horizon = [211, 225, 231], ground = [91, 91, 72];
  for (let y = 0; y < canvas.height; y++) {
    const v = y / (canvas.height - 1);
    for (let x = 0; x < canvas.width; x++) {
      const u = x / canvas.width;
      const sky = Math.min(1, v * 2), earth = Math.max(0, Math.min(1, (v - .49) * 12));
      const ripple = Math.sin(u * Math.PI * 12 + Math.sin(v * 21)) * .23
        + Math.sin(u * Math.PI * 26 - v * 17) * .12 + Math.sin(u * Math.PI * 52 + v * 43) * .055;
      const clouds = Math.max(0, ripple + .04) * .7 * Math.max(0, 1 - Math.abs(v - .33) / .19);
      const offset = (y * canvas.width + x) * 4;
      for (let c = 0; c < 3; c++) {
        const colour = mix(mix(top[c], horizon[c], sky), ground[c], earth);
        pixels.data[offset + c] = Math.round(mix(colour, 243, clouds));
      }
      pixels.data[offset + 3] = 255;
    }
  }
  context.putImageData(pixels, 0, 0);
  const direction = new Vector3(...DAYLIGHT.sunOffset).normalize();
  const sx = (.5 + Math.atan2(direction.z, direction.x) / (2 * Math.PI)) * canvas.width;
  const sy = (.5 - Math.asin(direction.y) / Math.PI) * canvas.height;
  const glow = context.createRadialGradient(sx, sy, 1, sx, sy, 22);
  glow.addColorStop(0, "rgba(255,247,225,.8)"); glow.addColorStop(1, "rgba(255,247,225,0)");
  context.fillStyle = glow; context.fillRect(sx - 23, sy - 23, 46, 46);
  context.beginPath(); context.arc(sx, sy, 1.3, 0, Math.PI * 2); context.fillStyle = "#fff9ed"; context.fill();
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.mapping = EquirectangularReflectionMapping;
  texture.name = "Original Crownfall procedural daylight panorama";
  return texture;
}

interface PlantCell {
  object: Object3D;
  kind: "tree" | "groundcover";
  box: Box3;
  triangles: number;
  sourceInstances: number;
  family: string;
  plantDiameter: number;
  drawCalls: number;
  center: Vector3;
  halfSize: Vector3;
}

function meshTriangles(mesh: Mesh): number {
  const authored = readVegetationSourceTriangles(mesh); if (authored !== null) return authored;
  const vertices = mesh.geometry.index?.count ?? mesh.geometry.getAttribute("position")?.count ?? 0;
  return Math.floor(vertices / 3) * (mesh instanceof InstancedMesh ? mesh.count : 1);
}

/** Each loader result is private to this view. Cached assets from the existing
 * Legacy renderer are never borrowed or disposed by this opt-in preview. */
function disposeModel(root: Object3D): void {
  const geometries = new Set<Mesh["geometry"]>();
  const materialList = new Set<import("three").Material>();
  const textures = new Set<Texture>();
  const images = new Set<ImageBitmap>();
  root.traverse(object => {
    if (!(object instanceof Mesh)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materialList.add(material);
      for (const value of Object.values(material)) if (value instanceof Texture) textures.add(value);
    }
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materialList) material.dispose();
  for (const texture of textures) {
    const image: unknown = texture.source?.data;
    if (typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap) images.add(image);
    texture.dispose();
  }
  for (const image of images) image.close();
}

export function createEaldholtVillageView(options: VillageViewOptions): EaldholtVillageView {
  const planarRequested=import.meta.env.DEV&&(options.diagnosticPlanarPond===true||new URLSearchParams(window.location.search).get('ealdholtPlanarPond')==='1');
  const coverageMipsDiagnostic = import.meta.env.DEV && (options.diagnosticCoverageMips !== undefined
    || new URLSearchParams(window.location.search).has('ealdholtCoverageMips'));
  const coverageMipsRequested = !(import.meta.env.DEV && (options.diagnosticCoverageMips === false
    || new URLSearchParams(window.location.search).get('ealdholtCoverageMips') === '0'));
  // The normal world and its offline pond capture share the same canopy look.
  const coverageMipsEnabled = coverageMipsRequested;
  const pondShoreRequested = import.meta.env.DEV && (options.diagnosticPondShore === true || new URLSearchParams(window.location.search).get('ealdholtPondShore') === '1');
  const pondShoreEnabled = pondShoreRequested && !options.authorPondProbe;
  const pondRoughness = import.meta.env.DEV && options.diagnosticFlatPond && options.diagnosticFlatPondRoughness !== undefined
    ? options.diagnosticFlatPondRoughness : EALDHOLT_LOCAL_POND_ROUGHNESS;
  if (!Number.isFinite(pondRoughness) || pondRoughness < 0 || pondRoughness > 1) throw Error('Invalid flat pond diagnostic roughness.');
  let quality = options.quality;
  let active = options.active;
  let reducedMotion = options.reducedMotion;
  let disposed = false;
  let model: Object3D | null = null;
  let residentPreview: EaldholtStandingResidentPreview | null = null;
  let lastResidentTick = 0;
  const conservativeSceneBounds = new Box3(), residentWorldBounds = new Box3();
  let modelAssembled=false,modelPresented=false;
  // A listener's failure must never become a load failure.
  const reportStage=(stage:EaldholtLoadingStage,fraction:number|null=null)=>{if(disposed||!options.onProgress)return;try{options.onProgress({stage,fraction});}catch{/* presentation only */}};
  let populationEntry: string | null = null, populationInput: EaldholtPopulationSiteInput | null = null;
  let population: EaldholtVillagePopulationView | null = null, populationStore: VillagePopulationStore | null = null;
  // My Legacy's observer: the village as it is watched (paused or run ahead), and the villager being followed.
  let observer: VillageObserverLink | null = null, followId: string | null = null, populationSite: VillageSiteLayout | null = null;
  let lastFrameSample: VillagePopulationSample | null = null;
  let workplaces:VillageWorkplaces|null=null;
  let emergencySites:BuildingEmergencySites|null=null, emergencyActionVisuals:EmergencyActionVisuals|null=null;
  const emergencyGroundHeight=(x:number,z:number)=>emergencySites?.groundHeight(x,z)??NaN;
  function releaseEmergencySites():void {
    workplaces?.dispose();workplaces=null;
    emergencyActionVisuals?.dispose();emergencyActionVisuals=null;
    emergencySites?.dispose();emergencySites=null;
  }
  function externallyObserved(snapshot:VillagePopulationRuntime):VillagePopulationRuntime|null {
    const projected=observer?.runtimeSnapshot?.();
    return projected&&projected.worldKey===snapshot.worldKey&&projected.contentRevision===snapshot.contentRevision?projected:null;
  }
  const followPoint = new Vector3(), projectPoint = new Vector3();
  let villageAnchors: VillageAnchors | null = null;
  let observedSnapshot: ReturnType<VillagePopulationStore['getSnapshot']> | null = null;
  const worldPresentationClock=createWorldPresentationClock();
  const observationDemand = createObservationDemandRender();
  const populationObservationPump = createVillagePopulationObservationPump({
    allowed: () => !disposed && active && !!observer && !!populationStore && !externallyObserved(populationStore.getSnapshot()),
    read: () => {
      if (!observer || !populationStore) return null;
      const link = observer, snapshot = populationStore.getSnapshot();
      return { owner: link, snapshot, requestedMilliseconds: link.simulatedMilliseconds(snapshot.clock.simulatedElapsedMilliseconds),
        options: { site: populationSite, workplaceFrame:workplaces?.frame, preferCanonical: (link.speed?.() ?? 1) === 1,
          environmentAt: (minute: number) => link.override(minute), signalsAt: (minute: number) => link.safetySignals?.(minute) ?? [] } };
    },
    accepted: snapshot => {
      observedSnapshot = snapshot;
      const progress = getVillagePopulationObservationStatus(snapshot);
      if (observationDemand.update(!disposed && active && reducedMotion && modelPresented,
        progress?.pendingMilliseconds ?? 0, snapshot.clock.millisecondsPerWorldMinute) && !gpuFrame.terminalFailure) requestRender();
    },
    // The presenter retains its previous frame. Progress alone does not force
    // a costly environment draw after every deferred two-minute slice.
    changed: () => { reportPopulation(); },
    onError: error => {
      populationStatus = 'error'; populationError = error instanceof Error ? error.message : 'Population observation failed.';
      population?.setActive(false); if (populationTimer !== null) clearInterval(populationTimer); populationTimer = null;
      reportPopulation();
    },
  });
  const updateObserved = (snapshot: ReturnType<VillagePopulationStore['getSnapshot']>) => {
    if (!observer) { observedSnapshot = null; return snapshot; }
    const projected=externallyObserved(snapshot);if(projected){populationObservationPump.pause();observedSnapshot=projected;return projected;}
    return populationObservationPump.step() ?? snapshot;
  };
  const observed = (snapshot: ReturnType<VillagePopulationStore['getSnapshot']>) => observer ? externallyObserved(snapshot) ?? observedSnapshot ?? updateObserved(snapshot) : snapshot;
  let populationAbort: AbortController | null = null, populationTimer: ReturnType<typeof setInterval> | null = null;
  let populationStatus = 'entry-required', populationError = '', lastPopulationTick = 0;
  const populationPreparation = createPopulationPreparationWindow();
  let lastPopulationPaintSignature = '';
  const populationTracing = import.meta.env.DEV && new URLSearchParams(location.search).get('ealdholtPopulationTrace') === '1';
  const graphicsTracing = new URLSearchParams(location.search).get('ealdholtWorldTrace') === '1';
  /** Host data attributes are diagnostics for tests and capture tools: refreshed every frame in development,
   * at most twice a second (and only when changed) in release builds (L-23). */
  const report = createVillageDiagnosticsReporter(options.host, import.meta.env.DEV ? 0 : 500);
  let populationTraceFrames = 0;
  const tracePopulation = (stage: string) => { if (populationTracing) console.debug('EALDHOLT_POPULATION_STAGE', stage); };
  const populationPageHide = () => { populationStore?.flush(); };
  const populationDiagnosticsCache = createEaldholtPopulationDiagnosticsCache();
  let previousPopulationLife: ReturnType<typeof populationDiagnosticsCache.read> | undefined;
  function reportPopulation(): void {
    const host = options.host.dataset, snapshot = population?.snapshot;
    const observation = observedSnapshot ? getVillagePopulationObservationStatus(observedSnapshot) : undefined;
    const life = observation?.mode === 'analytic-history-unavailable' ? undefined : (observedSnapshot ?? populationStore?.getSnapshot())?.life;
    if (report.due) { report.set('populationObservation',JSON.stringify(observation ?? null)); report.set('populationObservationPump',JSON.stringify(populationObservationPump.stats)); }
    report.set('populationStatus',populationStatus); report.set('populationError',populationError);
    report.set('populationRegistered',String(populationStore ? 100 : 0));
    report.set('populationHouseholds',String(populationStore ? 25 : 0));
    report.set('populationMajor',String(populationStore ? 20 : 0));
    report.set('populationScheduled',String(populationStore ? 80 : 0));
    report.set('populationPersistence',populationStore?.persistence ?? 'entry-required');
    report.set('populationPersistenceError',populationStore?.error ?? '');
    report.set('populationSnapshot',populationDiagnosticsCache.serializeSnapshot(snapshot ?? null));
    const lifeDiagnostics = populationDiagnosticsCache.read(life);
    if (lifeDiagnostics !== previousPopulationLife) {
      previousPopulationLife = lifeDiagnostics; report.set('populationLife',JSON.stringify(lifeDiagnostics));
    }
    report.set('populationSelected',String(snapshot?.selected ?? 0));
    report.set('populationDrawn',String((snapshot?.crowd.drawn ?? 0) + (snapshot?.household.drawn ?? 0)));
    report.set('populationFailed',String((snapshot?.crowd.failed ?? 0) + (snapshot?.household.failed ?? 0)));
    report.set('populationReady',String((snapshot?.crowd.ready ?? 0) + (snapshot?.household.ready ?? 0)));
    report.set('populationSourceSha256',populationInput?.source.sha256 ?? '');
    report.set('populationSiteSha256',populationInput?.site.sha256 ?? '');
  }
  function stopPopulation(): void {
    observationDemand.cancel();worldPresentationClock.reset();
    populationPreparation.reset(); populationDiagnosticsCache.clear(); previousPopulationLife = undefined;
    populationAbort?.abort(); populationAbort = null;
    if (populationTimer !== null) clearInterval(populationTimer); populationTimer = null;
    releaseEmergencySites();
    population?.object.removeFromParent(); population?.dispose(); population = null;
    populationStore?.attachSite(null); populationStore?.dispose(); populationStore = null; lastPopulationTick = 0; lastPopulationPaintSignature = '';
    populationSite = null; lastFrameSample = null; observedSnapshot = null; populationObservationPump.clear();
    globalThis.removeEventListener('pagehide', populationPageHide);
  }
  async function startPopulation(): Promise<void> {
    if (disposed || !populationEntry || options.authorPondProbe) return;
    if (!populationStore) {
      try {
        let storage: Storage | null = null; try { storage = globalThis.localStorage; } catch { /* Explicit memory-only status. */ }
        const store = createVillagePopulationStore({ entryIdentity: populationEntry, storage }); populationStore = store;
        populationTimer = setInterval(() => {
          if (disposed || populationStore !== store) return;
          try {
            updateObserved(store.advance()); reportPopulation();
            if(active&&worldEnvironment&&performance.now()-lastEnvironmentRequest>1000){lastEnvironmentRequest=performance.now();if(observationDemand.allowAutomatic()&&!gpuFrame.terminalFailure)requestRender();}
            // Reduced-motion mode keeps the large environment demand-rendered.
            // Bounded setup frames let newly loaded bodies appear without
            // turning a static inspection into a continuous GPU redraw loop.
            const state = population?.snapshot;
            if (active && reducedMotion && state && population) {
              // Loading metadata/images changes no pixels. Prepare bounded
              // actor sets on the CPU without repeatedly repainting the whole
              // environment while asynchronous requests are still pending.
              population.update(0, true); reportPopulation();
              const prepared = population.snapshot;
              const signature = populationPaintSignature({ selected: prepared.selected,
                loading: prepared.crowd.loading + prepared.household.loading,
                actorSets: prepared.crowd.actorSets + prepared.household.actorSets,
                setups: prepared.crowd.setups + prepared.household.setups, revision: prepared.visualRevision });
              if (signature !== null && signature !== lastPopulationPaintSignature && observationDemand.allowAutomatic() && !gpuFrame.terminalFailure) { lastPopulationPaintSignature = signature; requestRender(); }
            }
          }
          catch (error) {
            populationStatus = 'error'; populationError = error instanceof Error ? error.message : 'Population clock failed.';
            population?.setActive(false); if (populationTimer !== null) clearInterval(populationTimer); populationTimer = null;
            reportPopulation();
          }
        }, 250);
        globalThis.addEventListener('pagehide', populationPageHide);
      } catch (error) {
        populationStatus = 'error'; populationError = error instanceof Error ? error.message : 'Population save could not be read.';
        reportPopulation(); return;
      }
    }
    if (!modelAssembled || !model) { populationStatus = 'waiting-model'; reportPopulation(); return; }
    if (!populationInput) { populationStatus = 'not-configured'; reportPopulation(); return; }
    if (population || populationAbort || populationStatus === 'error') return;
    const source = model, store = populationStore, entry = populationEntry, input = populationInput;
    const owner = new AbortController(); populationAbort = owner; populationStatus = 'loading'; reportPopulation();
    const current = () => !disposed && !owner.signal.aborted && populationEntry === entry && populationStore === store && model === source;
    let view: EaldholtVillagePopulationView | null = null;
    try {
      tracePopulation('site-fetch');
      const raw = await loadEaldholtPopulationSite(input, owner.signal); if (!current()) return;
      tracePopulation('site-parse');
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('Population site must be a data record.');
      const data = raw as Record<string, unknown>;
      const originalSite = createEaldholtVillageSite({ profile: input.profile, modelSha256: input.source.sha256,
        binding: data.binding, certificate: data.certificate,
        placeBindings: data.placeBindings as VillageSiteOptions['placeBindings'],
        residentPlaceBindings: data.residentPlaceBindings as VillageSiteOptions['residentPlaceBindings'] });
      const site = applyVillageSiteRigidClearance(originalSite, validateVillageSiteRigidClearance(originalSite, data.rigidSourceClearance));
      const workplaceAnchors: Record<string, { readonly position: readonly [number, number, number]; readonly yawRadians: number }> = {};
      for (const row of validateVillageSiteWorkplaceAnchors(site, data.workplaceAnchors ?? [])) {
        if (getHouseholdArtSet(row.residentId)?.workPlaceId === row.placeId) {
          workplaceAnchors[row.residentId] = { position: row.sourceGroundPoint, yawRadians: row.yawRadians };
        }
      }
      const motionEvidence = data.motionEvidence === undefined ? null : parsePopulationMotionEvidence(data.motionEvidence);
      tracePopulation('site-and-motion-validated');
      // Bootstrap observation may have started while source data was loading.
      // Its unbound provenance must not seed a persisted disaster checkpoint.
      // Discard only that transient branch, then reobserve the SAME requested
      // clock from the newly source-bound canonical snapshot. A supplied saved
      // composite remains owned by its coordinator and is never cleared here.
      populationObservationPump.clear();observedSnapshot=null;observationDemand.cancel();
      store.attachSite(site);const sourceBoundSnapshot=store.advance();populationSite=site;
      updateObserved(sourceBoundSnapshot);
      view = createEaldholtVillagePopulationView({ camera, sourceRoot: source,
        viewportHeight: () => Math.max(1, options.host.clientHeight),
        renderFrame: () => renderer.info.render.frame,
        readFollowedResidentId: () => followId,
        onPresentationChanged: requestRender,
        root: new URL('assets/legacy/environment/aethelgard/characters/', new URL(import.meta.env.BASE_URL, document.baseURI)).href,
        integritySha256: EALDHOLT_POPULATION_ASSET_SHA256, site, motionEvidence, workplaceAnchors,
        sourceIdentity: {profile: input.profile, sha256: input.source.sha256},
        readFrame: () => { const snapshot = observed(store.getSnapshot()), sample = sampleVillagePopulationRuntime(snapshot, populationSite??site); lastFrameSample = sample;
          return { sample, clockSeconds: snapshot.clock.simulatedElapsedMilliseconds / 1000, paused: observer?.speed?.() === 0, animationRate: observer?.speed?.() ?? 1 }; },
        onError: (id, error) => { if (current()) { populationError = `${id}: ${error instanceof Error ? error.message : String(error)}`; reportPopulation(); } },
      });
      tracePopulation('presenters-created');
      if (!current()) { view.dispose(); return; }
      population = view; populationSite = site; source.add(view.object); view.setActive(active);
      tracePopulation('presentation-active');
      // Population meshes are not owned by the static environment shadow
      // caster set. Adding its empty/loading group must not rebake that map.
      populationStatus = 'ready'; reportPopulation();
      // Source qualification happens before any disaster snapshot can be adopted.
      // Equipment loading creates no actor, arrival, duty or work credit.
      try {
        const equipment=await view.loadEmergencyWorkpieceTemplate('ealdholt-master-mason');
        if(!current()||population!==view)return;
        const buildings=buildingDamageVisuals?.buildings()??[];
        if(!buildings.length)throw Error('The verified building catalogue is not ready.');
        const helper=await createBuildingEmergencySitesAsync({sourceRoot:source,sourceSha256:input.source.sha256,profile:input.profile,
          site,siteIdentity:input.site.sha256,sourceMetadata:data,motionEvidence,buildings,
          repairEquipment:equipment?[equipment]:[],workpieceFor:id=>view?.emergencyWorkpieceFor(id)??null},{signal:owner.signal});
        if(!current()||population!==view){helper.dispose();return;}
        releaseEmergencySites();emergencySites=helper;populationSite=helper.site;view.setEmergencySite(helper.site);
        emergencyActionVisuals=createEmergencyActionVisuals({maxResidents:12});source.add(emergencyActionVisuals.object);
        options.host.dataset.buildingEmergencySites=JSON.stringify(helper.diagnostics);requestRender();
        try{
          const prepared=await prepareVillageWorkplaces({sites:helper,siteIdentity:input.site.sha256,sourceRoot:source,loader:createDefaultCrowdLoader(),characterAssetRoot:new URL('assets/legacy/environment/aethelgard/characters/',new URL(import.meta.env.BASE_URL,document.baseURI)).href,signal:owner.signal});
          if(!current()||population!==view){prepared?.dispose();return;}
          if(prepared){workplaces=prepared;populationSite=prepared.site;view.setWorkplaceSite(prepared.site);source.add(prepared.object);options.host.dataset.ordinaryWorkplaces=JSON.stringify(prepared.diagnostics);populationObservationPump.clear();observedSnapshot=null;requestRender();}
        }catch(error){if(current())options.host.dataset.ordinaryWorkplaces=JSON.stringify({status:'held',error:error instanceof Error?error.message:String(error)});}
      }catch(error){if(current())options.host.dataset.buildingEmergencySites=JSON.stringify({status:'held',error:error instanceof Error?error.message:String(error)});}
    } catch (error) {
      view?.dispose(); if (current()) { store.attachSite(null); populationStatus = 'error'; populationError = error instanceof Error ? error.message : 'Population site failed.'; reportPopulation(); }
    } finally { if (populationAbort === owner) populationAbort = null; }
  }
  let frame = 0;
  let lastFrame = 0;
  let dirty = true;
  /** Camera motion (drag, wheel, damping, keyboard orbit) runs at the player's frame limit, not the ambient 30 Hz. */
  let cameraMovedAt = -Infinity, cameraDragging = false;
  /** A throw anywhere in a frame stops the loop and shows the error panel instead of freezing silently. */
  const frameGuard = createVillageFrameGuard(renderFrame, error => {
    if (frame) { cancelAnimationFrame(frame); frame = 0; }
    options.host.dataset.worldFrameError = error instanceof Error ? error.message : String(error);
    console.error('Ealdholt village frame failed.', error);
    if (!disposed) options.onError();
  });
  /** DEV only: set while the House Ealdholt opening film is being shot through this view (see filmHook below). The
   * film keeps three clocks apart: the sky's hour (sun, light, lamps), the animation seconds (wind, cloud, water,
   * fire, the villagers' steps) and the villagers' place in their day (the observer link). */
  let filmShot: { link: VillageObserverLink; skyMinute: number; seconds: number; population: number | null; resident: number | null } | null = null;
  function filmClockReading() {
    const shot = filmShot!, whole = Math.floor(shot.skyMinute);
    return { time: Object.freeze({ absoluteWorldMinute: whole, dayIndex: Math.floor(whole / 1440), dayMinute: whole % 1440,
      fractionalMinute: shot.skyMinute - whole, elapsedWorldMinutes: shot.skyMinute, deferredMilliseconds: 0 }),
      worldKey: populationEntry ?? 'ealdholt-film', animationSeconds: shot.seconds };
  }
  /** Animation time since the last draw of this kind, from the film's seconds: a frame redrawn while it settles adds none. */
  function filmDelta(kind: 'population' | 'resident'): number {
    const shot = filmShot!, last = shot[kind]; shot[kind] = shot.seconds;
    return last === null ? 0 : Math.min(.1, Math.max(0, shot.seconds - last));
  }
  let renders = 0;
  let readyPending = false;
  let fire: EaldholtVillageFire | null = null;
  let nightLights: VillageNightLights | null = null;
  let buildingDisasterEffects:BuildingDisasterEffects|null=null;
  let buildingDamageVisuals:BuildingDamageVisuals|null=null;
  let buildingRetirement:Promise<void>=Promise.resolve(),sourceRetirement:Promise<void>=Promise.resolve();
  const extinguishedAt=(p:readonly[number,number,number])=>buildingDamageVisuals?.containsSourcePoint(p)??false;
  function releaseBuildingDamage(){
    releaseEmergencySites();buildingDisasterEffects?.dispose();buildingDisasterEffects=null;
    const owner=buildingDamageVisuals;buildingDamageVisuals=null;if(!owner)return;owner.dispose();
    buildingRetirement=Promise.all([buildingRetirement,owner.whenRetired]).then(()=>{
      if(owner.stats.retirement!=='retired')throw Error('Building resources remain held by a later owner.');
    });void buildingRetirement.catch(()=>{options.host.dataset.buildingDamageRetirement='held-error';});
  }
  function retireSourceModel(root:Object3D){
    sourceRetirement=Promise.all([sourceRetirement,buildingRetirement]).then(()=>disposeModel(root));
    void sourceRetirement.catch(()=>{options.host.dataset.buildingDamageRetirement='held-error';});
  }
  let gardenPlanting:ReturnType<typeof createEaldholtGardenPlanting>|null=null;
  let gardenLife:ReturnType<typeof createEaldholtGardenLife>|null=null;
  let gardenSound:ReturnType<typeof createGardenSoundscape>|null=null;
  let gardenAudioOutput:MenuEffectsOutput|null=null;
  const gardenEye=new Vector3();
  function releaseGarden(){gardenSound?.dispose();gardenSound=null;gardenAudioOutput=null;gardenLife?.dispose();gardenLife=null;gardenPlanting?.dispose();gardenPlanting=null;}
  function updateGarden(){
    const state=worldEnvironment?.state;
    if(!state||!gardenPlanting?.anchor)return;
    const seconds=worldEnvironment?.animationSeconds??fireTime,worldPaused=observer?.speed?.()===0;
    gardenPlanting.update(seconds,!reducedMotion&&!worldPaused,{direction:state.wind,strength:state.windStrength});
    camera.getWorldPosition(gardenEye);model?.worldToLocal(gardenEye);
    const nearWater=Math.exp(-Math.hypot(gardenEye.x-gardenPlanting.anchor[0],gardenEye.z-gardenPlanting.anchor[2])/35);
    const frame={nearWater,animationSeconds:seconds,daylight:state.daylight,wind:state.wind,windStrength:state.windStrength,rain:state.rain,reducedMotion,active,paused:!active||worldPaused};
    gardenLife?.update(frame);
    const output=options.audioOutput?.()??null;
    if(output?.context!==gardenAudioOutput?.context||output?.destination!==gardenAudioOutput?.destination){
      gardenSound?.dispose();gardenSound=null;gardenAudioOutput=output;
      if(output){try{gardenSound=createGardenSoundscape(output.context,{destination:output.destination});gardenSound.setEnabled(true);}catch{gardenAudioOutput=null;}}
    }
    gardenSound?.setActive(active&&!worldPaused);gardenSound?.update(frame);
    if(gardenLife)options.host.dataset.gardenLife=JSON.stringify(gardenLife.stats);
  }
  let atmosphere: EaldholtAtmosphere | null = null;
  let riverValley: EaldholtRiverValley | null = null;
  let distantCoast: EaldholtDistantCoastPreview | null = null;
  let riverInspectionBounds: EaldholtRiverValley["bounds"] | null = null;
  let woodland: EaldholtRiverWoodland | null = null;
  let bankLandform: EaldholtBankLandform | null = null;
  let coastalContinuity: EaldholtCoastalContinuity | null = null;
  let outerContinuation: EaldholtOuterContinuation | null = null;
  let farSurround: EaldholtFarSurround | null = null;
  let woodlandVisibility: EaldholtWoodlandVisibility | null = null, farWoodlandVisibility: EaldholtWoodlandVisibility | null = null;
  let treeHlod: EaldholtTreeHlod | null = null, farTreeHlod: EaldholtTreeHlod | null = null;
  let vegetationWorker: ReturnType<typeof createVegetationPreparationWorker> | null = null;
  let vegetationResources: VegetationPrototypeResources | null = null;
  const sourceVegetationHlod = new Map<Object3D, VegetationCellHlod>();
  const sourceVegetationStats = {cells: 0, ready: 0, errors: [] as string[], levels: [0, 0, 0, 0]};
  let farGrassLook: GrassGroundLook | null = null;
  let terrainStream: AuthoredTerrainStream | null = null;
  let architectureSuffix: AuthoredArchitectureSuffixVisibility | null = null;
  let voxelGI: WorldVoxelGI | null = null;
  let regionalWoodland:EaldholtRegionalWoodland|null=null;
  let regionalForest:RegionalForest|null=null,regionalLandmarks:RegionalLandmarks|null=null;
  let worldEnvironment:WorldEnvironment|null=null,worldRain:WorldRain|null=null,raidScene:RaidScene|null=null,lastEnvironmentRequest=0,regionalWorldLoading=false;
  let resolveRegionalLighting!:(forest:RegionalForest|null)=>void;
  const regionalLightingReady=new Promise<RegionalForest|null>(resolve=>{resolveRegionalLighting=resolve;});
  const regionalAssets=new Set<Object3D>();
  let regionalAssetLoader:EaldholtEnvironmentAssetLoader|null=null;
  function releaseRegionalAssets(){for(const asset of regionalAssets){const geometries=new Set<Mesh["geometry"]>(),materials=new Set<import("three").Material>(),textures=new Set<Texture>();asset.traverse(node=>{if(node instanceof Mesh){geometries.add(node.geometry);for(const material of Array.isArray(node.material)?node.material:[node.material]){materials.add(material);for(const value of Object.values(material))if(value instanceof Texture)textures.add(value);}}});for(const g of geometries)g.dispose();for(const m of materials)m.dispose();for(const t of textures)t.dispose();}regionalAssets.clear();}
  function releaseRegionalWorld(){worldRain?.dispose();worldRain=null;raidScene?.dispose();raidScene=null;villageAnchors=null;worldEnvironment?.dispose();worldEnvironment=null;releaseBuildingDamage();regionalForest?.dispose();regionalForest=null;regionalLandmarks?.dispose();regionalLandmarks=null;regionalAssetLoader?.dispose();regionalAssetLoader=null;void vegetationQueue.whenIdle().then(releaseRegionalAssets);}
  async function loadRegionalAssetFile(name:string,base=REGIONAL_ASSET_PATH,scanned=false){
    const loader=regionalAssetLoader??=createEaldholtEnvironmentAssetLoader({baseUrl:import.meta.env.BASE_URL,renderer,signal:abort.signal});
    const gltf=await loader.loadAsync(import.meta.env.BASE_URL+base+name);regionalAssets.add(gltf.scene);if(abort.signal.aborted){void vegetationQueue.whenIdle().then(releaseRegionalAssets);throw Error("Regional loading cancelled.");}if(scanned&&!scannedShrubAssetMetadataMatches((gltf.asset as {extras?:unknown}).extras))throw Error('Scanned undergrowth GLB provenance does not match its manifest.');return gltf;
  }
  const loadRegionalAsset=async(name:string,base=REGIONAL_ASSET_PATH,scanned=false)=>(await loadRegionalAssetFile(name,base,scanned)).scene;
  let regionalHorizon: ReturnType<typeof createEaldholtRegionalHorizonView> | null = null;
  let environmentFoundationsReady = false;
  function vegetationSettled(): boolean {
    for (const tree of [treeHlod, farTreeHlod]) if (tree && tree.stats.readyMask !== 15 && tree.stats.status !== 'error') return false;
    for (const cell of sourceVegetationHlod.values()) if (cell.stats.readyMask !== 15 && cell.stats.status !== 'error'
      && !(cell.stats.kind === 'grass' && farGrassLook?.stats.status === 'error')) return false;
    return true;
  }
  let preparationPump:ReturnType<typeof createWorldPreparationPump>|null=null;
  function reportPreparationPump(){
    options.host.dataset.worldPreparation=JSON.stringify(vegetationQueue.stats);
    if(preparationPump)options.host.dataset.worldPreparationPump=JSON.stringify({...preparationPump.stats,running:vegetationQueue.running,pending:vegetationQueue.pending,active,allowed:!disposed&&active&&!options.authorPondProbe&&!planarPond});
  }
  function requestPreparationFrame() {
    preparationPump?.wake();
    reportPreparationPump();
    if (!disposed && active && !frame) frame = requestAnimationFrame(render);
  }
  // A full queue holds requests instead of failing cells and terrain for good (L-25).
  const vegetationQueue = createWorldPreparationQueue(requestPreparationFrame, 64, 2 * 1024 * 1024, 4, 'wait');
  const environmentChange=createWorldEnvironmentChangeHandler({prepare:requestPreparationFrame,render:requestRender});
  let vegetationTransition = false;
  let farWoodland: EaldholtFarWoodland | null = null;
  let farWoodlandLod: EaldholtFarWoodlandLod | null = null;
  function releaseFarWoodland(): void {
    farTreeHlod?.dispose(); farTreeHlod = null;
    farWoodlandVisibility?.dispose(); farWoodlandVisibility = null;
    farWoodland?.object.removeFromParent(); farWoodland?.dispose(); farWoodland = null;
    farWoodlandLod?.dispose(); farWoodlandLod = null;
  }
  function reportFarWoodland(): void {
    const forest = farWoodland, host = options.host.dataset;
    if (!forest) return;
    host.farWoodlandInstances = String(forest.instanceCount);
    host.farWoodlandActiveActors = String(forest.activeActors);
    host.farWoodlandActiveTriangles = String(forest.activeTriangles);
    host.farWoodlandTriangles = String(forest.triangles);
    host.farWoodlandDrawCalls = String(forest.drawCalls);
    host.farWoodlandBufferBytes = String(forest.bufferBytes);
    host.farWoodlandExtraTextureBytes = String(forest.extraTextureBytes);
    host.farWoodlandBounds = JSON.stringify(forest.bounds);
    host.farWoodlandLayout = JSON.stringify({ groves: forest.layout.groves, acceptedPerGrove: forest.layout.acceptedPerGrove,
      attempted: forest.layout.attempted, rejected: forest.layout.rejected, supportTriangles: forest.layout.supportTriangles });
    host.farWoodlandPlacementProof = JSON.stringify(forest.placements);
    host.farWoodlandExistingPlacements = JSON.stringify(woodland?.placements ?? []);

    host.farWoodlandAssetSha256 = farWoodlandLod?.sha256 ?? "";
    host.farWoodlandSourceKind = farWoodlandLod?.kind ?? "";
    host.farWoodlandSourceFamily = woodland?.sourceFamily ?? "";
    host.farWoodlandTrianglesPerTree = String(farWoodlandLod?.triangles ?? 0);
    host.farWoodlandReferencedGeometryBytes = String(farWoodlandLod?.referencedGeometryBytes ?? 0);

    host.combinedExteriorWoodlandActors = String((woodland?.instanceCount ?? 0) + forest.instanceCount);
    host.combinedExteriorWoodlandTriangles = String((woodland?.triangles ?? 0) + forest.triangles);
    host.combinedExteriorWoodlandDrawCalls = String((woodland?.drawCalls ?? 0) + forest.drawCalls);
    host.combinedExteriorWoodlandScope = "generated-exterior-only-source-actors-untouched";
  }

  let farBridge: EaldholtFarSurroundBridge | null = null;
  let farProjectionPacket: EaldholtFarProjectionPacket | null = null;
  let riverMargin: EaldholtRiverMargin | null = null;
  let woodlandUnderstory: EaldholtWoodlandUnderstory | null = null;
  let foliageDensity: EaldholtFoliageDensity | null = null;
  let coverageMips: EaldholtFoliageCoverageMips | null = null;
  let neutralFill: EaldholtNeutralFill | null = null;
  let pondShore: EaldholtPondShore | null = null;
  let pondProbe: EaldholtPondProbeBinding | null = null;
  let ownedPondProbe: EaldholtOwnedPondProbe | null = null;
  let planarPond:EaldholtPlanarPond|null=null;
  let planarBlocked=false;
  const planarRedraw=createEaldholtPondRedraw(requestRender,{
    now:()=>performance.now(),set:(callback,delay)=>window.setTimeout(callback,delay),clear:token=>window.clearTimeout(token),
  });
  let waterLook: EaldholtWaterLook | null = null;
  let openWater: ReturnType<typeof createEaldholtOpenWater> | null = null;
  let groundLook: EaldholtGroundLook | null = null;
  let groundAlbedo: EaldholtGroundAlbedoDetail | null = null;
  let valleyGround: EaldholtValleyGroundSet | null = null;
  let exportRepairs: EaldholtExportRepairHandle | null = null;
  let fireTime = 0;
  let lastFireTick = 0;
  let shadowDirty = true;
  // Whether the sun's shadows are showing (the sun is up). At night they are faded out through the shadow's intensity
  // rather than by switching sun.castShadow off: toggling castShadow changes every lit material's program, which froze
  // the page for 25 s at dusk and 105 s at dawn, and at the first dawn the valley terrain's recompiled shader exceeded
  // the 16 fragment texture units of ANGLE/D3D11 and failed to link (measured 11 November 2026 with the observer's
  // time running at 16x). castShadow now follows the quality setting only.
  let sunShadowActive = true;
  const lastShadowSunDirection = new Vector3();
  let shadowSunRecorded = false;
  let shadowHalfSize = 0;
  const lastShadowFocus = new Vector3(Infinity, Infinity, Infinity);
  const plantCells: PlantCell[] = [];
  // Reused culling lists (L-27): rebuilt only when the plant cell set changes, mutated in place each frame.
  const treeCandidates: { cell: PlantCell; distance: number }[] = [];
  const groundCells: PlantCell[] = [], groundRows: { -readonly [K in keyof EaldholtGroundcoverCell]: EaldholtGroundcoverCell[K] }[] = [];
  const groundSelected = new Set<number>(), byCandidateDistance = (a: { distance: number }, b: { distance: number }) => a.distance - b.distance;
  let cullListVersion = -1, plantCellVersion = 0;
  const groundcoverProjection: { quality: 'low' | 'medium' | 'high'; projectionScaleY: number; drawBufferHeight: number; nearPlane: number } = { quality: 'medium', projectionScaleY: 1, drawBufferHeight: 1, nearPlane: .1 };
  function syncCullLists(): void {
    if (cullListVersion === plantCellVersion) return;
    cullListVersion = plantCellVersion; treeCandidates.length = groundCells.length = groundRows.length = 0;
    for (let id = 0; id < plantCells.length; id++) {
      const cell = plantCells[id];
      if (cell.kind === "tree") treeCandidates.push({ cell, distance: 0 });
      else if (cell.kind === "groundcover") {
        groundCells.push(cell);
        groundRows.push({ id, family: cell.family, inFrustum: false, nearDepth: 0, farDepth: 0, plantDiameter: cell.plantDiameter, triangles: cell.triangles, instances: cell.sourceInstances, drawCalls: cell.drawCalls });
      }
    }
  }
  const shadowMeshes: { mesh: Mesh; kind: string; box: Box3; triangles: number; distance: number }[] = [];
  const casterOrder: typeof shadowMeshes = [];
  const casterSelection = { focus: new Vector3(Number.NaN, 0, 0), half: 0, budget: 0, count: -1, version: -1, treeTriangles: 0 };
  let shadowCasterVersion = 0;
  const sourceTextures = new Set<Texture>();
  const ownedMipCanvases: HTMLCanvasElement[] = [];
  const vegetationMaps = new Map<Texture, { cutoff: number; blocked: boolean }>();
  const localPointLights: { light: PointLight; influence: Sphere; hearth: boolean; sourcePosition:readonly[number,number,number] }[] = [];
  let lightVisibilityMask = -1;
  const cullingFrustum = new Frustum();
  const cullingMatrix = new Matrix4();
  const groundcoverDrawBuffer = new Vector2(), groundcoverViewDirection = new Vector3();
  let panelMode = options.panelMode;
  let viewShift = panelMode === "village" ? 0 : panelMode === "banner" ? 0.26 : 0.19;
  const villagePosition = new Vector3().fromArray(EALDHOLT_VILLAGE_VIEWS[0].position);
  const villageTarget = new Vector3().fromArray(EALDHOLT_VILLAGE_VIEWS[0].target);
  let villageFov = Number(EALDHOLT_VILLAGE_VIEWS[0].fov);
  let selectedView: EaldholtViewId = "overview";
  let poseTransition: { fromPosition: Vector3; fromTarget: Vector3; fromShift: number; position: Vector3; target: Vector3; shift: number; start: number | null } | null = null;
  const diagnosticOffset = new Vector3();
  const diagnosticSpherical = new Spherical();
  const abort = new AbortController();
  abort.signal.addEventListener('abort',()=>resolveRegionalLighting(null),{once:true});
  const scene = new Scene();
  scene.fog = new Fog("#c8d7df", 150, 420);
  const camera = new PerspectiveCamera(45, 1, 0.15, 650);
  const woodlandCameras: Camera[] = [camera];
  // Low skips multisampling (L-22); the context attribute is fixed when the view is created.
  const renderer = new WebGLRenderer({ antialias: quality.preset !== "low", powerPreference: "high-performance" });
  const bankMaterialDiagnostics=graphicsTracing?createBankMaterialDrawDiagnostics(renderer):null;
  const drawDiagnostics=graphicsTracing?createLegacyMainPassDrawDiagnostics({renderer,scene,camera,enabled:true,observeMainDraw:material=>bankMaterialDiagnostics?.observe(material)}):null;
  let lastDrawDiagnostics='',lastBankMaterialDiagnostics='';
  const reportDrawDiagnostics=()=>{if(drawDiagnostics){lastDrawDiagnostics=JSON.stringify(drawDiagnostics.report);options.host.dataset.worldDrawAttribution=lastDrawDiagnostics;if(bankMaterialDiagnostics){lastBankMaterialDiagnostics=JSON.stringify(bankMaterialDiagnostics.report);options.host.dataset.worldBankMaterial=lastBankMaterialDiagnostics;}}};
  reportDrawDiagnostics();
  const glDiagnostics = graphicsTracing ? createWorldGlDiagnostics(renderer.getContext()) : null;
  const reportGlDiagnostics = () => {
    if (!glDiagnostics) return;
    const report = glDiagnostics.report;
    options.host.dataset.worldGlDiagnostics = JSON.stringify(report);
    options.host.dataset.worldWebglErrors = JSON.stringify(report.errors);
  };
  reportGlDiagnostics();
  const gpuFrame: ReturnType<typeof createWorldGpuFrameGate> = createWorldGpuFrameGate(renderer.getContext(), {onTerminal: event => {
    glDiagnostics?.terminal(event); reportGlDiagnostics();
    options.host.dataset.worldGpuFrame = JSON.stringify(gpuFrame.stats);
    if (event.status === 'failed') preparationPump?.pause();
    if (event.status === 'complete' && !disposed && active && dirty && !gpuFrame.terminalFailure) requestRender();
  }});
  preparationPump=createWorldPreparationPump({queue:vegetationQueue,
    allowed:()=>!disposed&&active&&!options.authorPondProbe&&!planarPond&&!gpuFrame.terminalFailure,
    changed:reportPreparationPump,
    gpuReady:()=>{const ready=gpuFrame.ready();options.host.dataset.worldGpuFrame=JSON.stringify(gpuFrame.stats);return ready;}});
  const prepareWhileGpuWaits=()=>{
    if(options.authorPondProbe||planarPond)return;
    if(population?.prepare()){dirty=true;reportPopulation();}
    worldEnvironment?.prepare(performance.now());
    if(vegetationQueue.pending)preparationPump?.wake();
  };
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.type = PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.domElement.setAttribute("aria-label", options.label);
  renderer.domElement.setAttribute("role", "img");
  options.host.appendChild(renderer.domElement);
  const panorama = daylightPanorama();
  const pmrem = new PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const environment = pmrem.fromEquirectangular(panorama);
  pmrem.dispose();
  scene.environment = environment.texture;
  scene.background = panorama;
  scene.environmentIntensity = 1;
  scene.backgroundIntensity = 1;

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(28, 3, 28);
  controls.minDistance = 1.5;
  controls.maxDistance = 220;
  controls.minPolarAngle = 0.32;
  controls.maxPolarAngle = 1.72;
  controls.enableDamping = !reducedMotion;
  controls.dampingFactor = 0.1;
  controls.panSpeed = 0.65;
  controls.rotateSpeed = 0.55;
  controls.zoomSpeed = 0.65;
  controls.enablePan = true;
  controls.enabled = false;

  const fill = new HemisphereLight(new Color().setRGB(...DAYLIGHT.hemisphereSkyLinear), DAYLIGHT.hemisphereGround, DAYLIGHT.hemisphereIntensity);
  scene.add(fill);
  const sun = new DirectionalLight(DAYLIGHT.sunColor, DAYLIGHT.sunIntensity);
  const daylightOffset = new Vector3(...DAYLIGHT.sunOffset);
  sun.target.position.set(...DAYLIGHT.sourceTarget);
  sun.position.copy(sun.target.position).add(daylightOffset);
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -105;
  sun.shadow.camera.right = 105;
  sun.shadow.camera.top = 105;
  sun.shadow.camera.bottom = -105;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 320;
  sun.shadow.bias = -0.00015;
  sun.shadow.normalBias = 0.035;
  sun.shadow.camera.updateProjectionMatrix();
  scene.add(sun, sun.target);

  function kindOf(object: Object3D): string {
    if (object instanceof Mesh && (Array.isArray(object.material) ? object.material : [object.material])
      .some(material => material.userData.crownfallWaterLook || material.userData.crownfallRiver || /water/i.test(material.name))) return "water";
    for (let current: Object3D | null = object; current && current !== scene; current = current.parent) {
      const value = current.userData.crownfallElderbloom?.kind;
      if (typeof value === "string") return value;
    }
    if (/LandscapeComponent/.test(object.name)) return "terrain";
    if (/Grass|flower|vmcob/i.test(object.name)) return "groundcover";
    if (/BlackAlder|tree|canopy/i.test(object.name)) return "tree";
    return "architecture";
  }

  function collectModel(): void {
    if (!model) return;
    model.updateMatrixWorld(true);
    // These boxes belong to this collection pass. Never populate or rewrite a
    // borrowed geometry.boundingBox just to derive the plant-size proxy.
    const prototypeBounds = new WeakMap<Mesh["geometry"], Box3>();
    const point = new Vector3(), size = new Vector3(), actor = new Matrix4(), worldActor = new Matrix4(), actorBox = new Box3();
    model.traverse(object => {
      const meta = object.userData.crownfallElderbloom;
      const sourceKind = identifySourceVegetation(object.name, object.userData, object.parent === model);
      if (sourceKind) {
        let triangles = 0, drawCalls = 0;
        const sourceCounts = new Set<number>();
        const plantDiameters: number[] = [];
        object.traverse(child => {
          if (!(child instanceof Mesh)) return;
          const childTriangles = meshTriangles(child);
          triangles += childTriangles;
          sourceCounts.add(child instanceof InstancedMesh ? child.count : 1);
          if (sourceKind !== "groundcover" || !childTriangles) return;
          drawCalls += Array.isArray(child.material) ? Math.max(1, child.geometry.groups.length) : 1;
          const cachedBounds = prototypeBounds.get(child.geometry), localBounds = cachedBounds ?? new Box3();
          if (!cachedBounds) {
            if (child.geometry.boundingBox) localBounds.copy(child.geometry.boundingBox);
            if (localBounds.isEmpty()) {
              const positions = child.geometry.getAttribute("position");
              if (!positions) return;
              for (let i = 0; i < positions.count; i++) localBounds.expandByPoint(point.fromBufferAttribute(positions, i));
            }
            prototypeBounds.set(child.geometry, localBounds);
          }
          const actors = child instanceof InstancedMesh ? child.count : 1;
          for (let i = 0; i < actors; i++) {
            if (child instanceof InstancedMesh) child.getMatrixAt(i, actor); else actor.identity();
            worldActor.multiplyMatrices(child.matrixWorld, actor);
            actorBox.copy(localBounds).applyMatrix4(worldActor);
            plantDiameters.push(actorBox.getSize(size).length());
          }
        });
        const box = new Box3().setFromObject(object);
        plantCellVersion++; plantCells.push({ object, kind: sourceKind, box, triangles, sourceInstances: Number(meta?.sourceInstances) || (sourceCounts.size === 1 ? sourceCounts.values().next().value! : 0),
          family: object.name.replace(/_cell_.*$/, "") || "source-groundcover",
          plantDiameter: ealdholtRepresentativePlantDiameter(plantDiameters), drawCalls,
          center: box.getCenter(new Vector3()), halfSize: box.getSize(new Vector3()).multiplyScalar(.5) });
      }
      if (!(object instanceof Mesh) || object.userData.crownfallFarSurround?.schema === 1) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      const kind = kindOf(object);
      shadowMeshes.push({ mesh: object, kind, box: new Box3().setFromObject(object), triangles: meshTriangles(object), distance: 0 }); shadowCasterVersion++;
      let namedVegetation = kind === "tree";
      for (let current: Object3D | null = object; !namedVegetation && current && current !== model; current = current.parent) {
        namedVegetation = kind === "groundcover" && /Grass|flower/i.test(current.name);
      }
      for (const material of materials) {
        for (const value of Object.values(material)) if (value instanceof Texture) sourceTextures.add(value);
        const map: unknown = Reflect.get(material, "map");
        if (!(map instanceof Texture)) continue;
        const previous = vegetationMaps.get(map);
        const eligible = namedVegetation && material.alphaTest > 0 && material.alphaTest <= 1 && !material.transparent && material.opacity === 1;
        vegetationMaps.set(map, { cutoff: material.alphaTest,
          blocked: !eligible || !!previous?.blocked || (previous !== undefined && previous.cutoff !== material.alphaTest) });
      }
    });
    options.host.dataset.plantCellCount = String(plantCells.length);
  }

  function prepareVegetationMips(): void {
    const started = performance.now();
    let totalBytes = 0, skipped = 0;
    const report: { map: string; width: number; height: number; cutoff: number; target: number;
      levels: { level: number; width: number; height: number; scale: number; coverage: number; uncorrected: number; error: number }[] }[] = [];
    for (const [texture, policy] of vegetationMaps) {
      // Atlas transforms that select a small subregion need a chart-specific
      // audit. Whole-image coverage is valid only for ordinary/repaired maps.
      const validTransform = Math.abs(texture.repeat.x - 1) <= .1 && Math.abs(texture.repeat.y - 1) <= .1
        && Math.abs(texture.offset.x) <= .1 && Math.abs(texture.offset.y) <= .1 && Math.abs(texture.rotation) < 1e-6;
      const image: unknown = texture.image;
      if (policy.blocked || !validTransform || !image || !(typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap
        || image instanceof HTMLImageElement || image instanceof HTMLCanvasElement)) { skipped++; continue; }
      let width = image.width, height = image.height;
      if (width < 1 || height < 1 || width > 4096 || height > 4096) { skipped++; continue; }
      let uncorrected = document.createElement("canvas");
      uncorrected.width = width; uncorrected.height = height;
      const baseContext = uncorrected.getContext("2d", { willReadFrequently: true });
      if (!baseContext) { skipped++; continue; }
      baseContext.drawImage(image, 0, 0);
      const target = alphaCoverage(baseContext.getImageData(0, 0, width, height).data, policy.cutoff);
      const row = { map: texture.name || texture.uuid, width, height, cutoff: policy.cutoff, target,
        levels: [] as { level: number; width: number; height: number; scale: number; coverage: number; uncorrected: number; error: number }[] };
      // Keep the exact original bitmap at level zero. Corrected mip alpha must
      // not feed the next filter: each next level uses ordinary filtered data.
      const mipmaps: (ImageBitmap | HTMLImageElement | HTMLCanvasElement)[] = [image];
      let level = 0;
      while (width > 1 || height > 1) {
        width = Math.max(1, Math.floor(width / 2)); height = Math.max(1, Math.floor(height / 2)); level++;
        const filtered = document.createElement("canvas"); filtered.width = width; filtered.height = height;
        const context = filtered.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("Vegetation mip filtering could not be prepared.");
        context.drawImage(uncorrected, 0, 0, width, height);
        const pixels = context.getImageData(0, 0, width, height);
        const result = preserveAlphaCoverage(pixels.data, policy.cutoff, target);
        const corrected = document.createElement("canvas"); corrected.width = width; corrected.height = height;
        const correctedContext = corrected.getContext("2d");
        if (!correctedContext) throw new Error("Vegetation mip coverage could not be prepared.");
        pixels.data.set(result.pixels); correctedContext.putImageData(pixels, 0, 0);
        mipmaps.push(corrected); ownedMipCanvases.push(corrected); totalBytes += width * height * 4;
        row.levels.push({ level, width, height, scale: Number(result.scale.toFixed(5)), coverage: Number(result.coverage.toFixed(6)),
          uncorrected: Number(result.uncorrectedCoverage.toFixed(6)), error: Number(result.absoluteError.toFixed(6)) });
        uncorrected.width = 0; uncorrected.height = 0; uncorrected = filtered;
      }
      uncorrected.width = 0; uncorrected.height = 0;
      // Three supports DOM image mip arrays; its declaration currently lists
      // Canvas alone, although its WebGL upload accepts the original Bitmap.
      texture.mipmaps = mipmaps as Texture["mipmaps"];
      texture.generateMipmaps = false;
      texture.needsUpdate = true;
      report.push(row);
    }
    options.host.dataset.alphaMipTextureCount = String(report.length);
    options.host.dataset.alphaMipSkipped = String(skipped);
    options.host.dataset.alphaMipCpuMs = (performance.now() - started).toFixed(2);
    options.host.dataset.alphaMipCanvasBytes = String(totalBytes);
    options.host.dataset.alphaMipCoverage = JSON.stringify(report);
  }

  function releaseMipCanvases(): void {
    for (const canvas of ownedMipCanvases) { canvas.width = 0; canvas.height = 0; }
    ownedMipCanvases.length = 0; vegetationMaps.clear();
  }

  function cullPlants(): void {
    if (!plantCells.length) return;
    camera.updateMatrixWorld();
    cullingMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    cullingFrustum.setFromProjectionMatrix(cullingMatrix);
    const near = camera.position.distanceTo(controls.target) < 50;
    const treeBudget = ealdholtPlantTriangleBudget("trees", quality.preset); // from the performance table (L-12)
    let treeTriangles = 0, trees = 0;
    syncCullLists();
    for (const candidate of treeCandidates) candidate.distance = candidate.cell.box.distanceToPoint(camera.position);
    treeCandidates.sort(byCandidateDistance);
    for (const { cell, distance } of treeCandidates) {
      const inView = cullingFrustum.intersectsBox(cell.box);
      // Keep the existing tree range, budget and shadow-neighbour policy.
      const range = sourceVegetationHlod.get(cell.object)?.stats.readyMask === 15 ? 1000 : near ? 180 : 260;
      const nearbyShadow = quality.preset !== "low" && cell.box.distanceToPoint(controls.target) < 52;
      const cost = sourceVegetationHlod.get(cell.object)?.triangleCost ?? cell.triangles;
      cell.object.visible = (inView || nearbyShadow) && distance <= range && treeTriangles + cost <= treeBudget;
      if (cell.object.visible) { treeTriangles += cost; if (inView) trees += cell.sourceInstances; }
    }
    renderer.getDrawingBufferSize(groundcoverDrawBuffer);
    camera.getWorldDirection(groundcoverViewDirection);
    const forward = groundcoverViewDirection;
    for (let i = 0; i < groundCells.length; i++) {
      const cell = groundCells[i], row = groundRows[i];
      const depth = (cell.center.x - camera.position.x) * forward.x + (cell.center.y - camera.position.y) * forward.y
        + (cell.center.z - camera.position.z) * forward.z;
      const depthRadius = Math.abs(forward.x) * cell.halfSize.x + Math.abs(forward.y) * cell.halfSize.y + Math.abs(forward.z) * cell.halfSize.z;
      row.inFrustum = cullingFrustum.intersectsBox(cell.box); row.nearDepth = depth - depthRadius; row.farDepth = depth + depthRadius;
      row.triangles = sourceVegetationHlod.get(cell.object)?.triangleCost ?? cell.triangles;
    }
    groundcoverProjection.quality = quality.preset; groundcoverProjection.projectionScaleY = camera.projectionMatrix.elements[5];
    groundcoverProjection.drawBufferHeight = groundcoverDrawBuffer.y; groundcoverProjection.nearPlane = camera.near;
    const ground = selectEaldholtGroundcoverCells(groundRows, groundcoverProjection);
    groundSelected.clear(); for (const id of ground.selectedIds) groundSelected.add(id);
    for (let i = 0; i < groundCells.length; i++) groundCells[i].object.visible = groundSelected.has(groundRows[i].id);
    if (report.due) {
      delete options.host.dataset.groundcoverCullRadius;
      report.set('visibleTreeInstances',String(trees));
      report.set('visibleGroundcoverInstances',String(ground.selectedInstances));
      report.set('visiblePlantTriangles',String(treeTriangles + ground.selectedTriangles));
      report.set('groundcoverCullPolicy',"projected-source-plant-size-v1");
      report.set('groundcoverTriangleBudget',String(ground.triangleBudget));
      report.set('groundcoverDrawBudget',String(ground.drawBudget));
      report.set('visibleGroundcoverTriangles',String(ground.selectedTriangles));
      report.set('visibleGroundcoverDrawCalls',String(ground.selectedDrawCalls));
      report.set('groundcoverEligibleCells',String(ground.eligibleCells));
      report.set('groundcoverSelectedCells',String(ground.selectedIds.length));
      report.set('groundcoverRejectedFrustumCells',String(ground.rejectedFrustumCells));
      report.set('groundcoverRejectedDepthCells',String(ground.rejectedDepthCells));
      report.set('groundcoverRejectedSizeCells',String(ground.rejectedSizeCells));
      report.set('groundcoverRejectedInvalidCells',String(ground.rejectedInvalidCells));
      report.set('groundcoverRejectedBudgetCells',String(ground.rejectedBudgetCells));
      report.set('groundcoverRejectedTriangleBudgetCells',String(ground.rejectedTriangleBudgetCells));
      report.set('groundcoverRejectedDrawBudgetCells',String(ground.rejectedDrawBudgetCells));
      report.set('groundcoverFamilyReserveCells',String(ground.reservedCells));
      report.set('groundcoverFamilyReserveTriangles',String(ground.reservedTriangles));
      report.set('groundcoverFamilyReserveDrawCalls',String(ground.reservedDrawCalls));
      report.set('groundcoverMinimumPixelDiameter',String(ground.minimumPixelDiameter));
      report.set('groundcoverDrawBufferHeight',String(groundcoverDrawBuffer.y));
      report.set('groundcoverSelectedPixelDiameterRange',JSON.stringify([ground.minimumSelectedPixelDiameter, ground.maximumSelectedPixelDiameter]));
      report.set('groundcoverFamilySelection',JSON.stringify(ground.families));
    }
  }

  function updateShadows(force = false): void {
    if (!model || !sun.castShadow || !sunShadowActive) return;
    const distance = camera.position.distanceTo(controls.target);
    const half = distance < 18 ? 16 : distance < 35 ? 24 : distance < 60 ? 36 : 72;
    if (!force && !shadowDirty && half === shadowHalfSize && lastShadowFocus.distanceToSquared(controls.target) < 16) return;
    // Refocus once after a presentation move, not on every animation frame.
    if (poseTransition && !force) return;
    shadowHalfSize = half;
    lastShadowFocus.copy(controls.target);
    sun.target.position.copy(controls.target);
    sun.position.copy(controls.target).add(daylightOffset);
    sun.shadow.camera.left = -half; sun.shadow.camera.right = half;
    sun.shadow.camera.top = half; sun.shadow.camera.bottom = -half;
    sun.shadow.normalBias = half < 40 ? .008 : .03;
    sun.shadow.bias = half < 40 ? -.000015 : -.00004;
    sun.shadow.camera.updateProjectionMatrix();
    const treeBudget = quality.preset === "high" ? 1_500_000 : 350_000;
    // A sun move alone keeps the casters: select (and sort) again only when the
    // focus, the map size, the budget or the caster set changed (audit L-13).
    if (!casterSelection.focus.equals(controls.target) || casterSelection.half !== half || casterSelection.budget !== treeBudget
      || casterSelection.count !== shadowMeshes.length || casterSelection.version !== shadowCasterVersion) {
      let treeTriangles = 0;
      const target = controls.target;
      for (const candidate of shadowMeshes) candidate.distance = candidate.box.distanceToPoint(target);
      casterOrder.length = 0; for (const candidate of shadowMeshes) casterOrder.push(candidate);
      casterOrder.sort((a, b) => a.distance - b.distance);
      for (const candidate of casterOrder) {
        const radius = candidate.distance;
        if (candidate.kind === "tree") {
          candidate.mesh.castShadow = radius < half + 16 && treeTriangles + candidate.triangles <= treeBudget;
          if (candidate.mesh.castShadow) treeTriangles += candidate.triangles;
        } else candidate.mesh.castShadow = candidate.kind !== "terrain" && candidate.kind !== "groundcover" && candidate.kind !== "water" && radius < half + 10;
      }
      casterSelection.focus.copy(target); casterSelection.half = half; casterSelection.budget = treeBudget;
      casterSelection.count = shadowMeshes.length; casterSelection.version = shadowCasterVersion; casterSelection.treeTriangles = treeTriangles;
    }
    const treeTriangles = casterSelection.treeTriangles;
    renderer.shadowMap.needsUpdate = true;
    lastShadowSunDirection.copy(daylightOffset).normalize(); shadowSunRecorded = true;
    shadowDirty = false;
    options.host.dataset.shadowHalfSize = String(half);
    options.host.dataset.shadowTreeTriangles = String(treeTriangles);
    options.host.dataset.daylightSunOffset = JSON.stringify(daylightOffset.toArray());
    options.host.dataset.daylightSunIntensity = String(sun.intensity);
    options.host.dataset.daylightShadowPolicy = "existing-focused-budget";
  }

  function updateLocalLights(): void {
    if (!localPointLights.length) return;
    camera.updateMatrixWorld();
    cullingMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    cullingFrustum.setFromProjectionMatrix(cullingMatrix);
    const inspection = camera.position.distanceToSquared(controls.target) < 55 * 55;
    let count = 0, mask = 0;
    for (let index = 0; index < localPointLights.length; index++) {
      const entry = localPointLights[index];
      // A hearth's 4m fill or source smithy's 23m influence contributes no
      // useful detail to the ~100m overview. Close observers retain only
      // lights whose actual influence overlaps the visible inspection area.
      const visible = !extinguishedAt(entry.sourcePosition) && quality.preset !== 'low' && inspection && (!entry.hearth || quality.preset === "high")
        && entry.influence.distanceToPoint(camera.position) <= 18
        && entry.influence.distanceToPoint(controls.target) <= 4
        && cullingFrustum.intersectsSphere(entry.influence);
      if (entry.light.visible !== visible) entry.light.visible = visible;
      if (visible) { count++; mask |= 1 << index; }
    }
    if (mask !== lightVisibilityMask) {
      lightVisibilityMask = mask;
      options.host.dataset.localPointLightCount = String(count);
      options.host.dataset.localPointLightMask = String(mask);
    }
  }

  function requestRender(): void {
    dirty = true;
    if (!disposed && active && !frame && !frameGuard.failed) frame = requestAnimationFrame(render);
  }
  function cameraChanged(): void { cameraMovedAt = performance.now(); requestRender(); }
  /** Lets the page paint and handle input between world-assembly steps (L-24); a disposed view stops there. */
  async function yieldAssembly(): Promise<void> {
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    if (disposed) throw new DOMException('Village view disposed during assembly.', 'AbortError');
    abort.signal.throwIfAborted();
  }
  function cameraDragStarted(): void { cameraDragging = true; cameraChanged(); }
  function cameraDragEnded(): void { cameraDragging = false; cameraChanged(); }

  function render(now: number): void {
    frame = 0;
    frameGuard.run(now);
  }

  function renderFrame(now: number): void {
    if (disposed || !active) return;
    report.begin(now);
    const gpuReady = gpuFrame.ready(prepareWhileGpuWaits);
    report.due&&report.set('worldGpuFrame',JSON.stringify(gpuFrame.stats));
    if (!gpuReady) { if(gpuFrame.stats.pending&&!observationDemand.holding&&!frame)frame = requestAnimationFrame(render); return; }
    // Clock-free preparation may publish a real visible material or the final
    // settled graph even during an observer backlog. Those explicit wakes set
    // dirty; metadata-only progress remains a completion-only service turn.
    if(modelPresented&&worldEnvironment?.prepare(now))report.set('worldEnvironment',JSON.stringify(worldEnvironment.stats));
    // A completion-only poll must not turn an advancing forecast's sunlight
    // into another automatic heavy draw. Real input/preparation dirtiness wins.
    if (!observationDemand.allowCompletionPollDraw(dirty)) return;
    // Verified GLBs may still be awaiting browser image decoding after the
    // previous large world submission. Keep that completed frame on screen
    // briefly instead of immediately saturating the GPU again.
    if(population){
      if(population.prepare())dirty=true;
      const residentState=population.snapshot;
      const defer=populationPreparation.defer(now,{selected:residentState.selected,
        ready:residentState.crowd.ready+residentState.household.ready,
        loading:residentState.crowd.loading+residentState.household.loading});
      report.set('populationPreparation',populationPreparation.status);
      if(defer){reportPopulation();if(!frame)frame=requestAnimationFrame(render);return;}
    }
    // Asset/worker callbacks can request a frame after the raw GLB is attached
    // but before its quality and HLOD owners exist. Never submit that entire
    // unprepared source scene; continue uploads and the existing loading UI.
    if(model&&!modelAssembled&&!modelPresented){
      report.set('initialWoodlandPreparation','assembling');
      preparationPump?.step();report.due&&report.set('worldPreparation',JSON.stringify(vegetationQueue.stats));
      if(!frame)frame=requestAnimationFrame(render);return;
    }
    if(modelAssembled&&sourceProfile==='desktop'&&!options.authorPondProbe){
      const authored=function*(){for(const cell of sourceVegetationHlod.values())yield cell.stats;};
      const regionalReady=(regionalWoodland?.preparationReady??true)&&!regionalWorldLoading&&(regionalForest?.preparationReady??true);
      const readiness=initialWoodlandReadiness([treeHlod?.stats??null,farTreeHlod?.stats??null],authored(),regionalReady,worldEnvironment?.stats);
      // Complete tree captures still protect the first draw from submitting
      // the unbounded raw forest. Weather/GI owners retain usable PBR until
      // each replacement is ready, so background shader work cannot hide the
      // village or prevent resident animation from receiving its first frame.
      if(!modelPresented&&readiness.drawable){updateLocalLights();worldEnvironment?.prepare(now,true);}
      // Forced preparation may have admitted a new bounded material cohort.
      // A usable regional fallback also must not claim successful full prep.
      const materials=worldEnvironment?.stats;
      const regionalDegraded=!!regionalWoodland?.stats.error||!!regionalForest?.stats.error
        ||!!regionalForest?.stats.canopyError||regionalForest?.stats.canopyPreparation==='failed';
      const preparation=readiness.prepared&&!regionalDegraded&&!materials?.materialGraphPending
        &&(materials?.materialProgramsPending??0)===0?'ready':'preparing';
      const drawable=String(readiness.drawable),pending=String(materials?.materialProgramsPending??0);
      if(options.host.dataset.initialWoodlandDrawable!==drawable)options.host.dataset.initialWoodlandDrawable=drawable;
      if(options.host.dataset.initialWoodlandPreparation!==preparation)options.host.dataset.initialWoodlandPreparation=preparation;
      if(options.host.dataset.initialMaterialProgramsPending!==pending)options.host.dataset.initialMaterialProgramsPending=pending;
      if(!modelPresented){
        const authoredTrees={total:0,ready:0,pending:0,failed:0,details:[] as {name:string;readyMask:number;status:string;error:string}[]};
        for(const [object,cell]of sourceVegetationHlod){
          const state=cell.stats;if(state.kind!=='tree')continue;authoredTrees.total++;
          if(state.status==='error')authoredTrees.failed++;else if(state.readyMask===15)authoredTrees.ready++;else{
            authoredTrees.pending++;
            if(authoredTrees.details.length<8)authoredTrees.details.push({name:object.name.slice(0,128),readyMask:state.readyMask,status:state.status,error:state.error.slice(0,160)});
          }
        }
        const treeState=(state:EaldholtTreeHlod['stats']|undefined)=>state?{readyMask:state.readyMask,status:state.status,error:state.error.slice(0,160)}:null;
        options.host.dataset.initialWoodlandOwners=JSON.stringify({generated:{near:treeState(treeHlod?.stats),far:treeState(farTreeHlod?.stats)},authoredTrees,
          regional:{loading:regionalWorldLoading,woodland:regionalWoodland?{ready:regionalWoodland.preparationReady,status:regionalWoodland.stats.status,reportedReadyMask:regionalWoodland.stats.readyMask,error:regionalWoodland.stats.error.slice(0,160)}:null,
            forest:regionalForest?{ready:regionalForest.preparationReady,status:regionalForest.stats.status,readyPrototypes:regionalForest.stats.readyPrototypes,readyCanopies:regionalForest.stats.readyCanopies,canopyPreparation:regionalForest.stats.canopyPreparation,error:regionalForest.stats.error.slice(0,160),canopyError:regionalForest.stats.canopyError.slice(0,160)}:null},
          queue:{pending:vegetationQueue.stats.pending,running:vegetationQueue.running,completed:vegetationQueue.stats.completed,failed:vegetationQueue.stats.failed}});
      }
      if(!modelPresented&&options.onProgress){
        if(readiness.drawable){
          const warm=worldEnvironment?.stats,slots=warm?.activeWindMaterialSlots??0,cohort=warm?.colourPublicationLimit??0;
          reportStage('warmup',warm&&slots>0?.5*Math.min(1,cohort>0?warm.windProgramsReady/cohort:0)+.5*warm.activeWindReadyMaterialSlots/slots:null);
        }else reportStage('assembly',initialWoodlandProgress([treeHlod?.stats??null,farTreeHlod?.stats??null],authored(),regionalReady));
      }
      if(!modelPresented&&!readiness.drawable){
        preparationPump?.step();report.due&&report.set('worldPreparation',JSON.stringify(vegetationQueue.stats));
        if(treeHlod)report.due&&report.set('treeHlod',JSON.stringify(treeHlod.stats));
        if(farTreeHlod)report.due&&report.set('farTreeHlod',JSON.stringify(farTreeHlod.stats));
        if(!frame)frame=requestAnimationFrame(render);return;
      }
    }
    const animateGarden=Boolean(gardenLife?.stats.needsAnimation)&&!reducedMotion;
    const animateFire = fire !== null && !reducedMotion && (observer?.speed?.() ?? 1) !== 0;
    const animateRaid = !!raidScene?.active && !reducedMotion;
    const animateResident = residentPreview !== null && !reducedMotion;
    const animatePopulation = population !== null && !reducedMotion;
    const movingWorld = animateFire || animatePopulation || animateGarden;
    const cameraMoving = cameraDragging || poseTransition !== null || followId !== null || now - cameraMovedAt < VILLAGE_CAMERA_SETTLE_MS;
    const interval = villageFrameInterval(villageFrameLimit({ frameLimit: quality.frameLimit ?? 0, ambientAnimation: movingWorld, cameraMoving }));
    if (now - lastFrame < interval) { if(!frame)frame = requestAnimationFrame(render); return; }
    const transitioning = poseTransition !== null;
    if (poseTransition) {
      poseTransition.start ??= now;
      const fraction = Math.min(1, (now - poseTransition.start) / 480);
      const eased = fraction * fraction * (3 - 2 * fraction);
      camera.position.lerpVectors(poseTransition.fromPosition, poseTransition.position, eased);
      controls.target.lerpVectors(poseTransition.fromTarget, poseTransition.target, eased);
      viewShift = poseTransition.fromShift + (poseTransition.shift - poseTransition.fromShift) * eased;
      updateProjection();
      if (fraction === 1) { poseTransition = null; controls.enableDamping = !reducedMotion; }
    }
    if (followId && model) {
      const availability = population?.residentAvailability(followId) ?? null;
      const point = qualifiedResidentFollowPosition(availability);
      if (point) {
        model.localToWorld(followPoint.set(point[0], point[1] + 1, point[2]));
        updateResidentFollowCamera(camera.position, controls.target, followPoint, availability,
          lastFrame ? Math.max(0, (now - lastFrame) / 1000) : 0, reducedMotion);
      }
    }
    // The film places the camera itself; the player's orbit limits do not apply to it.
    const changed = filmShot ? false : controls.update();
    if (!filmShot) {
      controls.target.x = Math.max(riverInspectionBounds?.min[0] ?? -24, Math.min(riverInspectionBounds?.max[0] ?? 82, controls.target.x));
      controls.target.y = Math.max(1, Math.min(regionalForest?.layout?2000:18, controls.target.y));
      controls.target.z = Math.max(riverInspectionBounds?.min[2] ?? -22, Math.min(riverInspectionBounds?.max[2] ?? 82, controls.target.z));
      if (camera.position.y < 1.1) { camera.position.y = 1.1; camera.lookAt(controls.target); }
    }
    // Visual streaming must finish even before a population source is bound.
    // This owner is already guarded by the active view and GPU-frame barrier.
    preparationPump?.step();
    camera.updateMatrixWorld();
    terrainStream?.update([camera], now, quality.preset);
    if (terrainStream) report.due&&report.set('terrainStreaming',JSON.stringify(terrainStream.stats));
    // GI uses the immutable original source snapshot, not the display pages.
    // Page indexing/replacement/fallback must not hold lighting indefinitely.
    // It shares the bounded upload queue after critical foliage preparation.
    if (!environmentFoundationsReady && vegetationSettled()) environmentFoundationsReady = true;
    const environmentChanged=worldEnvironment?.update(now)??false;
    const physicalConditions=observer?.buildingDisasterConditions?.(),conditions=observer?.buildingConditions?.(),buildingFires=observer?.buildingFires?.();
    const completed=populationStore?observed(populationStore.getSnapshot()):null;
    const minute=completed?getVillagePopulationTime(completed):null;
    const physicalMinute=minute?minute.absoluteWorldMinute+minute.fractionalMinute:worldEnvironment?.state?.absoluteMinute;
    // Capture immutable original contacts/hazard volumes before restoring a saved ruin.
    if(completed&&workplaces)workplaces.syncSupply(completed.timberSupply);
    const damaged=physicalConditions?(emergencySites&&physicalMinute!==undefined?buildingDamageVisuals?.updateDisasters(physicalConditions,physicalMinute):false):conditions?buildingDamageVisuals?.update(conditions):false;
    if(damaged){dirty=true;shadowDirty=true;report.set('buildingDamage',JSON.stringify(buildingDamageVisuals?.stats));}
    if(buildingDisasterEffects){buildingDisasterEffects.update(buildingFires??[],worldEnvironment?.state??null,worldEnvironment?.animationSeconds??fireTime,camera,reducedMotion);
      report.due&&report.set('buildingDisasterEffects',JSON.stringify(buildingDisasterEffects.diagnostics));}
    if(emergencySites)report.due&&report.set('buildingEmergencySites',JSON.stringify(emergencySites.diagnostics));
    if(nightLights?.update(worldEnvironment?.state??null,camera,quality.preset)){dirty=true;report.set('nightLights',JSON.stringify(nightLights.stats));}
    if(worldEnvironment){report.due&&report.set('worldEnvironment',JSON.stringify(worldEnvironment.stats));worldRain?.update(worldEnvironment.state,worldEnvironment.animationSeconds,reducedMotion);}
    if(worldRain)report.due&&report.set('worldRain',JSON.stringify(worldRain.stats));
    if(raidScene){const raid=observer?.raid?.(worldEnvironment?.state?.absoluteMinute)??null;raidScene.update(raid&&buildingFires!=null?{...raid,outcome:null}:raid,worldEnvironment?.state??null,worldEnvironment?.animationSeconds??0,reducedMotion);report.due&&report.set('raidScene',JSON.stringify(raidScene.stats));}
    voxelGI?.update(camera, now);
    if (voxelGI) report.due&&report.set('voxelGI',JSON.stringify(voxelGI.stats));
    if(regionalWoodland)report.due&&report.set('regionalWoodland',JSON.stringify(regionalWoodland.stats));
    if (regionalHorizon) report.due&&report.set('regionalHorizon',JSON.stringify(regionalHorizon.stats));
    if(regionalForest){report.due&&report.set('regionalForest',JSON.stringify(regionalForest.stats));report.due&&report.set('regionalForestResources',JSON.stringify(regionalForest.resources));if(regionalForest.layout){resolveRegionalLighting(regionalForest);/* L-21: the distant landmarks (the temple's far model alone is 10 MB) download after the first world frame, not before it */if(modelPresented)regionalLandmarks?.update(regionalForest.layout.landmarks);
      const envelope=farSurround!.projectionPacket.geography.sourceEnvelope;controls.maxDistance=5500;
      riverInspectionBounds={min:[envelope.minX-450,-30,envelope.minZ-2600],max:[envelope.maxX+4200,2000,envelope.maxZ+1800]};}}
    if(regionalLandmarks)report.due&&report.set('regionalLandmarks',JSON.stringify(regionalLandmarks.stats));
    if (dirty || changed || environmentChanged || transitioning || animateFire || animateGarden || animateRaid || animateResident || animatePopulation || vegetationTransition) {
      if (population) {
        if (populationTraceFrames < 6) tracePopulation('before-population-update');
        population.update(filmShot ? filmDelta('population') : lastPopulationTick ? Math.min(.1, Math.max(0, (now - lastPopulationTick) / 1000)) : 0, reducedMotion);
        if (populationTraceFrames < 6) tracePopulation('after-population-update');
        lastPopulationTick = now; reportPopulation();
        if(emergencyActionVisuals){
          const residents:EmergencyActionVisualRecord[]=[];
          for(const row of population.sample?.residents??[]){const action=row.emergency;if(!action)continue;
            residents.push({residentId:row.residentId,incidentId:action.incidentId,phase:action.phase,qualified:action.qualified,waterUnits:action.waterUnits,
              stationId:action.stationId,contactSourceActor:action.contactSourceActor,
              prop:population.emergencyPropFor(row.residentId,action.phase==='repairing'||action.phase==='to-repair'?'repair-tool':'bucket'),
              station:action.stationId?emergencySites?.contactFor(action.stationId)??null:null,
              contactEvent:population.emergencyContactEventFor(row.residentId)});
          }
          emergencyActionVisuals.update({clockSeconds:worldEnvironment?.animationSeconds??fireTime,paused:observer?.speed?.()===0,reducedMotion,residents});
          options.host.dataset.buildingEmergencyActions=JSON.stringify(emergencyActionVisuals.diagnostics);
        }
      }
      if (residentPreview) {
        const delta = filmShot ? filmDelta('resident') : animateResident && lastResidentTick ? Math.min(.1, Math.max(0, (now - lastResidentTick) / 1000)) : 0;
        residentPreview.update(delta, reducedMotion);
        lastResidentTick = animateResident ? now : 0;
        if (animateResident && renderer.shadowMap.enabled) renderer.shadowMap.needsUpdate = true;
      }
      if (filmShot) fireTime = filmShot.seconds;
      else if (animateFire) {
        if (lastFireTick) fireTime += Math.min(.1, Math.max(0, (now - lastFireTick) / 1000));
        lastFireTick = now;
      }
      fire?.update(fireTime, reducedMotion,extinguishedAt,worldEnvironment?.state);
      updateGarden();
      openWater?.update(worldEnvironment?.animationSeconds??fireTime, !reducedMotion && (observer?.speed?.() ?? 1) !== 0, worldEnvironment?.state);
      if(openWater)options.host.dataset.openWater=JSON.stringify(openWater.diagnostics);
      if(fire)options.host.dataset.proceduralFire=JSON.stringify(fire.runtime.diagnostics);
      waterLook?.update(worldEnvironment?.animationSeconds??fireTime, !reducedMotion, worldEnvironment?.state);
      atmosphere?.update(fireTime, !reducedMotion);
      riverValley?.update(worldEnvironment?.animationSeconds??fireTime, !reducedMotion, worldEnvironment?.state);
      camera.updateMatrixWorld();
      updateShadows();
      vegetationTransition = false;
      farGrassLook?.update(camera, quality.preset);
      cullPlants();
      // After culling, so only cells drawn this frame update their simplified model (L-27).
      for (const vegetation of sourceVegetationHlod.values()) if (vegetation.visible) vegetationTransition = vegetation.update(now, camera, quality.preset, reducedMotion) || vegetationTransition;
      if (!options.authorPondProbe) {
        if (planarPond) {
          // The optional mirrored view has its own camera. Retain its complete
          // quality pool until that camera participates in spatial selection.
          woodlandVisibility?.restore(quality.preset); farWoodlandVisibility?.restore(quality.preset);
          treeHlod?.restore(); farTreeHlod?.restore();regionalWoodland?.suspend();regionalForest?.suspend();
          for (const tree of sourceVegetationHlod.values()) tree.restore();
        } else {
          camera.updateMatrixWorld();
          if (sun.castShadow && sunShadowActive) {
            sun.updateWorldMatrix(true, false); sun.target.updateWorldMatrix(true, false);
            // Keep the cached map's projection until that map is refreshed.
            // Moving its matrix alone would slide stale shadows over surfaces.
            if(renderer.shadowMap.needsUpdate) sun.shadow.updateMatrices(sun);
            woodlandCameras[1] = sun.shadow.camera; woodlandCameras.length = 2;
          } else woodlandCameras.length = 1;
          woodlandVisibility?.update(woodlandCameras, quality.preset, sun.castShadow && sunShadowActive);
          farWoodlandVisibility?.update(woodlandCameras, quality.preset, sun.castShadow && sunShadowActive);
          vegetationTransition = Boolean(treeHlod?.update(now, camera, quality.preset, reducedMotion)) || vegetationTransition;
          vegetationTransition = Boolean(farTreeHlod?.update(now, camera, quality.preset, reducedMotion)) || vegetationTransition;
          vegetationTransition = Boolean(regionalWoodland?.update(woodlandCameras,now,quality.preset,reducedMotion)) || vegetationTransition;
          regionalForest?.resume();vegetationTransition=Boolean(regionalForest?.update(camera,now,quality.preset,reducedMotion))||vegetationTransition;
        }
        if (woodlandVisibility) report.due&&report.set('woodlandSpatialVisibility',JSON.stringify(woodlandVisibility.stats));
        if (farWoodlandVisibility) report.due&&report.set('farWoodlandSpatialVisibility',JSON.stringify(farWoodlandVisibility.stats));
      }
      if (treeHlod) report.due&&report.set('treeHlod',JSON.stringify(treeHlod.stats));
      if (farTreeHlod) report.due&&report.set('farTreeHlod',JSON.stringify(farTreeHlod.stats));
      report.due&&report.set('worldPreparation',JSON.stringify(vegetationQueue.stats));
      if (vegetationResources) report.due&&report.set('vegetationResources',JSON.stringify(vegetationResources.stats));
      if (farGrassLook) report.due&&report.set('grassGroundField',JSON.stringify(farGrassLook.stats));
      if (sourceVegetationHlod.size) {
        sourceVegetationStats.cells = sourceVegetationHlod.size; sourceVegetationStats.ready = 0;
        sourceVegetationStats.levels.fill(0); sourceVegetationStats.errors.length = 0;
        for (const vegetation of sourceVegetationHlod.values()) {
          if (vegetation.stats.readyMask === 15) sourceVegetationStats.ready++;
          if (vegetation.stats.error && sourceVegetationStats.errors.length < 8 && !sourceVegetationStats.errors.includes(vegetation.stats.error)) sourceVegetationStats.errors.push(vegetation.stats.error);
          if (vegetation.visible) for (let level = 0; level < 4; level++) sourceVegetationStats.levels[level] += vegetation.stats.levels[level];
        }
        report.due&&report.set('sourceVegetationHlod',JSON.stringify(sourceVegetationStats));
      }
      if (population && populationTraceFrames < 6) tracePopulation('after-cull');
      if (population && populationTraceFrames < 6) tracePopulation('after-shadows');
      updateLocalLights();
      pondProbe?.update();
      if(planarPond){
        planarPond.update(now);
        const result=planarPond.diagnostics;
        report.due&&report.set('planarPondUpdates',String(result.updates));
        report.due&&report.set('planarPondLastCpuMs',result.lastCpuMs.toFixed(3));
        report.due&&report.set('planarPondLastDrawCalls',String(result.lastDrawCalls));
        report.due&&report.set('planarPondLastTriangles',String(result.lastTriangles));
        report.due&&report.set('planarPondFilterSamples',String(result.filterSamples));
        report.due&&report.set('planarPondFilterMethod',result.filterMethod);
        if(result.error){
          report.set('planarPondStatus','error');report.set('planarPondError',result.error);
          releasePlanarPond();planarBlocked=true;report.set('planarPondSize','0');
        }else if(result.updates>0)report.set('planarPondStatus','active');
      }
      const renderSubmissionStarted = performance.now();
      if (population && populationTraceFrames < 6) tracePopulation('before-render');
      if (populationTracing && population && populationTraceFrames < 2) {
        const meshes: { name: string; vertices: number; indices: number; morphs: number; skinned: boolean }[] = [];
        population.object.traverse(object => { if (object instanceof Mesh) meshes.push({ name: object.name,
          vertices: object.geometry.getAttribute('position')?.count ?? 0, indices: object.geometry.index?.count ?? 0,
          morphs: object.geometry.morphAttributes.position?.length ?? 0, skinned: 'isSkinnedMesh' in object }); });
        console.debug('EALDHOLT_POPULATION_MESHES', JSON.stringify(meshes), JSON.stringify(population.snapshot));
      }
      regionalForest?.beginFrame();regionalLandmarks?.beginFrame();
      try {
        if(drawDiagnostics){
          bankMaterialDiagnostics?.begin();drawDiagnostics.begin();let completed=false;
          try{renderer.render(scene,camera);completed=true;}finally{drawDiagnostics.end(completed);reportDrawDiagnostics();}
        }else renderer.render(scene,camera);
      } catch (error) {
        glDiagnostics?.failed({canvasFrame:renders+1,rendererFrame:renderer.info.render.frame},'renderer-threw');reportGlDiagnostics();throw error;
      }
      if (graphicsTracing && architectureSuffix) report.due&&report.set('architectureSuffixVisibility',JSON.stringify(architectureSuffix.stats));
      if (populationTracing || graphicsTracing) report.due&&report.set('worldResidentFollow',JSON.stringify(describeResidentFollowTrace(
        followId, followId ? population?.residentAvailability(followId) ?? null : null, renderer.info.render.frame, renders + 1)));
      if(regionalForest)report.due&&report.set('regionalForest',JSON.stringify(regionalForest.stats));if(regionalLandmarks)report.due&&report.set('regionalLandmarks',JSON.stringify(regionalLandmarks.stats));
      if(modelAssembled)modelPresented=true;
      const submittedFrame={canvasFrame:renders+1,rendererFrame:renderer.info.render.frame};
      glDiagnostics?.submitted(submittedFrame);reportGlDiagnostics();
      gpuFrame.submitted(submittedFrame);
      report.due&&report.set('worldGpuFrame',JSON.stringify(gpuFrame.stats));
      if (population && populationTraceFrames++ < 6) tracePopulation('after-render');
      report.due&&report.set('renderCpuSubmissionMs',(performance.now() - renderSubmissionStarted).toFixed(3));
      report.due&&report.set('renderCpuSubmissionScope',"normal renderer.render plus submission bookkeeping; GPU duration unmeasured");
      report.due&&report.set('renderCalls',String(renderer.info.render.calls));
      lastFrame = now; report.wrote(now);
      dirty = false;
      renders++; report.due&&report.set('renderFrames',String(renders));
      report.due&&report.set('renderTriangles',String(renderer.info.render.triangles));
      diagnosticSpherical.setFromVector3(diagnosticOffset.copy(camera.position).sub(controls.target));
      report.due&&report.set('cameraYaw',diagnosticSpherical.theta.toFixed(6));
      report.due&&report.set('cameraPitch',diagnosticSpherical.phi.toFixed(6));
      report.due&&report.set('cameraDistance',diagnosticSpherical.radius.toFixed(6));
      report.due&&report.set('cameraPosition',JSON.stringify(camera.position.toArray()));
      report.due&&report.set('cameraTarget',JSON.stringify(controls.target.toArray()));
      report.due&&report.set('cameraFov',camera.fov.toFixed(3));
      report.due&&report.set('selectedView',selectedView);
      report.due&&report.set('geometryCount',String(renderer.info.memory.geometries));
      report.due&&report.set('textureCount',String(renderer.info.memory.textures));
      report.due&&report.set('fireTime',fireTime.toFixed(3));
      report.due&&report.set('environmentTime',fireTime.toFixed(3));
      report.due&&report.set('fireAnimated',String(animateFire));
      if (readyPending) {
        readyPending = false;
        report.set('modelReady',"true");
        options.onReady();
      }
      // Preserve a static view's pending reflection through a too-early redraw.
      // One deadline respects the15Hz cap; success/unsupported views stop it.
      // If the main pass could not consume shadows, wait for a real state change.
      if(!disposed&&active&&planarPond&&!(renderer.shadowMap.enabled&&renderer.shadowMap.needsUpdate))
        planarRedraw.schedule(planarPond.retryAtMilliseconds);
      else planarRedraw.cancel();
    }
    if (!gpuFrame.terminalFailure && ((gpuFrame.stats.pending&&!observationDemand.holding) || animateFire || animateGarden || animateRaid || animateResident || animatePopulation || poseTransition || (vegetationQueue.pending && !options.authorPondProbe && !planarPond) || vegetationTransition || (changed && !reducedMotion)) && !frame) frame = requestAnimationFrame(render);
  }

  function updateProjection(): void {
    const width = Math.max(1, options.host.clientWidth), height = Math.max(1, options.host.clientHeight);
    if (viewShift) camera.setViewOffset(width, height, -width * viewShift, 0, width, height);
    else camera.clearViewOffset();
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function resize(): void {
    if (disposed) return;
    const width = Math.max(1, options.host.clientWidth), height = Math.max(1, options.host.clientHeight);
    const maxRatio = quality.preset === "high" ? 1.5 : quality.preset === "medium" ? 1.25 : 1;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxRatio) * quality.renderScale / 100);
    renderer.setSize(width, height);
    updateProjection();
    requestRender();
  }

  function resetView(): void {
    selectedView = "overview";
    villageTarget.fromArray(EALDHOLT_VILLAGE_VIEWS[0].target);
    villagePosition.fromArray(EALDHOLT_VILLAGE_VIEWS[0].position);
    villageFov = EALDHOLT_VILLAGE_VIEWS[0].fov;
    camera.fov = villageFov;
    poseTransition = null;
    controls.target.copy(villageTarget);
    camera.position.copy(villageTarget).add(villagePosition.clone().sub(villageTarget).multiplyScalar(panelMode === "village" ? 1 : 0.82));
    viewShift = panelMode === "village" ? 0 : panelMode === "banner" ? 0.26 : 0.19;
    updateProjection();
    controls.update();
    shadowDirty = true;
    requestRender();
  }

  function setPanelMode(next: "intro" | "banner" | "village"): void {
    if (next === panelMode) return;
    controls.enableDamping = false;
    controls.update();
    if (panelMode === "village") {
      villagePosition.copy(camera.position);
      villageTarget.copy(controls.target);
    }
    panelMode = next;
    const position = villageTarget.clone().add(villagePosition.clone().sub(villageTarget).multiplyScalar(next === "village" ? 1 : 0.82));
    const shift = next === "village" ? 0 : next === "banner" ? 0.26 : 0.19;
    if (reducedMotion) {
      poseTransition = null;
      camera.position.copy(position);
      controls.target.copy(villageTarget);
      viewShift = shift;
      updateProjection();
      controls.update();
    } else {
      poseTransition = { fromPosition: camera.position.clone(), fromTarget: controls.target.clone(), fromShift: viewShift,
        position, target: villageTarget.clone(), shift, start: null };
    }
    requestRender();
  }

  function releasePlanarPond():void{planarRedraw.cancel();const current=planarPond;planarPond=null;current?.dispose();}
  function syncPlanarPond():void{
    if(!planarRequested||quality.preset!=='high'||options.authorPondProbe||options.diagnosticFlatPond){
      releasePlanarPond();options.host.dataset.planarPondSize='0';
      options.host.dataset.planarPondStatus=planarRequested&&(options.authorPondProbe||options.diagnosticFlatPond)?'unsupported':'disabled';
      if(planarRequested&&(options.authorPondProbe||options.diagnosticFlatPond))options.host.dataset.planarPondError='Planar pond cannot be combined with authoring or flat-normal controls.';
      return;
    }
    if(!model||!modelAssembled||planarPond||planarBlocked)return;
    try{
      planarPond=createEaldholtPlanarPond(renderer,scene,model,{camera,plantCells});
      const result=planarPond.diagnostics;
      options.host.dataset.planarPondStatus='requested';options.host.dataset.planarPondSize=String(result.size);
      options.host.dataset.planarPondPlaneDeviation=String(result.planeDeviation);options.host.dataset.planarPondError='';
      options.host.dataset.planarPondCapTriangles=String(result.capTriangles);options.host.dataset.planarPondCapVertices=String(result.capVertices);
      options.host.dataset.planarPondCapArea=String(result.capArea);options.host.dataset.planarPondCapHeight=String(result.capHeight);
      options.host.dataset.planarPondCapProjectedFraction=String(result.capProjectedFraction);
    }catch(error){
      planarBlocked=true;options.host.dataset.planarPondStatus='unsupported';options.host.dataset.planarPondSize='0';
      options.host.dataset.planarPondError=error instanceof Error?error.message:'Planar pond is unsupported by this source surface.';
    }
  }

  function setQuality(next: DesktopEnvironmentQuality): void {
    // Keep the far-tree tier inside the visible landscape. These affect the
    // existing scene's view distance, not authored terrain dimensions.
    if (scene.fog instanceof Fog) {
      scene.fog.near = next.preset === 'low' ? 150 : 240;
      scene.fog.far = next.preset === 'low' ? 1200 : next.preset === 'high' ? 2600 : 1800;
      camera.far = regionalHorizon ? 11000 : scene.fog.far * 1.5; camera.updateProjectionMatrix();
    }
    quality = next;
    farWoodland?.setQuality(next.preset);
    woodlandVisibility?.restore(next.preset); farWoodlandVisibility?.restore(next.preset); reportFarWoodland();
    if (foliageDensity) {
      if (foliageDensity.setQuality(next.preset)) { for (const item of shadowMeshes) item.triangles = meshTriangles(item.mesh); shadowCasterVersion++; }
      const selected = foliageDensity.diagnostics;
      options.host.dataset.foliageQuality = selected.quality;
      options.host.dataset.selectedFoliageActors = String(selected.selectedActors);
      options.host.dataset.selectedFoliagePotentialTriangles = String(selected.selectedTriangles);
    }
    const shadows = next.preset !== "low";
    sun.castShadow = shadows;
    renderer.shadowMap.enabled = shadows;
    const size = next.preset === "high" ? 2048 : 1024;
    if (sun.shadow.mapSize.x !== size) {
      sun.shadow.mapSize.set(size, size);
      sun.shadow.map?.dispose(); sun.shadow.map = null;
    }
    const anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), next.preset === "high" ? 8 : next.preset === "medium" ? 4 : 2);
    for (const texture of sourceTextures) if (texture.anisotropy !== anisotropy) { texture.anisotropy = anisotropy; texture.needsUpdate = true; }
    scene.environmentIntensity = next.preset === "high" ? 1 : next.preset === "medium" ? .95 : .9;
    if (model) model.traverse(object => {
      if (!(object instanceof Mesh)) return;
      if (residentPreview?.meshes.has(object)) { object.castShadow = shadows; return; }
      object.castShadow = false;
      object.receiveShadow = kindOf(object) !== "water";
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        // Controlled cutout baseline: source cutoff + measured mip coverage.
        // A2C can further thin subpixel foliage and is intentionally disabled.
        if (material.alphaToCoverage) { material.alphaToCoverage = false; material.needsUpdate = true; }
      }
    });
    fire?.rootObject3D.traverse(object => { if (object.type === "PointLight") object.visible = next.preset === "high"; });
    shadowDirty = true; shadowCasterVersion++; // the traversal above cleared every caster flag
    options.host.dataset.textureAnisotropy = String(anisotropy);
    options.host.dataset.environment = "procedural-daylight-pmrem";
    options.host.dataset.shadowMapSize = shadows ? String(size) : "0";
    syncPlanarPond();
    resize();
  }

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(options.host);
  controls.addEventListener("change", cameraChanged);
  controls.addEventListener("start", cameraDragStarted);
  controls.addEventListener("end", cameraDragEnded);
  resetView();
  setQuality(quality);
  options.host.dataset.modelReady = "false";
  options.host.dataset.renderFrames = "0";
  options.host.dataset.sourceVegetationHlod = JSON.stringify(sourceVegetationStats);
  options.host.dataset.sourceVegetationHlodUnsupported = '0';
  delete options.host.dataset.vegetationResources; delete options.host.dataset.grassGroundField;
  options.host.dataset.renderTriangles = "0";
  options.host.dataset.geometryCount = "0";
  options.host.dataset.textureCount = "0";
  const modelFile = new URL(options.modelUrl).pathname.split("/").at(-1) ?? "";
  const sourceProfile=options.authorPondProbe?.profile??(modelFile.includes('-quest-')?'quest':'desktop');
  options.host.dataset.modelFile = modelFile;
  options.host.dataset.modelProfile = modelFile.includes("-quest-") ? "quest" : "desktop";
  options.host.dataset.residentPreviewStatus = options.authorPondProbe ? 'disabled-authoring' : import.meta.env.DEV ? 'unconfigured' : 'disabled';
  options.host.dataset.residentPreviewCount = '0';
  options.host.dataset.residentPreviewBoundsContained = 'false';
  options.host.dataset.residentPreviewError = '';
  options.host.dataset.residentPreviewRevision = '';
  options.host.dataset.pondProbeStatus = options.authorPondProbe ? "authoring" : "unconfigured";
  options.host.dataset.pondProbeMaterials = "0";
  options.host.dataset.planarPondStatus=planarRequested&&quality.preset==='high'?'requested':'disabled';
  options.host.dataset.planarPondSize='0';options.host.dataset.planarPondUpdates='0';options.host.dataset.planarPondError='';
  options.host.dataset.distantCoastStatus = import.meta.env.DEV && options.diagnosticDistantCoast ? "requested" : "disabled";
  options.host.dataset.bankLandformStatus = "requested";
  options.host.dataset.coastalContinuityStatus = "requested";
  options.host.dataset.coverageMipsRequested = String(coverageMipsRequested);
  options.host.dataset.coverageMipsAppearanceDiagnostic = String(coverageMipsDiagnostic);
  options.host.dataset.coverageMipsStatus = coverageMipsEnabled ? 'requested' : 'disabled';
  options.host.dataset.coverageMipsError = '';
  for (const field of ['coverageMipsMaterials', 'coverageMipsTextures', 'coverageMipsSourceMaps', 'coverageMipsMipLevels', 'coverageMipsExtraTextureBytes', 'coverageMipsCpuMs']) options.host.dataset[field] = '0';
  options.host.dataset.coverageMipsMaps = '[]'; options.host.dataset.coverageMipsSkipReasons = '[]';
  options.host.dataset.pondShoreRequested = String(pondShoreRequested);
  options.host.dataset.pondShoreAppearanceDiagnostic = String(pondShoreEnabled);
  options.host.dataset.pondShoreStatus = pondShoreEnabled ? 'requested' : pondShoreRequested ? 'disabled-authoring' : 'disabled';
  options.host.dataset.pondShoreError = pondShoreRequested && options.authorPondProbe ? 'Pond shore diagnostics are disabled during probe authoring.' : '';
  for (const field of ['pondShoreMaterials', 'pondShorePondMaterials', 'pondShoreTerrainMaterials', 'pondShoreGroundcoverMaterials', 'pondShoreTextures', 'pondShoreTextureBytes']) options.host.dataset[field] = '0';
  options.host.dataset.pondShoreQualification = 'null'; options.host.dataset.pondShoreField = 'null'; options.host.dataset.pondShoreSkipReasons = '[]';

  void (async () => {
    try {
      let residentInput: EaldholtResidentPreviewInput | null = null;
      try {
        const siteBytes = typeof __EALDHOLT_SITE_BYTES__ === 'number' ? __EALDHOLT_SITE_BYTES__ : 0;
        const releaseSite = !import.meta.env.DEV && siteBytes && desktopReleaseVillage
          ? JSON.stringify({version:1,profiles:{desktop:{source:{file:modelFile,bytes:174285136,sha256:desktopReleaseVillage.village.modelSha256},site:{file:'ealdholt-population-desktop-fresh-exterior-v4-tall-commuting.json',bytes:siteBytes,sha256:'fc60a1d43098bdb633b696fc92ea4751120f5741e671a699384bf39f7b676475'}}}}) : undefined;
        populationInput = !options.authorPondProbe
          ? readEaldholtPopulationSiteInput(import.meta.env.DEV ? import.meta.env.VITE_ELDERBLOOM_POPULATION_SITE_INPUT : releaseSite,
            modelFile.includes('-quest-') ? 'quest' : 'desktop', options.modelUrl) : null;
      } catch (error) {
        populationStatus = 'error'; populationError = error instanceof Error ? error.message : 'Population configuration failed.';
      }
      reportPopulation();
      try {
        residentInput = import.meta.env.DEV && !options.authorPondProbe && !populationInput
          ? readEaldholtResidentPreviewInput(import.meta.env.VITE_ELDERBLOOM_RESIDENT_PREVIEW,
            modelFile.includes('-quest-') ? 'quest' : 'desktop', options.modelUrl) : null;
        if (residentInput) options.host.dataset.residentPreviewStatus = 'loading';
      } catch (error) {
        options.host.dataset.residentPreviewStatus = 'error';
        options.host.dataset.residentPreviewError = error instanceof Error ? error.message : 'Private resident preview configuration failed.';
        throw error;
      }
      // Authoring always bypasses configured reflections to prevent feedback.
      // A release build binds the reflection it bundled beside its model.
      let probeConfig;
      try {
        probeConfig = options.authorPondProbe ? null
          : import.meta.env.DEV ? readEaldholtPondProbeConfig(import.meta.env.VITE_ELDERBLOOM_POND_PROBES,
            modelFile.includes("-quest-") ? "quest" : "desktop", options.modelUrl)
          : desktopReleaseVillage?.pondProbe.modelUrl === options.modelUrl ? desktopReleaseVillage.pondProbe : null;
      } catch (error) {
        options.host.dataset.pondProbeStatus = "error";
        options.host.dataset.pondProbeError = error instanceof Error ? error.message : "Private pond probe configuration failed.";
        throw error;
      }
      let bytes: ArrayBuffer;
      reportStage('download');
      if (residentInput) bytes = await loadVerifiedResidentPreviewGlb(residentInput.source, abort.signal);
      else if (!import.meta.env.DEV && import.meta.env.VITE_EALDHOLT_CHUNKED_MODEL === '1') {
        if (!desktopReleaseVillage || options.modelUrl !== desktopReleaseVillage.urls.model) throw new Error('Chunked village requires the verified desktop release model.');
        bytes = await loadChunkedVillageModel(options.modelUrl, {bytes:174285136,sha256:desktopReleaseVillage.village.modelSha256}, abort.signal,
          options.onProgress ? fraction => reportStage('download', fraction) : undefined);
      } else {
        const response = await fetch(options.modelUrl, { signal: abort.signal });
        if (!response.ok) throw new Error(`Model request failed (${response.status}).`);
        bytes = await readResponseBytes(response, options.onProgress ? fraction => reportStage('download', fraction) : undefined);
      }
      if (disposed) return;
      reportStage('verify');
      if (populationInput) {
        try { await verifyResidentPreviewGlb(bytes, populationInput.source, abort.signal); }
        catch (error) {
          populationInput = null; populationStatus = 'error';
          populationError = error instanceof Error ? error.message : 'Population source model identity failed.';
          reportPopulation();
        }
      }
      const sourceSha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('');
      reportStage('parse');
      const gltf = await new GLTFLoader().parseAsync(bytes, new URL(".", options.modelUrl).href);
      if (disposed) { disposeModel(gltf.scene); return; }
      model = gltf.scene;
      markEaldholtFarWoodlandMaterialIdentity(model);
      if (residentInput) assertResidentPreviewTextures(gltf);
      const bounds = new Box3().setFromObject(model);
      if (bounds.isEmpty() || ![...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite)) throw new Error("Model has invalid bounds.");
      const residentSourceBounds = residentInput ? ealdholtResidentPreviewSourceBounds(model) : null;
      if (residentInput && residentSourceBounds) assertEaldholtResidentPreviewContained(residentSourceBounds,
        new Box3(new Vector3().fromArray(residentInput.idleEnvelope.min), new Vector3().fromArray(residentInput.idleEnvelope.max)));
      openWater = createEaldholtOpenWater(renderer, { profile: 'desktop', quality: quality.preset, signal: abort.signal });
      waterLook = applyEaldholtWaterLook(model, scene.environment, { openWater });
      options.host.dataset.waterLookMaterials = String(waterLook.materialCount);
      groundLook = applyEaldholtGroundAo(model);
      options.host.dataset.groundAoMaterials = String(groundLook.materialCount);
      const textureDirectory = new URL("assets/legacy/environment/aethelgard/textures/", new URL(import.meta.env.BASE_URL, document.baseURI)).href;
      reportStage('ground');
      // Low takes the smaller ground maps (L-22); a later preset change keeps what was loaded until re-entry.
      const albedo = await loadEaldholtGroundAlbedoDetail(model, textureDirectory, abort.signal, quality.preset === "low" ? "quest" : "desktop");
      if (disposed) { albedo.dispose(); return; }
      groundAlbedo = albedo;
      options.host.dataset.valleyGrassStatus = "loading";
      try {
        const loadedGround = await loadEaldholtValleyGroundSet(textureDirectory,
          quality.preset === "low" ? "quest" : "desktop", { woodlandFloor: false, fallbackDirectory: 'grass-meadow-v1', signal: abort.signal });
        if (disposed) { loadedGround.dispose(); return; }
        valleyGround = loadedGround;
        options.host.dataset.valleyGrassStatus = loadedGround.grass ? "ready" : "fallback";
        options.host.dataset.valleyGroundMode = loadedGround.mode;
        options.host.dataset.valleyGroundLayers = JSON.stringify(loadedGround.layers);
        options.host.dataset.valleyGroundReasons = JSON.stringify(loadedGround.reasons);
      } catch (error) {
        if (abort.signal.aborted) throw error;
        // The optional new surface cannot make an otherwise valid visit blank.
        options.host.dataset.valleyGrassStatus = "fallback";
      }
      options.host.dataset.valleyGrassSource = valleyGround?.grass?.sourceAssetId ?? "fallback";
      options.host.dataset.valleyGrassTileMetres = String(valleyGround?.grass?.tileMetres ?? 0);
      options.host.dataset.valleyGrassTextureCount = String(valleyGround?.textureCount ?? 0);
      options.host.dataset.valleyGrassTextureBytesEstimate = String(valleyGround?.extraTextureBytesWithMipsEstimate ?? 0);
      reportStage('coast');
      riverValley = createEaldholtRiverValley(model, valleyGround?.earth ?? albedo.surfaceMaps.earth, { profile: sourceProfile, environment: scene.environment, rockMaps: albedo.surfaceMaps.rock, grassMaps: valleyGround?.grass, openWater: openWater ?? undefined });
      options.host.dataset.valleyArtVersion = riverValley.artVersion;
      riverInspectionBounds = riverValley.bounds;
      model.add(riverValley.object);
      // Generated woodland and margin placements sample the final owned land.
      if (import.meta.env.DEV && options.diagnosticDistantCoast === true) {
        const { createEaldholtDistantCoastPreview } = await import("./distant-coast-preview");
        if (disposed) return;
        distantCoast = createEaldholtDistantCoastPreview(riverValley.object);
        riverValley.object.add(distantCoast.object);
        riverInspectionBounds = {
          min: riverValley.bounds.min.map((value, axis) => Math.min(value, distantCoast!.bounds.min[axis])) as [number, number, number],
          max: riverValley.bounds.max.map((value, axis) => Math.max(value, distantCoast!.bounds.max[axis])) as [number, number, number],
        };
        options.host.dataset.distantCoastStatus = "active";
        options.host.dataset.distantCoastTriangles = String(distantCoast.triangles);
        options.host.dataset.distantCoastDrawCalls = String(distantCoast.drawCalls);
        options.host.dataset.distantCoastBufferBytes = String(distantCoast.bufferBytes);
        const foreground = distantCoast.object.userData.crownfallDistantCoastPreview.foregroundClone;
        options.host.dataset.distantCoastForegroundBytes = String(foreground.bufferBytes);
        options.host.dataset.distantCoastExtensionBytes = String(foreground.extensionBytes);
        options.host.dataset.distantCoastBounds = JSON.stringify(riverInspectionBounds);
      }
      // Keep the isolated coast study independent. Shape the real exterior
      // before generating groves, so their roots sample its finished surface.
      if (!distantCoast) {
        bankLandform = createEaldholtBankLandform(model, riverValley.object, null, { profile: sourceProfile });
        coastalContinuity = createEaldholtCoastalContinuity(model, riverValley.object, bankLandform, { profile: sourceProfile });
        outerContinuation = createEaldholtOuterContinuation(model, riverValley.object, { profile: sourceProfile });
        riverValley.object.add(outerContinuation.object);
        riverInspectionBounds = {
          min: riverValley.bounds.min.map((value, axis) => Math.min(value, coastalContinuity!.landBounds.min[axis], outerContinuation!.bounds.min[axis])) as [number, number, number],
          max: riverValley.bounds.max.map((value, axis) => Math.max(value, coastalContinuity!.landBounds.max[axis], outerContinuation!.bounds.max[axis])) as [number, number, number],
        };
      }
      woodland = createEaldholtRiverWoodland(model, riverValley.object, { profile: sourceProfile });
      const borrowedRealisticTree=borrowRealisticTreeSource(woodland,sourceSha256);
      const realisticTreeSource=borrowedRealisticTree?normalizeRealisticTreeSource(borrowedRealisticTree):null;
      const borrowedForest01=borrowForest01TreeSource(model,sourceSha256),realisticForest01Source=borrowedForest01?normalizeRealisticTreeSource(borrowedForest01):null;
      model.add(woodland.object);
      options.host.dataset.outerContinuationStatus = outerContinuation ? "active" : "disabled-coast-study";
      options.host.dataset.outerContinuationTriangles = String(outerContinuation?.triangles ?? 0);
      options.host.dataset.outerContinuationDrawCalls = String(outerContinuation?.drawCalls ?? 0);
      options.host.dataset.outerContinuationContourRows = String(outerContinuation?.landContourRows ?? 0);
      options.host.dataset.outerContinuationLandform = JSON.stringify(outerContinuation?.landform ?? null);
      options.host.dataset.outerContinuationBufferBytes = String(outerContinuation?.bufferBytes ?? 0);
      options.host.dataset.coastalContinuityStatus = coastalContinuity ? "active" : "disabled-coast-study";
      options.host.dataset.coastalContinuityVerticesChanged = String(coastalContinuity?.verticesChanged ?? 0);
      options.host.dataset.coastalContinuityMaximumRaise = String(coastalContinuity?.maximumRaise ?? 0);
      options.host.dataset.coastalContinuityOuterVertices = String(coastalContinuity?.outerBoundaryVerticesChanged ?? 0);
      options.host.dataset.coastalContinuityCpuPatchBytes = String(coastalContinuity?.cpuPatchBytes ?? 0);
      options.host.dataset.bankLandformStatus = bankLandform ? "active" : "disabled-coast-study";
      options.host.dataset.bankLandformTrianglesAdded = String(bankLandform?.trianglesAdded ?? 0);
      options.host.dataset.bankLandformBufferBytes = String(bankLandform?.bufferBytes ?? 0);
      options.host.dataset.bankLandformBufferBytesAdded = String(bankLandform?.bufferBytesAdded ?? 0);
      options.host.dataset.bankLandformMovedVertices = String(bankLandform?.movedVertices ?? 0);
      options.host.dataset.bankLandformMaximumRaise = String(bankLandform?.maximumRaise ?? 0);
      options.host.dataset.bankLandformProtectedFootprints = String(bankLandform?.protectedFootprints.length ?? 0);
      riverMargin = createEaldholtRiverMargin(model, riverValley.object, albedo.surfaceMaps.rock, { profile: sourceProfile });
      model.add(riverMargin.object);
      woodlandUnderstory = createEaldholtWoodlandUnderstory(model, riverValley.object, {
        profile: sourceProfile,
        woodlandPlacements: woodland.placements ?? [], canopyRadius: woodland.canopyRadius ?? 0,
      });
      model.add(woodlandUnderstory.object);
      options.host.dataset.woodlandUnderstoryInstances = String(woodlandUnderstory.instanceCount);
      options.host.dataset.woodlandUnderstoryTriangles = String(woodlandUnderstory.triangles);
      options.host.dataset.woodlandUnderstoryDrawCalls = String(woodlandUnderstory.drawCalls);
      options.host.dataset.woodlandUnderstorySourceFamily = woodlandUnderstory.sourceGrassFamily ?? "unavailable";
      options.host.dataset.woodlandUnderstorySourceRoots = String(woodlandUnderstory.sourceRootCount);
      options.host.dataset.woodlandUnderstoryOwnedInstanceBytes = String(woodlandUnderstory.ownedInstanceBytes);
      foliageDensity = createEaldholtFoliageDensity(model, quality.preset);
      options.host.dataset.riverMarginTriangles = String(riverMargin.triangles);
      options.host.dataset.riverMarginDrawCalls = String(riverMargin.drawCalls);
      options.host.dataset.riverMarginGrassInstances = String(riverMargin.grassInstanceCount);
      options.host.dataset.riverMarginStoneInstances = String(riverMargin.stoneInstanceCount);
      options.host.dataset.riverMarginStoneFormsPerGroup = String(riverMargin.stoneFormsPerGroup);
      options.host.dataset.riverMarginOwnedGeometryBytes = String(riverMargin.ownedGeometryBytes);
      options.host.dataset.woodlandTriangles = String(woodland.triangles);
      options.host.dataset.woodlandDrawCalls = String(woodland.drawCalls);
      options.host.dataset.woodlandInstances = String(woodland.instanceCount);
      options.host.dataset.woodlandAcceptedRegions = JSON.stringify(woodland.object.userData.crownfallRiverWoodland.acceptedRegionCounts);
      options.host.dataset.woodlandComposition = JSON.stringify(woodland.object.userData.crownfallRiverWoodland.composition);
      options.host.dataset.woodlandNorthShoulderInstances = String(woodland.object.userData.crownfallRiverWoodland.northShoulderInstanceCount);
      options.host.dataset.woodlandEastShoulderInstances = String(woodland.object.userData.crownfallRiverWoodland.eastShoulderInstanceCount);
      options.host.dataset.riverTriangles = String(riverValley.triangles + (bankLandform?.trianglesAdded ?? 0) + (outerContinuation?.triangles ?? 0));
      options.host.dataset.riverDrawCalls = String(riverValley.drawCalls + (outerContinuation?.drawCalls ?? 0));
      options.host.dataset.riverBufferBytes = String(riverValley.bufferBytes + (outerContinuation?.bufferBytes ?? 0));
      options.host.dataset.groundAlbedoMaterials = String(albedo.materialCount);
      options.host.dataset.groundAlbedoTextures = String(albedo.textureCount);
      options.host.dataset.groundAlbedoBytesEstimate = String(albedo.extraTextureBytesWithMipsEstimate);
      exportRepairs = applyEaldholtExportRepairs(model);
      options.host.dataset.exportRepairMaterials = String(exportRepairs.ownedReplacementCount);
      options.host.dataset.sheenRoughnessFloors = String(exportRepairs.sheenRoughnessFloorCount);
      if (coverageMipsEnabled) {
        reportStage('foliage');
        options.host.dataset.coverageMipsStatus = 'preparing';
        try {
          const targetModel = model;
          // Verified source IDs differ by profile. Both retain the actual
          // Forest05 family and UV2; never select by generic MASK alone.
          const leafNames = modelFile.includes('-quest-') ? ['Elderbloom_material_33']
            : ['Elderbloom_material_34', 'MI_BlackAlder_Forest_05_TwoSided_SM_BlackAlder_Forest_05_PP3'];
          const binding = await applyEaldholtFoliageCoverageMips(targetModel, {
            signal: abort.signal,
            selectMaterial(mesh, material) {
              if (!leafNames.includes(material.name) || material.alphaTest <= 0) return false;
              for (let node: Object3D | null = mesh; node && node !== targetModel; node = node.parent) {
                const family = node.userData.crownfallWoodlandPrototype?.family
                  ?? node.userData.crownfallRiverWoodland?.sourceFamily;
                if (/SM_BlackAlder_Forest_05(?:[_ .-]|$)/.test(node.name)
                  || typeof family === 'string' && /SM_BlackAlder_Forest_05(?:[_ .-]|$)/.test(family)) return true;
              }
              return false;
            },
          });
          if (disposed || abort.signal.aborted || model !== targetModel) { binding.dispose(); return; }
          coverageMips = binding;
          options.host.dataset.coverageMipsStatus = binding.textureCount ? 'applied' : 'skipped';
          options.host.dataset.coverageMipsMaterials = String(binding.materialCount);
          options.host.dataset.coverageMipsTextures = String(binding.textureCount);
          options.host.dataset.coverageMipsSourceMaps = String(binding.sourceMapCount);
          options.host.dataset.coverageMipsMipLevels = String(binding.mipLevelCount);
          options.host.dataset.coverageMipsExtraTextureBytes = String(binding.extraTextureBytes);
          options.host.dataset.coverageMipsCpuMs = binding.buildMilliseconds.toFixed(3);
          options.host.dataset.coverageMipsMaps = JSON.stringify(binding.maps);
          options.host.dataset.coverageMipsSkipReasons = JSON.stringify(binding.diagnostics);
        } catch (error) {
          if (disposed || abort.signal.aborted) return;
          options.host.dataset.coverageMipsStatus = 'error';
          options.host.dataset.coverageMipsError = error instanceof Error ? error.message : 'Foliage mip preparation failed.';
        }
      }
      if (probeConfig) {
        reportStage('pond');
        options.host.dataset.pondProbeStatus = "loading";
        try {
          const loaded = await loadEaldholtOwnedPondProbe(probeConfig, abort.signal);
          if (disposed) { loaded.dispose(); return; }
          ownedPondProbe = loaded;
          pondProbe = applyEaldholtBorrowedPondProbe(model, loaded.texture, { identity: loaded.identity, expected: probeConfig,
            roughness: pondRoughness, normalScaleMultiplier: EALDHOLT_LOCAL_POND_NORMAL_STRENGTH,
            flatNormalControl: import.meta.env.DEV && options.diagnosticFlatPond === true });
          options.host.dataset.pondNormalControl = import.meta.env.DEV && options.diagnosticFlatPond ? 'flat-diagnostic' : 'authored';
          options.host.dataset.pondProbeMaterials = String(pondProbe.materialCount);
          options.host.dataset.pondProbeRoughness = String(pondRoughness);
          options.host.dataset.pondProbeNormalScaleMultiplier = String(pondProbe.normalScaleMultiplier);
          options.host.dataset.pondProbeNormalScales = JSON.stringify(pondProbe.normalScales);
          const image = loaded.texture.image as { width?: number; height?: number } | undefined;
          options.host.dataset.pondProbeSource = 'desktop-hdr-loader';
          options.host.dataset.pondProbeProfile = loaded.identity.profile;
          options.host.dataset.pondProbeModelSha256 = loaded.identity.modelSha256;
          options.host.dataset.pondProbeLightingVersion = loaded.identity.lightingVersion;
          options.host.dataset.pondProbeValleyArtStatus = ealdholtPondProbeValleyArtStatus(loaded.identity.valleyArtVersion, riverValley?.artVersion);
          options.host.dataset.pondProbeWidth = String(image?.width ?? 0);
          options.host.dataset.pondProbeHeight = String(image?.height ?? 0);
          options.host.dataset.pondProbeFormat = String(loaded.texture.format);
          options.host.dataset.pondProbeType = String(loaded.texture.type);
          options.host.dataset.pondProbeColorSpace = loaded.texture.colorSpace;
          options.host.dataset.pondProbeMapping = String(loaded.texture.mapping);
          options.host.dataset.pondProbeFlipY = String(loaded.texture.flipY);
          options.host.dataset.pondProbeStatus = "bound";
        } catch (error) {
          options.host.dataset.pondProbeStatus = "error";
          options.host.dataset.pondProbeError = error instanceof Error ? error.message : "Private pond reflection could not be loaded.";
          throw error;
        }
      }
      await yieldAssembly();
      reportStage('woodland');
      neutralFill = applyEaldholtNeutralFill(model);
      options.host.dataset.neutralFillMaterials = String(neutralFill.materialCount);
      if (pondShoreEnabled) {
        options.host.dataset.pondShoreStatus = 'preparing';
        try {
          abort.signal.throwIfAborted();
          if (disposed) return;
          pondShore = applyEaldholtPondShore(model, { signal: abort.signal });
          options.host.dataset.pondShoreStatus = 'applied';
          options.host.dataset.pondShoreMaterials = String(pondShore.materialCount);
          options.host.dataset.pondShorePondMaterials = String(pondShore.pondMaterials);
          options.host.dataset.pondShoreTerrainMaterials = String(pondShore.terrainMaterials);
          options.host.dataset.pondShoreGroundcoverMaterials = String(pondShore.groundcoverMaterials);
          options.host.dataset.pondShoreTextures = String(pondShore.textureCount);
          options.host.dataset.pondShoreTextureBytes = String(pondShore.textureBytes);
          options.host.dataset.pondShoreQualification = JSON.stringify(pondShore.outline);
          options.host.dataset.pondShoreField = JSON.stringify(pondShore.field);
          options.host.dataset.pondShoreSkipReasons = JSON.stringify(pondShore.diagnostics);
        } catch (error) {
          if (disposed || abort.signal.aborted) return;
          options.host.dataset.pondShoreStatus = 'unsupported';
          options.host.dataset.pondShoreError = error instanceof Error ? error.message : 'Pond shore qualification failed.';
        }
      }
      if (!distantCoast) {
        if (!riverValley) throw Error("Far surroundings require the completed local river.");
        const farProfile = riverValley.object.userData.crownfallRiverValley?.profile;
        if (farProfile !== "desktop" && farProfile !== "quest") throw Error("Far surroundings require a valid local profile.");
        const farOptions = { profile: farProfile, layeredMainland: farProfile === "desktop",
          ...(!options.authorPondProbe ? {coverage:{farDistance:11000}} : {}) };
        if (options.authorPondProbe?.profile === "quest") {
          farBridge = createEaldholtFarSurroundBridge(model, riverValley.object, farOptions);
          farProjectionPacket = farBridge.projectionPacket;
          model.add(farBridge.object);
          options.host.dataset.farSurroundMode = EALDHOLT_NATIVE_FAR_PROJECTION_READY
            ? "local-bridge-with-non-solid-projection" : "local-bridge-projection-withheld";
        } else {
          farSurround = createEaldholtFarSurround(model, riverValley.object, farOptions);
          model.add(farSurround.object);
          options.host.dataset.farSurroundMode = "geometry";
        }
        const packet = farProjectionPacket ?? farSurround?.projectionPacket;
        if (!packet) throw Error("Far geography packet was not created.");
        const local = packet.localBounds, bridge = farBridge?.bounds;
        const completeBounds = farSurround?.bounds ?? {
          min: local.min.map((v, i) => Math.min(v, bridge?.min[i] ?? v)),
          max: local.max.map((v, i) => Math.max(v, bridge?.max[i] ?? v)),
        };
        options.host.dataset.farSurroundLocalBounds = JSON.stringify(local);
        options.host.dataset.farSurroundRenderBounds = JSON.stringify(completeBounds);
        options.host.dataset.farSurroundInspectionBounds = JSON.stringify(riverInspectionBounds);
        options.host.dataset.farSurroundGeography = JSON.stringify({ version: packet.geography.version,
          axes: packet.geography.axes, sea: "west", mainland: "north-east-south", river: "east" });
        options.host.dataset.farSurroundStatus = "ready";
        options.host.dataset.farSurroundTriangles = String(farSurround?.triangles ?? farBridge?.triangles ?? 0);
        options.host.dataset.farSurroundDrawCalls = String(farSurround?.drawCalls ?? farBridge?.drawCalls ?? 0);
        options.host.dataset.farSurroundBufferBytes = String(farSurround?.bufferBytes ?? farBridge?.bufferBytes ?? 0);
        options.host.dataset.farSurroundExtraTextureBytes = "0";
        options.host.dataset.farSurroundLocalPlacementEligible = "false";
        options.host.dataset.farSurroundRelief = JSON.stringify(packet.geography.mainlandRelief ?? null);
        options.host.dataset.farWoodlandStatus = "held-quest-profile";
        if (farProfile === "desktop" && farSurround && woodland) {
          try {
            const existingPlacements = woodland.placements, existingRadius = woodland.canopyRadius;
            if (!existingPlacements || typeof existingRadius !== "number" || !Number.isFinite(existingRadius))
              throw Error("Detailed woodland requires its measured source roots and crown radius.");
            farWoodlandLod = createEaldholtBorrowedFarWoodlandPrototype(model, woodland);
            farWoodland = createEaldholtFarWoodland(model, { prototype: farWoodlandLod, materialRoot: woodland.object,
              landOwners: [riverValley.object, farSurround.object], waterOwners: [riverValley.object, farSurround.object],
              geography: packet.geography, existingPlacements,
              existingCanopyRadius: existingRadius, maximumTrees: 48, profile: "desktop", quality: quality.preset });
            model.add(farWoodland.object); reportFarWoodland();
            if (farWoodland.bounds) {
              const forestBounds = farWoodland.bounds;
              options.host.dataset.farSurroundRenderBounds = JSON.stringify({
                min: completeBounds.min.map((value, axis) => Math.min(value, forestBounds.min[axis])),
                max: completeBounds.max.map((value, axis) => Math.max(value, forestBounds.max[axis])),
              });
            }
            options.host.dataset.farWoodlandStatus = "ready";
          } catch (error) {
            releaseFarWoodland();
            if (disposed || abort.signal.aborted) throw error;
            options.host.dataset.farWoodlandStatus = "held-error";
            options.host.dataset.farWoodlandError = (error instanceof Error ? error.message : "Optional woodland failed").slice(0, 220);
          }
        }
      }
      if(!options.authorPondProbe&&farSurround&&woodland?.placements?.length&&woodland.canopyRadius){
        try{
          regionalWoodland=await loadEaldholtRegionalWoodland({sourceRoot:model,sourceWoodland:woodland.object,
            sourcePlacement:woodland.placements[0],canopyRadius:woodland.canopyRadius,
            existing:[...woodland.placements,...(farWoodland?.placements??[])],geography:farSurround.projectionPacket.geography,
            land:collectEaldholtWoodlandSurfaces(model,[riverValley!.object,farSurround.object],'terrain'),
            water:collectEaldholtWoodlandSurfaces(model,[riverValley!.object,farSurround.object],'water'),signal:abort.signal});
          model.add(regionalWoodland.object);
        }catch(error){if(abort.signal.aborted)throw error;options.host.dataset.regionalWoodland=JSON.stringify({status:'held-error',error:error instanceof Error?error.message:String(error)});}
      }

      await yieldAssembly();
      reportStage('environment');
      if (!options.authorPondProbe) {
        // Freeze the actual high actor pool before culling compacts draw slots.
        const previous = foliageDensity.diagnostics.quality; foliageDensity.setQuality('high');
        const snapshotRoot=model, valleyArtVersion=riverValley.artVersion;
        const captureSource=()=>collectVoxelRegionSource(snapshotRoot, {worldRegion: 'ealdholt-authored-region', sourceSha256,
          generatorVersion: 'world-source-v3-regional-forest:'+valleyArtVersion, backend: 'webgl2-rgba8-v1'}, abort.signal);
        const baseSource=regionalWoodland?regionalWoodland.snapshot(captureSource):captureSource();
        // Freeze the immutable GI source before wrapping any source render geometry.
        await baseSource;abort.signal.throwIfAborted();
        try{buildingDamageVisuals=createBuildingDamageVisuals({sourceRoot:model,sourceSha256,profile:sourceProfile,
          retirementFence:createWorldResourceRetirementFence(renderer,vegetationQueue),physicalCollapse:{groundHeight:emergencyGroundHeight,secondsPerWorldMinute:()=> (populationStore?.getSnapshot().clock.millisecondsPerWorldMinute??4000)/1000}});
          options.host.dataset.buildingDamage=JSON.stringify(buildingDamageVisuals.stats);
        }catch(error){options.host.dataset.buildingDamage=JSON.stringify({status:'held',error:error instanceof Error?error.message:'Source building catalogue unavailable.'});}
        try{gardenPlanting=createEaldholtGardenPlanting(model,{profile:sourceProfile});model.add(gardenPlanting.object);
          options.host.dataset.gardenPlanting=JSON.stringify(gardenPlanting.stats);
          if(gardenPlanting.anchor){gardenLife=createEaldholtGardenLife(model,{anchor:gardenPlanting.anchor});model.add(gardenLife.object);}
        }catch(error){options.host.dataset.gardenPlanting=JSON.stringify({qualified:false,holdReason:String(error)});releaseGarden();}
        const source=baseSource.then(async result=>{const forest=await regionalLightingReady;abort.signal.throwIfAborted();
          if(!forest?.layout||!forest.lightingTerrain)return result;
          return{...result,source:appendRegionalVoxelSource(result.source,forest.layout,REGIONAL_VEGETATION_PROTOTYPES,forest.lightingTerrain)};
        });
        foliageDensity.setQuality(previous);
        const sourceRoot = model, worldToSource = new Matrix4(), sunDirection = new Vector3(), target = new Vector3(), point = new Vector3();
        voxelGI = createWorldVoxelGI({sourceRoot, source, renderer, scene, camera, queue: vegetationQueue, signal: abort.signal,
          active: () => populationEntry !== null && planarPond === null,
          prepareEnabled: () => populationEntry !== null && planarPond === null && environmentFoundationsReady,
          preset: () => quality.preset, wake: requestRender, service: requestPreparationFrame,
          readCloudField: () => worldEnvironment?.cloudField ?? null,
          readSourceLighting(): VoxelLiveLight {
            sourceRoot.updateWorldMatrix(true, false); worldToSource.copy(sourceRoot.matrixWorld).invert();
            sun.getWorldPosition(sunDirection).sub(sun.target.getWorldPosition(target)).transformDirection(worldToSource);
            const local: VoxelLiveLight['local'][number][] = [];
            for (const entry of localPointLights) {
              if (local.length >= 16 || entry.light.intensity <= 0 || extinguishedAt(entry.sourcePosition)) continue;
              entry.light.getWorldPosition(point).applyMatrix4(worldToSource);
              const light = entry.light, gain = Math.min(8, light.intensity * .05);
              local.push({position: [point.x, point.y, point.z], radius: Math.max(1, light.distance || 12) * worldToSource.getMaxScaleOnAxis(),
                radiance: [light.color.r * gain, light.color.g * gain, light.color.b * gain]});
            }
            for(const light of buildingDisasterEffects?.localLights??[]){if(local.length>=16)break;local.push(light);}
            for (const light of nightLights?.lights ?? []) {
              if(local.length>=16||light.intensity<=0)continue;
              light.getWorldPosition(point).applyMatrix4(worldToSource);
              const gain=Math.min(8,light.intensity*.05);
              local.push({position:[point.x,point.y,point.z],radius:light.distance*worldToSource.getMaxScaleOnAxis(),radiance:[light.color.r*gain,light.color.g*gain,light.color.b*gain]});
            }
            return {sunDirection: [sunDirection.x, sunDirection.y, sunDirection.z],
              sunRadiance: [sun.color.r * sun.intensity, sun.color.g * sun.intensity, sun.color.b * sun.intensity],
              skyRadiance: [fill.color.r * fill.intensity, fill.color.g * fill.intensity, fill.color.b * fill.intensity], cloudTransmission: 1, local};
          }});
      }
      scene.add(model);
      collectModel();
      const regionalGeography=farSurround?.projectionPacket.geography;
      if(regionalGeography&&!options.authorPondProbe){
        regionalHorizon=createEaldholtRegionalHorizonView({geography:regionalGeography,profile:quality.preset==='low'?'quest':'desktop',rock:albedo.surfaceMaps.rock,conditions:()=>worldEnvironment?.state??null,
          renderer,scene,camera,queue:vegetationQueue,signal:abort.signal,changed:requestRender});
        model.add(regionalHorizon.object);
      }
      await yieldAssembly();
      prepareVegetationMips();
      await yieldAssembly();
      let sourcePoints = 0;
      model.traverse(object => { if (object instanceof PointLight) sourcePoints++; });
      if (sourcePoints === 0) {
        // Original GLB KHR_lights_punctual values, restored only when the
        // geometry-only derivative omitted them; these are not new lore lights.
        for (const [x, y, z] of [[-8.662, 3.145, 15.360], [18.209, 3.145, 58.852], [56.429, 3.145, 58.852]]) {
          const light = new PointLight(new Color(1, .332451522, 0), 10, 23.1726627, 2);
          light.name = "Source smithy light"; light.position.set(x, y, z); light.castShadow = false;
          model.add(light);
        }
        sourcePoints = 3;
      }
      options.host.dataset.sourcePointLights = String(sourcePoints);
      fire = createEaldholtVillageFire({ renderer });
      model.add(fire.rootObject3D);
      fire.update(0, reducedMotion);
      buildingDisasterEffects=createBuildingDisasterEffects({fire:fire.runtime,buildings:()=>buildingDamageVisuals?.buildings()??[],maxBuildings:sourceProfile==='quest'?12:24});model.add(buildingDisasterEffects.object);
      if(!options.authorPondProbe){nightLights=createVillageNightLights(model,{isExtinguished:extinguishedAt});model.add(nightLights.object);}
      // Sky effects stay outside the measured/cullable source asset bounds.
      atmosphere = createEaldholtAtmosphere({ profile: quality.preset === "low" ? "quest" : "desktop",
        ...(farProjectionPacket && EALDHOLT_NATIVE_FAR_PROJECTION_READY ? { farProjection: { source: model, packet: farProjectionPacket,
          grassMap: valleyGround?.grass?.albedo ?? null, grassTileMetres: valleyGround?.grass?.tileMetres,
          grassSourceAssetId: valleyGround?.grass?.sourceAssetId } } : {}) });
      scene.add(atmosphere.object);
      if(!options.authorPondProbe){
        worldEnvironment=createWorldEnvironment({sourceRoot:model,atmosphere:atmosphere.object,scene,renderer,camera,sun,fill,queue:vegetationQueue,signal:abort.signal,
          quality:()=>quality.preset,reducedMotion:()=>reducedMotion,changed:environmentChange,statusChanged:options.onWorldStatus,
          override:()=>observer?.override(populationStore ? getVillagePopulationTime(observed(populationStore.getSnapshot())).absoluteWorldMinute : undefined),
          readClock(){if(filmShot)return filmClockReading();if(!populationStore||!populationEntry)return null;const snapshot=observed(populationStore.getSnapshot());
            return{...worldPresentationClock.sample(snapshot,performance.now(),observer?.speed?.()??1),worldKey:populationEntry};},
          setSunDirection(direction){
            const enabled=quality.preset!=='low'&&direction.y>.035;
            if(enabled!==sunShadowActive||sunShadowNeedsRefresh(shadowSunRecorded?lastShadowSunDirection:null,direction,quality.preset))shadowDirty=true;
            daylightOffset.copy(direction).multiplyScalar(145);sun.position.copy(sun.target.position).add(daylightOffset);
            sunShadowActive=enabled;sun.shadow.intensity=enabled?1:0;
          }});
        worldRain=createWorldRain(model,camera);
        raidScene=createRaidScene(model,camera,buildingDamageVisuals?.raidSites(),fire.runtime);
      }
      options.host.dataset.cloudDrawCalls = String(atmosphere.drawCalls);
      options.host.dataset.cloudTriangles = String(atmosphere.triangles);
      options.host.dataset.cloudTextureBytesEstimate = String(atmosphere.textureBytesWithMipsEstimate);
      const hearthLights = new Set<PointLight>();
      fire.rootObject3D.traverse(object => { if (object instanceof PointLight) hearthLights.add(object); });
      model.updateMatrixWorld(true);
      const lightSource=model;
      lightSource.traverse(object => {
        if (!(object instanceof PointLight) || object.userData.crownfallNightLight || object.userData.crownfallDisasterLight) return;
        localPointLights.push({ light: object, hearth: hearthLights.has(object),
          influence: new Sphere(object.getWorldPosition(new Vector3()), object.distance || 50),
          sourcePosition:lightSource.worldToLocal(object.getWorldPosition(new Vector3())).toArray() as [number,number,number] });
      });
      options.host.dataset.totalPointLightCount = String(localPointLights.length);
      // Attach after every environment material/mesh collection step. The
      // ordinary standing prototype is never classified as world vegetation.
      reportStage('residents');
      if (residentInput && residentSourceBounds) {
        const loaded = await loadEaldholtStandingResidentPreview(residentInput, abort.signal);
        if (disposed || abort.signal.aborted) { loaded.dispose(); return; }
        residentPreview = loaded;
        assertEaldholtResidentPreviewContained(residentSourceBounds, loaded.bounds);
        model.updateMatrixWorld(true);
        conservativeSceneBounds.setFromObject(model);
        residentWorldBounds.copy(loaded.bounds).applyMatrix4(model.matrixWorld);
        conservativeSceneBounds.union(residentWorldBounds);
        if (!conservativeSceneBounds.containsBox(residentWorldBounds)) throw Error('Resident preview bounds are not conservatively contained.');
        model.add(loaded.object);
        options.host.dataset.residentPreviewStatus = 'ready';
        options.host.dataset.residentPreviewCount = '1';
        options.host.dataset.residentPreviewBoundsContained = 'true';
        options.host.dataset.residentPreviewRevision = residentInput.revision;
      }
      if (woodland && woodland.instanceCount > 0) woodlandVisibility = createEaldholtWoodlandVisibility(woodland.object);
      if (farWoodland && farWoodland.instanceCount > 0) farWoodlandVisibility = createEaldholtWoodlandVisibility(farWoodland.object);
      if (!options.authorPondProbe && (woodlandVisibility || farWoodlandVisibility)) {
        vegetationWorker = createVegetationPreparationWorker(abort.signal);
        vegetationResources = createVegetationPrototypeResources(renderer, vegetationQueue, vegetationWorker, sourceProfile === 'quest' ? 32 * 1024 * 1024 : 128 * 1024 * 1024,
          {worldRegion: 'ealdholt-authored-region', sourceSha256, backend: 'three-r185-webgl2-capture-v1'});
        const hlodOptions = {renderer, scene, camera, queue: vegetationQueue, worker: vegetationWorker, resources: vegetationResources, signal: abort.signal, changed: requestRender, atlasTileSize: (quality.preset === "low" ? 64 : 128) as 64 | 128};
        if (woodland && woodlandVisibility) treeHlod = createEaldholtTreeHlod(woodland.object, woodlandVisibility, hlodOptions);
        if (farWoodland && farWoodlandVisibility) farTreeHlod = createEaldholtTreeHlod(farWoodland.object, farWoodlandVisibility, hlodOptions);
        regionalWoodland?.start(hlodOptions);
        const regionalFrame=farSurround?.projectionPacket.geography;
        if(regionalFrame){
          regionalWorldLoading=true;
          regionalLandmarks=createRegionalLandmarks({sourceRoot:model,camera,load:(id,detail)=>loadRegionalAsset(id+'-'+(detail==='full'?'desktop':'far')+'.glb'),signal:abort.signal,changed:requestRender});model.add(regionalLandmarks.object);
          const regionalSource=model,regionalGeometryProfile=quality.preset==='low'?'quest':'desktop';
          void loadRegionalAsset(REGIONAL_VEGETATION_PROFILES[regionalGeometryProfile].file).then(prototypes=>{
            if(disposed||abort.signal.aborted||model!==regionalSource)return;
            regionalForest=createRegionalForest({sourceRoot:regionalSource,prototypes,geography:regionalFrame,realisticTreeSource,realisticForest01Source,loadScannedShrub:()=>loadRegionalAsset(SCANNED_SHRUB_ASSETS.desktop.file,SCANNED_SHRUB_ASSET_PATH,true),loadNaturalRiparian:()=>loadRegionalAssetFile(naturalRiparianAsset().file,NATURAL_RIPARIAN_ASSET_PATH),
              land:collectEaldholtWoodlandSurfaces(regionalSource,[riverValley!.object,farSurround!.object],'terrain'),landOwners:[riverValley!.object,farSurround!.object],conditions:()=>worldEnvironment?.state??null,
              loadRocks:detail=>loadRegionalAsset('rocks-'+(detail==='near'?'desktop':'far')+'.glb','assets/legacy/environment/aethelgard/namaqualand-rocks-v1/'),
              // Packed RGB/cover keeps even the legacy ground fallback within
              // WebGL2's 16 fragment-sampler minimum; retain forest floor here.
              loadLitter:()=>new TextureLoader().loadAsync(import.meta.env.BASE_URL+REGIONAL_ASSET_PATH+'textures/woodland-litter.png'),
              renderer,scene,camera,queue:vegetationQueue,worker:vegetationWorker!,signal:abort.signal,geometryProfile:regionalGeometryProfile,changed(){if(regionalForest?.layout)resolveRegionalLighting(regionalForest);else if(regionalForest?.stats.status==='held-error')resolveRegionalLighting(null);requestRender();},
              active:()=>!modelPresented||populationEntry!==null&&environmentFoundationsReady&&!planarPond});regionalSource.add(regionalForest.object);requestRender();
          }).catch(cause=>{if(!disposed)options.host.dataset.regionalForest=JSON.stringify({status:'held-error',error:String(cause)});resolveRegionalLighting(null);}).finally(()=>{regionalWorldLoading=false;requestRender();});
        }

        // One simplified model per plant cell: sliced so entry never blocks the page for long (L-24).
        let slice = performance.now();
        for (const cell of plantCells) {
          if (performance.now() - slice > 8) { await yieldAssembly(); slice = performance.now(); }
          try {sourceVegetationHlod.set(cell.object, createVegetationCellHlod(cell.object, {...hlodOptions, tileSize: cell.kind === 'groundcover' ? 64 : hlodOptions.atlasTileSize, kind: cell.kind === 'groundcover' ? 'grass' : 'tree', sourceRoot: model}));}
          catch (cause) {options.host.dataset.sourceVegetationHlodUnsupported = String(Number(options.host.dataset.sourceVegetationHlodUnsupported ?? 0) + 1); console.warn('Source vegetation cell retains authored rendering:', cause);}
        }
        farGrassLook = createGrassGroundLook(model, [...sourceVegetationHlod.values()].filter(cell => cell.stats.kind === 'grass'), {renderer, worker: vegetationWorker, queue: vegetationQueue, signal: abort.signal, changed: requestRender});
      }
      await yieldAssembly();
      if (!options.authorPondProbe) {
        try {
          terrainStream = createAuthoredTerrainStream({sourceRoot: model, renderer, scene, camera, queue: vegetationQueue,
            maximumBytes: sourceProfile === 'quest' ? 16 * 1024 * 1024 : 64 * 1024 * 1024,
            wake: requestRender, service: requestPreparationFrame,
            active: () => populationEntry !== null && planarPond === null,
            prepareEnabled: () => populationEntry !== null && planarPond === null && vegetationSettled()});
        } catch (cause) {options.host.dataset.terrainStreamingError = cause instanceof Error ? cause.message : String(cause);}
      }
      if(!regionalWorldLoading&&!regionalForest)resolveRegionalLighting(null);
      if (!options.authorPondProbe) architectureSuffix = createAuthoredArchitectureSuffixVisibility({sourceRoot:model, sourceSha256,
        renderer,scene,camera,active:()=>planarPond===null});
      modelAssembled=true;
      reportStage('assembly',0);
      setQuality(quality);
      if (import.meta.env.DEV && options.authorPondProbe) {
        const author = options.authorPondProbe;
        const { captureEaldholtPondProbe, inspectEaldholtPondProbeSurfaces } = await import("./pond-probe-authoring");
        if (disposed) return;
        const visibility = plantCells.map(cell => cell.object.visible);
        const previousTarget = controls.target.clone(), previousPosition = camera.position.clone();
        const previousDensity = foliageDensity.diagnostics.quality;
        try {
          foliageDensity.setQuality("high"); farWoodland?.setQuality("high");
          woodlandVisibility?.restore("high"); farWoodlandVisibility?.restore("high"); reportFarWoodland();
          const inspection = inspectEaldholtPondProbeSurfaces(model);
          const pond = inspection.sourcePosition.clone().applyMatrix4(model.matrixWorld);
          controls.target.copy(pond); camera.position.copy(pond).add(new Vector3(10, 5, 8)
            .multiplyScalar(inspection.worldScale).applyQuaternion(inspection.sourceOrientation));
          // A local radiance probe sees all nearby source vegetation around it,
          // independently of the main camera's current frustum and distance LOD.
          for (const cell of plantCells) cell.object.visible = cell.box.distanceToPoint(pond) <= 80 * inspection.worldScale;
          updateShadows(true);
          author.onCapture(captureEaldholtPondProbe(renderer, scene, { authoringOnly: true,
            sourceModel: model, profile: author.profile, modelSha256: author.modelSha256,
            lightingVersion: author.lightingVersion, valleyArtVersion: riverValley?.artVersion }));
        } catch (error) { author.onError(error); }
        finally {
          foliageDensity.setQuality(previousDensity); farWoodland?.setQuality(quality.preset); reportFarWoodland();
          for (let i = 0; i < plantCells.length; i++) plantCells[i].object.visible = visibility[i];
          controls.target.copy(previousTarget); camera.position.copy(previousPosition);
          shadowDirty = true; updateShadows(true);
        }
      }
      readyPending = true;
      void startPopulation();
      requestRender();
    } catch (error) {
      if (!disposed && !(error instanceof DOMException && error.name === "AbortError")) {
        architectureSuffix?.dispose(); architectureSuffix = null;
        stopPopulation(); populationStatus = 'error'; reportPopulation();
        residentPreview?.dispose(); residentPreview = null; lastResidentTick = 0;
        if (options.host.dataset.residentPreviewStatus === 'loading' || options.host.dataset.residentPreviewStatus === 'ready') {
          options.host.dataset.residentPreviewStatus = 'error';
          options.host.dataset.residentPreviewError = error instanceof Error ? error.message : 'Private resident preview loading failed.';
        }
        options.host.dataset.residentPreviewCount = '0'; options.host.dataset.residentPreviewBoundsContained = 'false';
        options.host.dataset.residentPreviewRevision = '';
        terrainStream?.dispose(); terrainStream = null;
        releaseRegionalWorld();
      regionalWoodland?.dispose();regionalWoodland=null;
      regionalHorizon?.dispose(); regionalHorizon = null;
        atmosphere?.dispose(); atmosphere = null;
        releaseFarWoodland();
        farBridge?.dispose(); farBridge = null; farSurround?.dispose(); farSurround = null; farProjectionPacket = null;
        options.host.dataset.farSurroundStatus = "disposed";
        nightLights?.dispose(); nightLights = null;
        buildingDisasterEffects?.dispose();buildingDisasterEffects=null;
      fire?.dispose(); fire = null;
        releasePlanarPond();modelAssembled=false;
        pondShore?.dispose(); pondShore = null;
        if (pondShoreEnabled && options.host.dataset.pondShoreStatus !== 'unsupported') {
          options.host.dataset.pondShoreStatus = 'rolled-back'; options.host.dataset.pondShoreError = 'Village setup did not finish.';
        }
        farGrassLook?.dispose(); farGrassLook = null;
      for (const tree of sourceVegetationHlod.values()) tree.dispose(); sourceVegetationHlod.clear();
        treeHlod?.dispose(); treeHlod = null; vegetationResources?.dispose(); vegetationResources = null; vegetationWorker?.dispose(); vegetationWorker = null;
        voxelGI?.dispose(); voxelGI = null; releaseGarden();
        neutralFill?.dispose(); neutralFill = null;
        coverageMips?.dispose(); coverageMips = null;
        if (coverageMipsEnabled && options.host.dataset.coverageMipsStatus !== 'error') {
          options.host.dataset.coverageMipsStatus = 'rolled-back'; options.host.dataset.coverageMipsError = 'Village setup did not finish.';
        }
        pondProbe?.dispose(); pondProbe = null;
        ownedPondProbe?.dispose(); ownedPondProbe = null;
        options.host.dataset.pondProbeMaterials = "0";
        if (options.host.dataset.pondProbeStatus === "bound") {
          options.host.dataset.pondProbeStatus = "error";
          options.host.dataset.pondProbeError = "Village setup failed after the configured pond reflection loaded.";
        }
        exportRepairs?.dispose(); exportRepairs = null;
        foliageDensity?.dispose(); foliageDensity = null;
        woodlandUnderstory?.dispose(); woodlandUnderstory = null;
        riverMargin?.dispose(); riverMargin = null;
        woodlandVisibility?.dispose(); woodlandVisibility = null;
        woodland?.dispose(); woodland = null;
        outerContinuation?.dispose(); outerContinuation = null;
        options.host.dataset.outerContinuationStatus = "rolled-back";
        coastalContinuity?.dispose(); coastalContinuity = null;
        options.host.dataset.coastalContinuityStatus = "rolled-back";
        bankLandform?.dispose(); bankLandform = null;
        options.host.dataset.bankLandformStatus = "rolled-back";
        distantCoast?.dispose(); distantCoast = null;
        riverValley?.dispose(); riverValley = null;
        valleyGround?.dispose(); valleyGround = null;
        options.host.dataset.valleyGrassStatus = "rolled-back";
        riverInspectionBounds = null;
        if (options.host.dataset.distantCoastStatus !== "disabled") options.host.dataset.distantCoastStatus = "error";
        groundAlbedo?.dispose(); groundAlbedo = null;
        groundLook?.dispose(); groundLook = null;
        waterLook?.dispose(); waterLook = null; openWater?.dispose(); openWater = null;
        vegetationQueue.dispose();
        if (model) { const retiring=model;scene.remove(retiring);model=null;retireSourceModel(retiring); }
        releaseMipCanvases();
        localPointLights.length = 0;
        options.onError();
      }
    }
  })();

  // DEV only. The House Ealdholt opening film is shot in this renderer, so the film looks like the village the player
  // enters straight after it (cines-engine, films/crownfall-ealdholt-opening/tools/shoot.mjs). With ?ealdholtFilm=1
  // in the address, the shooting script takes the camera and the observed clock: for each frame it sets the pose, the
  // village time and the sky, waits until the world has settled, and captures the canvas. Production builds never
  // create the hook, and nothing it does is saved: the observed clock never enters the population store.
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).get('ealdholtFilm') === '1') {
    let filmMilliseconds = 0, filmSky: WorldEnvironmentOverride = { weather: 'clear' };
    const link: VillageObserverLink = { simulatedMilliseconds: () => filmMilliseconds, override: () => filmSky, speed: () => 1 };
    const filmHook = {
      /** Takes the camera and the clock from the player. */
      take(): void {
        filmShot = { link, skyMinute: 540, seconds: 0, population: null, resident: null }; followId = null; poseTransition = null; controls.enabled = false; controls.enableDamping = false;
        observer = link; observedSnapshot = null; populationObservationPump.clear(); observationDemand.cancel();
        if (populationStore) updateObserved(populationStore.getSnapshot());
        requestRender();
      },
      /** Position and orientation (quaternion x, y, z, w) in the village model's metres; focus steers shadows and detail. */
      pose(position: readonly number[], quaternion: readonly number[], fov: number, focus: readonly number[], near = .15): void {
        if (!filmShot) return;
        camera.position.fromArray(position); camera.quaternion.fromArray(quaternion);
        camera.fov = fov; camera.near = near; controls.target.fromArray(focus); viewShift = 0;
        // every film frame has its own shadow focus: a map kept from an earlier frame would slide under the camera
        shadowDirty = true; updateProjection(); camera.updateMatrixWorld(); requestRender();
      },
      /** residentMilliseconds: the villagers' observed time in the store's simulated milliseconds (forward only).
       * skyMinute: the absolute village minute the sun and light stand at. seconds: animation time. sky: the weather. */
      clock(frame: { residentMilliseconds: number; skyMinute: number; seconds: number; sky: WorldEnvironmentOverride }): void {
        if (!filmShot) return;
        filmMilliseconds = Math.max(filmMilliseconds, Math.round(frame.residentMilliseconds)); filmSky = frame.sky;
        filmShot.skyMinute = frame.skyMinute; filmShot.seconds = frame.seconds;
        if (populationStore) updateObserved(populationStore.getSnapshot());
        populationObservationPump.wake(); requestRender();
      },
      /** What still has to settle before a frame is a faithful picture of this pose and time. */
      state() {
        const observation = observedSnapshot ? getVillagePopulationObservationStatus(observedSnapshot) : undefined;
        const store = populationStore?.getSnapshot();
        return { presented: modelPresented, renders, dirty, frameQueued: frame !== 0,
          gpuPending: gpuFrame.stats.pending, preparationPending: vegetationQueue.pending,
          observationPending: observation?.pendingMilliseconds ?? null,
          storeMilliseconds: store?.clock.simulatedElapsedMilliseconds ?? null,
          initialDayMinute: store?.clock.initialDayMinute ?? null, millisecondsPerWorldMinute: store?.clock.millisecondsPerWorldMinute ?? null,
          environment: worldEnvironment?.state ? { hour: worldEnvironment.state.hour, minute: worldEnvironment.state.minute,
            daylight: worldEnvironment.state.daylight, sunIntensity: worldEnvironment.state.sunIntensity } : null,
          materialProgramsPending: worldEnvironment?.stats.materialProgramsPending ?? null,
          queue: vegetationQueue.stats, gpu: gpuFrame.stats, populationStatus,
          vegetationTransition, population: population?.snapshot ? { selected: population.snapshot.selected,
            drawn: population.snapshot.crowd.drawn + population.snapshot.household.drawn } : null };
      },
      render(): void { requestRender(); },
    };
    (window as unknown as { __ealdholtFilm?: typeof filmHook }).__ealdholtFilm = filmHook;
  }

  return {
    setActive(next) {
      gardenSound?.setActive(next);
      active = next;
      if (next) populationObservationPump.wake(); else { populationObservationPump.pause(); observationDemand.cancel(); }
      if(next)preparationPump?.wake();else preparationPump?.pause();reportPreparationPump();
      population?.setActive(next && populationStatus !== 'error'); lastPopulationTick = 0;
      lastFireTick = 0;
      lastResidentTick = 0;
      if(!next)planarRedraw.cancel();
      if (!next && frame) { cancelAnimationFrame(frame); frame = 0; }
      if (next) requestRender();
    },
    setInteractive(next) { controls.enabled = next; },
    setReducedMotion(next) {
      reducedMotion = next;
      lastFireTick = 0;
      lastResidentTick = 0;
      fire?.update(fireTime, next,extinguishedAt,worldEnvironment?.state);
      if (next && poseTransition) {
        camera.position.copy(poseTransition.position);
        controls.target.copy(poseTransition.target);
        viewShift = poseTransition.shift;
        poseTransition = null;
        updateProjection();
        controls.update();
      }
      controls.enableDamping = !next && !poseTransition;
      requestRender();
    },
    setQuality,
    setPanelMode,
    setView(id) {
      const pose = id === "riverside" && riverValley ? riverValley.viewpoint : EALDHOLT_VILLAGE_VIEWS.find(value => value.id === id);
      if (!pose) return;
      selectedView = id;
      poseTransition = null;
      controls.enableDamping = false;
      controls.update();
      villagePosition.fromArray(pose.position);
      villageTarget.fromArray(pose.target);
      villageFov = pose.fov;
      camera.fov = villageFov;
      controls.target.copy(villageTarget);
      camera.position.copy(villagePosition);
      viewShift = 0;
      updateProjection();
      controls.update();
      controls.enableDamping = !reducedMotion;
      shadowDirty = true;
      requestRender();
    },
    resetView,
    setObserver(next) { if (disposed || filmShot && next !== filmShot.link) return; observer = next;
      options.host.dataset.worldObserverLinked=String(next!==null);
      observedSnapshot = null; populationObservationPump.clear(); observationDemand.cancel(); if (populationStore) updateObserved(populationStore.getSnapshot()); requestRender(); },
    sampleResidents() {
      if (disposed || !populationStore || !populationEntry) return null;
      if (population?.sample) return population.sample;
      return sampleVillagePopulationRuntime(observed(populationStore.getSnapshot()), populationSite);
    },
    readCanonicalPopulation(){return disposed?null:populationStore?.getSnapshot()??null;},
    readObservedPopulation(){return disposed||!populationStore?null:observed(populationStore.getSnapshot());},
    buildingDisasterSource(incidents){
      if(disposed||!emergencySites||!populationInput||!buildingDamageVisuals||buildingDamageVisuals.stats.retirement!=='active')return null;
      const canonical=populationStore?.getSnapshot(),site=populationSite??emergencySites.site;
      const navigation=canonical?.navigation.profile===site.profile?canonical.navigation:canonical?.navigationOther?.profile===site.profile?canonical.navigationOther:null;
      const identity=`${site.profile}:${site.sourceSha256}:${site.navigationRevision??'source-site'}`;
      if(!canonical||navigation?.sourceSha256!==site.sourceSha256||navigation.siteIdentity!==identity||!sameVillageSiteNavigationAllocation(navigation.navigationAllocation,site.navigationAllocation))return null;
      return{buildings:buildingDamageVisuals.buildings(),site,siteIdentity:populationInput.site.sha256,workplaceFrame:workplaces?.frame,
        associations:emergencySites.associations,stations:emergencySites.stationsFor(incidents),fireHazardsFor:binding=>emergencySites?.fireHazardsFor(binding)??[],obstacles:buildingDamageVisuals.navigationObstacles().filter(c=>c.state!=='restored').map(c=>({id:'building-debris:'+c.id,sourceSha256:c.binding.sourceSha256,profile:c.binding.profile,activeFromAbsoluteMinute:c.activeFromAbsoluteMinute,bounds:c.bounds})),groundHeight:emergencyGroundHeight};
    },
    inspectBuilding(binding){
      if(disposed||!model)return false;
      const building=buildingDamageVisuals?.buildings().find(b=>buildingDamageKey(b.binding)===buildingDamageKey(binding)&&b.binding.siteIndex===binding.siteIndex);
      if(!building)return false;
      followId=null;poseTransition=null;controls.enableDamping=false;controls.update();
      const b=building.bounds,width=Math.max(b.max[0]-b.min[0],b.max[2]-b.min[2]),height=b.max[1]-b.min[1],distance=Math.max(12,width*1.65,height*1.4);
      controls.target.copy(model.localToWorld(new Vector3(building.position[0],b.min[1]+height*.38,building.position[2])));
      camera.position.copy(model.localToWorld(new Vector3(building.position[0]+building.outward[0]*distance,b.min[1]+Math.max(6,height*.85),building.position[2]+building.outward[2]*distance)));
      camera.fov=48;viewShift=0;updateProjection();controls.update();controls.enableDamping=!reducedMotion;shadowDirty=true;requestRender();return true;
    },
    residentAvailability(residentId) {
      return population?.residentAvailability(residentId) ?? pendingVillageResidentAvailability(residentId,
        lastFrameSample?.residents.find(row => row.residentId === residentId));
    },
    raidSites() { if(disposed)return []; return observer?.buildingConditions ? (buildingDamageVisuals?.stats.retirement==='active'?buildingDamageVisuals.sites():[]) : raidScene?.sites() ?? []; },
    project(point, out) {
      if (disposed || !model) return false;
      model.localToWorld(projectPoint.set(point[0], point[1], point[2]));
      out.distance = projectPoint.distanceTo(camera.position);
      projectPoint.project(camera);
      if (projectPoint.z > 1 || projectPoint.z < -1) return false;
      out.x = (projectPoint.x * .5 + .5) * options.host.clientWidth; out.y = (-projectPoint.y * .5 + .5) * options.host.clientHeight;
      return true;
    },
    voiceAnchor(placeId, residentId) {
      if (disposed || !model || !raidScene) return null; // the world is ready once the raid scene exists
      villageAnchors ??= createVillageAnchors(model);
      const point = villageAnchors.anchor(placeId, residentId);
      return point ? [point.x, point.y, point.z] : null;
    },
    follow(residentId) {
      followId = residentId; requestRender();
      return !residentId || qualifiedResidentFollowPosition(population?.residentAvailability(residentId) ?? null) !== null;
    },
    setPopulationEntry(worldKey) {
      if (disposed || options.authorPondProbe || populationEntry === worldKey) return;
      stopPopulation(); populationEntry = worldKey;
      populationStatus = worldKey ? 'waiting-model' : 'entry-required'; populationError = '';
      reportPopulation(); if (worldKey) void startPopulation(); requestRender();
    },
    orbit(yaw, pitch, zoom = 0) {
      if (disposed || !active || !controls.enabled) return;
      const offset = camera.position.clone().sub(controls.target);
      const spherical = new Spherical().setFromVector3(offset);
      spherical.theta += yaw * 1.7;
      spherical.phi = Math.max(controls.minPolarAngle, Math.min(controls.maxPolarAngle, spherical.phi + pitch * 1.4));
      spherical.radius = Math.max(controls.minDistance, Math.min(controls.maxDistance, spherical.radius * Math.exp(zoom * 1.8)));
      camera.position.copy(controls.target).add(new Vector3().setFromSpherical(spherical));
      controls.update();
      requestRender();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      architectureSuffix?.dispose(); architectureSuffix = null;
      delete options.host.dataset.architectureSuffixVisibility;
      delete options.host.dataset.worldResidentFollow;
      preparationPump?.dispose();preparationPump=null;
      drawDiagnostics?.dispose();bankMaterialDiagnostics?.dispose();if(graphicsTracing&&options.host.dataset.worldBankMaterial===lastBankMaterialDiagnostics)delete options.host.dataset.worldBankMaterial;
      if(graphicsTracing&&options.host.dataset.worldDrawAttribution===lastDrawDiagnostics)delete options.host.dataset.worldDrawAttribution;
      gpuFrame.dispose();
      abort.abort();
      stopPopulation(); populationObservationPump.dispose(); populationStatus = 'disposed'; reportPopulation();
      if (frame) cancelAnimationFrame(frame);
      controls.removeEventListener("change", cameraChanged);
      controls.removeEventListener("start", cameraDragStarted);
      controls.removeEventListener("end", cameraDragEnded);
      controls.dispose();
      resizeObserver.disconnect();
      residentPreview?.dispose(); residentPreview = null; lastResidentTick = 0;
      options.host.dataset.residentPreviewStatus = 'disposed'; options.host.dataset.residentPreviewCount = '0';
      options.host.dataset.residentPreviewBoundsContained = 'false';
      options.host.dataset.residentPreviewRevision = '';
      terrainStream?.dispose(); terrainStream = null;
      releaseRegionalWorld();
      regionalWoodland?.dispose();regionalWoodland=null;
      regionalHorizon?.dispose(); regionalHorizon = null;
      atmosphere?.dispose(); atmosphere = null;
      releaseFarWoodland();
      farBridge?.dispose(); farBridge = null; farSurround?.dispose(); farSurround = null; farProjectionPacket = null;
      options.host.dataset.farSurroundStatus = "disposed";
      nightLights?.dispose(); nightLights = null;
      buildingDisasterEffects?.dispose();buildingDisasterEffects=null;
      fire?.dispose(); fire = null;
      releasePlanarPond();modelAssembled=false;
      options.host.dataset.planarPondStatus='disposed';options.host.dataset.planarPondSize='0';
      pondShore?.dispose(); pondShore = null; options.host.dataset.pondShoreStatus = 'disposed';
      farGrassLook?.dispose(); farGrassLook = null;
      for (const tree of sourceVegetationHlod.values()) tree.dispose(); sourceVegetationHlod.clear();
      treeHlod?.dispose(); treeHlod = null; vegetationResources?.dispose(); vegetationResources = null; vegetationWorker?.dispose(); vegetationWorker = null;
      voxelGI?.dispose(); voxelGI = null; releaseGarden();
      neutralFill?.dispose(); neutralFill = null;
      coverageMips?.dispose(); coverageMips = null;
      options.host.dataset.coverageMipsStatus = 'disposed';
      pondProbe?.dispose(); pondProbe = null;
      ownedPondProbe?.dispose(); ownedPondProbe = null;
      options.host.dataset.pondProbeStatus = "disposed";
      options.host.dataset.pondProbeMaterials = "0";
      exportRepairs?.dispose(); exportRepairs = null;
      foliageDensity?.dispose(); foliageDensity = null;
      woodlandUnderstory?.dispose(); woodlandUnderstory = null;
      riverMargin?.dispose(); riverMargin = null;
      woodlandVisibility?.dispose(); woodlandVisibility = null;
      woodland?.dispose(); woodland = null;
      outerContinuation?.dispose(); outerContinuation = null;
      options.host.dataset.outerContinuationStatus = "disposed";
      coastalContinuity?.dispose(); coastalContinuity = null;
      options.host.dataset.coastalContinuityStatus = "disposed";
      bankLandform?.dispose(); bankLandform = null;
      options.host.dataset.bankLandformStatus = "disposed";
      distantCoast?.dispose(); distantCoast = null;
      riverValley?.dispose(); riverValley = null;
      valleyGround?.dispose(); valleyGround = null;
      options.host.dataset.valleyGrassStatus = "disposed";
      riverInspectionBounds = null;
      options.host.dataset.distantCoastStatus = "disposed";
      groundAlbedo?.dispose(); groundAlbedo = null;
      groundLook?.dispose(); groundLook = null;
      waterLook?.dispose(); waterLook = null; openWater?.dispose(); openWater = null;
      vegetationQueue.dispose();
      if (model) { const retiring=model;scene.remove(retiring);model=null;retireSourceModel(retiring); }
      releaseMipCanvases();
      sourceTextures.clear(); plantCells.length = 0; plantCellVersion++; shadowMeshes.length = 0; casterOrder.length = 0; shadowCasterVersion++;
      localPointLights.length = 0;
      scene.environment = null; scene.background = null;
      environment.dispose(); panorama.dispose();
      sun.shadow.map?.dispose();
      renderer.domElement.remove();
      const retireRenderer = () => { renderer.dispose(); renderer.forceContextLoss(); };
      void Promise.all([sourceRetirement,buildingRetirement,vegetationQueue.whenIdle()]).then(retireRenderer).catch(()=>{options.host.dataset.buildingDamageRetirement='held-error';});
      delete options.host.dataset.modelReady;
    },
  };
}
