import { matchesEaldholtZeroAoDefect, matchesEaldholtZeroSheenRoughnessDefect, type EaldholtMaterialFingerprint } from "./export-repair-metadata";

export const EALDHOLT_SHEEN_ROUGHNESS_FLOOR = 0.07;
export const EALDHOLT_SHEEN_FLOOR_CACHE_KEY = ":ealdholt-audited-sheen-floor:v1";

/** Apply after Three has sampled the sheen roughness map. The original map,
 * sheen colour/amount and every light/shadow remain unchanged. */
export function patchEaldholtSheenRoughnessShader(shader: { fragmentShader: string }): void {
  if (shader.fragmentShader.includes("CROWNFALL_AUDITED_SHEEN_ROUGHNESS_FLOOR")) return;
  const seam = "#include <lights_physical_fragment>";
  if (shader.fragmentShader.split(seam).length !== 2) throw new Error("Audited sheen repair requires one physical-light material seam.");
  shader.fragmentShader = shader.fragmentShader.replace(seam, `${seam}
#ifdef USE_SHEEN
#define CROWNFALL_AUDITED_SHEEN_ROUGHNESS_FLOOR
material.sheenRoughness = max(material.sheenRoughness, ${EALDHOLT_SHEEN_ROUGHNESS_FLOOR});
#endif`);
}

export interface EaldholtExportRepairHandle {
  readonly ownedReplacementCount: number;
  readonly sheenRoughnessFloorCount: number;
  dispose(): void;
}

/** Confirm exact zero alpha on the audited128/256px maps. Unknown/unreadable
 * images opt out. The bitmap stays borrowed; only a temporary CPU canvas exists. */
export function isEaldholtZeroSheenRoughnessImage(image: unknown): boolean {
  if (!image || typeof image !== "object") return false;
  const value = image as { width?: number; height?: number; data?: unknown };
  if (![128, 256].includes(value.width ?? 0) || value.height !== value.width) return false;
  const pixels = (data: ArrayLike<number>) => {
    if (data.length !== value.width! * value.height! * 4) return false;
    for (let i = 3; i < data.length; i += 4) if (data[i] === 0) return true;
    return false;
  };
  if (value.data instanceof Uint8Array || value.data instanceof Uint8ClampedArray) return pixels(value.data);
  const canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(value.width!, value.height!)
    : typeof document !== "undefined" ? document.createElement("canvas") : null;
  if (!canvas) return false;
  canvas.width = value.width!; canvas.height = value.height!;
  try {
    const context = canvas.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!context) return false;
    context.drawImage(image as CanvasImageSource, 0, 0);
    return pixels(context.getImageData(0, 0, canvas.width, canvas.height).data);
  } catch { return false; }
  finally { canvas.width = 0; canvas.height = 0; }
}

/** Verify the actual 1x1 opaque-black fallback, never infer it from a name alone.
 * ImageBitmaps stay borrowed. A temporary CPU canvas is used only when pixels
 * are not already available; unreadable/unknown images safely opt out. */
export function isEaldholtZeroAoImage(image: unknown): boolean {
  if (!image || typeof image !== "object") return false;
  const candidate = image as { width?: number; height?: number; data?: unknown };
  if (candidate.width !== 1 || candidate.height !== 1) return false;
  const isBlack = (data: ArrayLike<number>) => data.length === 4
    && data[0] === 0 && data[1] === 0 && data[2] === 0 && data[3] === 255;
  if (candidate.data instanceof Uint8Array || candidate.data instanceof Uint8ClampedArray) return isBlack(candidate.data);
  const canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(1, 1)
    : typeof document !== "undefined" ? document.createElement("canvas") : null;
  if (!canvas) return false;
  canvas.width = 1; canvas.height = 1;
  try {
    const context = canvas.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!context) return false;
    context.drawImage(image as CanvasImageSource, 0, 0);
    return isBlack(context.getImageData(0, 0, 1, 1).data);
  } catch { return false; }
  finally { canvas.width = 0; canvas.height = 0; }
}

export interface EaldholtRepairMesh<M> {
  readonly name: string;
  material: M | M[];
}
export interface EaldholtRepairAdapter<M> {
  fingerprint(material: M): EaldholtMaterialFingerprint | null;
  aoImage(material: M): unknown;
  clone(material: M): M;
  disableAo(material: M): void;
  sheenRoughnessImage?(material: M): unknown;
  floorSheenRoughness?(material: M): void;
  dispose(material: M): void;
}

/** Engine-independent ownership logic; adapters retain their own Three runtime.
 * Each repaired material is cloned once per invocation and shared only among
 * matching meshes in this hierarchy. Arrays and cached originals stay intact. */
export function applyEaldholtExportRepairsToMeshes<M>(
  meshes: readonly EaldholtRepairMesh<M>[], adapter: EaldholtRepairAdapter<M>,
): EaldholtExportRepairHandle {
  const owned = new Map<M, M>();
  const assignments: { mesh: EaldholtRepairMesh<M>; original: M | M[]; replacement: M | M[] }[] = [];
  const imageChecks = new WeakMap<object, boolean>();
  const sheenImageChecks = new WeakMap<object, boolean>();
  let sheenRoughnessFloorCount = 0;
  let disposed = false;
  function dispose(): void {
    if (disposed) return;
    disposed = true;
    for (let i = assignments.length - 1; i >= 0; i--) {
      const assignment = assignments[i];
      // Do not overwrite a newer assignment made by another owner.
      if (assignment.mesh.material === assignment.replacement) assignment.mesh.material = assignment.original;
    }
    for (const material of owned.values()) adapter.dispose(material);
    assignments.length = 0; owned.clear();
  }
  function replacement(mesh: EaldholtRepairMesh<M>, original: M): M {
    const fingerprint = adapter.fingerprint(original);
    if (!fingerprint || !matchesEaldholtZeroAoDefect(mesh.name, fingerprint)) return original;
    const image = adapter.aoImage(original);
    if (!image || typeof image !== "object") return original;
    let zero = imageChecks.get(image);
    if (zero === undefined) { zero = isEaldholtZeroAoImage(image); imageChecks.set(image, zero); }
    if (!zero) return original;
    const existing = owned.get(original);
    if (existing) return existing;
    const clone = adapter.clone(original);
    if (clone === original) throw new Error("An export repair must own a separate material clone.");
    owned.set(original, clone);
    adapter.disableAo(clone);
    if (adapter.floorSheenRoughness && adapter.sheenRoughnessImage && matchesEaldholtZeroSheenRoughnessDefect(mesh.name, fingerprint)) {
      const image = adapter.sheenRoughnessImage(original);
      if (image && typeof image === "object") {
        let zero = sheenImageChecks.get(image);
        if (zero === undefined) { zero = isEaldholtZeroSheenRoughnessImage(image); sheenImageChecks.set(image, zero); }
        if (zero) { adapter.floorSheenRoughness(clone); sheenRoughnessFloorCount++; }
      }
    }
    return clone;
  }
  try {
    for (const mesh of meshes) {
      const original = mesh.material;
      const result = Array.isArray(original) ? original.map(material => replacement(mesh, material)) : replacement(mesh, original);
      const changed = Array.isArray(original) && Array.isArray(result)
        ? result.some((material, i) => material !== original[i]) : result !== original;
      if (!changed) continue;
      assignments.push({ mesh, original, replacement: result });
      mesh.material = result;
    }
  } catch (error) { dispose(); throw error; }
  return { ownedReplacementCount: owned.size, sheenRoughnessFloorCount, dispose };
}
