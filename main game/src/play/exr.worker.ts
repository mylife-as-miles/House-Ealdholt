/**
 * Decodes one EXR file off the main thread (A-22): the arena's light textures and its panorama are 2048² and larger,
 * and EXRLoader.parse took 0.3-0.9 s of blocked main thread each. The half-float pixels go back as a transferred buffer.
 */
import { HalfFloatType } from "three";
import { EXRLoader } from "three/examples/jsm/loaders/EXRLoader.js";
import { flipRowsInPlace } from "./lightmap-rows";
import type { ExrJob, ExrReply } from "./exr-texture";

const port = globalThis as unknown as {
  addEventListener(type: "message", listener: (event: MessageEvent<ExrJob>) => void): void;
  postMessage(message: ExrReply, transfer?: Transferable[]): void;
};
port.addEventListener("message", (event) => {
  const { buffer, flip } = event.data;
  try {
    const decoded = new EXRLoader().setDataType(HalfFloatType).parse(buffer) as unknown as { width: number; height: number; data: Uint16Array; format: number; colorSpace: string };
    if (flip) flipRowsInPlace(decoded.data, decoded.height);
    port.postMessage({ ok: true, width: decoded.width, height: decoded.height, data: decoded.data, format: decoded.format, colorSpace: decoded.colorSpace }, [decoded.data.buffer]);
  } catch (error) {
    port.postMessage({ ok: false, message: error instanceof Error ? error.message : String(error) });
  }
});
