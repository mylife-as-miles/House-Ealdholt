/**
 * One download window shared by everything that pulls a GLB.
 *
 * Twelve rigs with five clips each is already over seventy files, and the
 * sculpted arms add to that. Firing them all at once made the browser drop
 * requests (`TypeError: Failed to fetch`), which silently cost figures their
 * strike and death clips — a capture then skipped the attack entirely. Every
 * fetch therefore queues through a small window and is retried before it is
 * given up on, and the window is *global*: two subsystems each politely
 * limiting themselves to four downloads still burst eight.
 */

import type { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export type LoadedGltf = Awaited<ReturnType<GLTFLoader["loadAsync"]>>;

const MAX_PARALLEL_DOWNLOADS = 4;

let activeDownloads = 0;
const downloadQueue: (() => void)[] = [];

export async function withDownloadSlot<T>(job: () => Promise<T>): Promise<T> {
  while (activeDownloads >= MAX_PARALLEL_DOWNLOADS) {
    await new Promise<void>((resolve) => downloadQueue.push(resolve));
  }
  activeDownloads += 1;
  try {
    return await job();
  } finally {
    activeDownloads -= 1;
    downloadQueue.shift()?.();
  }
}

/**
 * Queued GLB fetch with exponential back-off — transient drops are retried. A
 * `signal` calls it off (A-07): a download not yet begun never starts, and a
 * failed one is not tried again once the signal has fired. (The loader's own
 * LoadingManager is what cuts a download that is under way.)
 */
export async function loadGltf(
  loader: GLTFLoader,
  url: string,
  attempts = 4,
  signal?: AbortSignal,
): Promise<LoadedGltf> {
  let last: unknown = new Error(`could not load ${url}`);
  const stopped = () => new DOMException(`${url}: the load was called off`, "AbortError");
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (signal?.aborted) throw stopped();
    try {
      return await withDownloadSlot(() => {
        if (signal?.aborted) throw stopped();
        return loader.loadAsync(url);
      });
    } catch (error) {
      last = error;
      if (signal?.aborted) throw stopped();
      if (attempt === attempts - 1) break;
      // Jittered back-off so a whole army does not retry on the same frame.
      const delay = 240 * 2 ** attempt + Math.random() * 200;
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
    }
  }
  throw last;
}
