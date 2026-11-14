// Terrain worker: evaluates heightAt() off the main thread (world grid rows, LOD chunks, shading
// maps, sun visibility). Protocol: { id, type, ...args } -> { id, result } | { id, error }.
import { runJob } from './terrain-exec.js';

const state = { world: null, cache: new Map() };

self.onmessage = (e) => {
  const msg = e.data;
  try {
    const { result, transfer } = runJob(state, msg);
    self.postMessage({ id: msg.id, result }, transfer || []);
  } catch (err) {
    self.postMessage({ id: msg.id, error: String(err?.stack || err) });
  }
};
