/// <reference lib="webworker" />
import type { EngineRequest } from "./protocol";
import { answerRequest } from "./search";

/**
 * Chess engine worker: runs the search (search.ts) off the main thread so the
 * render loop never stalls. Every reply carries the request's id.
 */
self.onmessage = (event: MessageEvent<EngineRequest>) => {
  self.postMessage(answerRequest(event.data));
};
