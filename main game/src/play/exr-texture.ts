/**
 * The arena's EXR files (its light textures and its panorama), fetched with progress and a way to call them off, and
 * decoded in a worker (A-22): decoded on the main thread, as EXRLoader.loadAsync does, each blocked it for 0.3-0.9 s.
 * The texture is set up as EXRLoader sets it up (half float, linear filtering, no mip levels, rows bottom-up unless
 * `flip` turns them over for glTF's second UV set), so what is drawn does not change.
 */
import * as THREE from "three";
import { flipRowsInPlace } from "./lightmap-rows";

export interface ExrJob { buffer: ArrayBuffer; flip: boolean }
export type ExrReply =
  | { ok: true; width: number; height: number; data: Uint16Array; format: number; colorSpace: string }
  | { ok: false; message: string };
type Decoded = Extract<ExrReply, { ok: true }>;

export interface ExrOptions {
  signal?: AbortSignal;
  /** Bytes in hand and the file's size (0 while the server has not said). */
  onProgress?(loaded: number, total: number): void;
  /** Turn the rows over (a lightmap read through glTF's second UV set). */
  flip?: boolean;
}

const aborted = () => new DOMException("The load was called off.", "AbortError");

/** The whole response body, reporting its progress as it comes. */
export async function fetchBytes(url: string, { signal, onProgress }: Pick<ExrOptions, "signal" | "onProgress"> = {}): Promise<ArrayBuffer> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Could not load ${url}: HTTP ${response.status}`);
  const total = Number(response.headers.get("content-length")) || 0;
  if (!response.body || !onProgress) { const buffer = await response.arrayBuffer(); onProgress?.(buffer.byteLength, buffer.byteLength); return buffer; }
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let loaded = 0;
  onProgress(0, total);
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value); loaded += value.byteLength;
    onProgress(loaded, total);
  }
  if (parts.length === 1 && parts[0]!.byteOffset === 0 && parts[0]!.byteLength === parts[0]!.buffer.byteLength) return parts[0]!.buffer as ArrayBuffer;
  const whole = new Uint8Array(loaded);
  let at = 0;
  for (const part of parts) { whole.set(part, at); at += part.byteLength; }
  return whole.buffer;
}

/** Decodes in a worker of its own, which is let go once it answers (or the load is called off). */
function decodeInWorker(buffer: ArrayBuffer, flip: boolean, signal?: AbortSignal): Promise<Decoded> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try { worker = new Worker(new URL("./exr.worker.ts", import.meta.url), { type: "module", name: "crownfall-exr" }); }
    catch (cause) { reject(cause); return; }
    let settled = false;
    const finish = (error: unknown, value?: Decoded) => {
      if (settled) return;
      settled = true; signal?.removeEventListener("abort", cancel); worker.terminate();
      if (error) reject(error); else resolve(value!);
    };
    const cancel = () => finish(aborted());
    signal?.addEventListener("abort", cancel, { once: true });
    worker.onmessage = (event: MessageEvent<ExrReply>) => event.data.ok ? finish(null, event.data) : finish(new Error(event.data.message));
    worker.onerror = (event) => { event.preventDefault(); finish(new Error(`EXR worker failed: ${event.message}`)); };
    worker.onmessageerror = () => finish(new Error("EXR worker reply could not be read"));
    if (signal?.aborted) cancel();
    else worker.postMessage({ buffer, flip } satisfies ExrJob, [buffer]);
  });
}

/** The same decode on this thread: where there are no module workers (node), or a worker could not start. */
async function decodeHere(buffer: ArrayBuffer, flip: boolean): Promise<Decoded> {
  const { EXRLoader } = await import("three/examples/jsm/loaders/EXRLoader.js");
  const decoded = new EXRLoader().setDataType(THREE.HalfFloatType).parse(buffer) as unknown as Decoded;
  if (flip) flipRowsInPlace(decoded.data, decoded.height);
  return decoded;
}

/** A texture made from decoded EXR pixels, set up exactly as EXRLoader (through DataTextureLoader) sets one up. */
export function exrTexture(decoded: Pick<Decoded, "width" | "height" | "data" | "format" | "colorSpace">): THREE.DataTexture {
  const texture = new THREE.DataTexture(decoded.data, decoded.width, decoded.height, decoded.format as THREE.PixelFormat, THREE.HalfFloatType);
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.anisotropy = 1;
  texture.colorSpace = decoded.colorSpace as THREE.ColorSpace;
  texture.flipY = false;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

export async function loadExrTexture(url: string, options: ExrOptions = {}): Promise<THREE.DataTexture> {
  const { signal, flip = false } = options;
  if (signal?.aborted) throw aborted();
  const buffer = await fetchBytes(url, options);
  if (signal?.aborted) throw aborted();
  let decoded: Decoded;
  if (typeof Worker === "undefined") decoded = await decodeHere(buffer, flip);
  else {
    // The worker takes the buffer. In the rare case of a worker that cannot start or fails, the file is fetched
    // again (the browser has it) and decoded here.
    try { decoded = await decodeInWorker(buffer, flip, signal); }
    catch (cause) {
      if (signal?.aborted || (cause instanceof DOMException && cause.name === "AbortError")) throw cause;
      console.warn("[exr] worker decode unavailable; decoding on the main thread", cause);
      decoded = await decodeHere(await fetchBytes(url, { signal }), flip);
    }
  }
  if (signal?.aborted) throw aborted();
  return exrTexture(decoded);
}
