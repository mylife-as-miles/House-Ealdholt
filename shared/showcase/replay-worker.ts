import { executeReplayJob } from './replay-jobs';
import type { ReplayJob, ReplayJobResponse } from './replay-jobs';

const port = globalThis as unknown as {
  addEventListener(type: 'message', listener: (event: MessageEvent<ReplayJob>) => void): void;
  postMessage(message: ReplayJobResponse): void;
};
port.addEventListener('message', event => {
  void executeReplayJob(event.data, undefined, progress => port.postMessage({ kind: 'progress', progress })).then(
    value => port.postMessage({ kind: 'complete', value }),
    error => port.postMessage({ kind: 'error', message: error instanceof Error ? error.message : 'The replay could not be prepared.' }),
  );
});
