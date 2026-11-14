/**
 * How far a load of several files has come, by bytes (A-07). Each file is tracked from its download's progress
 * events: its size is the one the server reports, or a guess until it does (and for a server that reports none). A
 * file that is finished counts whole. The ratio never goes back, so a size reported late (larger than its guess)
 * holds the bar still for a moment rather than pulling it back.
 */
export interface LoadProgress {
  /** Starts tracking `key`, guessed at `guessBytes` until its download reports a size; returns its progress callback. */
  file(key: string, guessBytes: number): (loaded: number, total: number) => void;
  /** `key` is in hand (or will not come): it counts whole from now on. */
  done(key: string): void;
  readonly ratio: number;
}

export function createLoadProgress(onChange?: (ratio: number) => void): LoadProgress {
  const files = new Map<string, { loaded: number; total: number; done: boolean }>();
  let shown = 0;
  const update = () => {
    let loaded = 0, total = 0;
    for (const entry of files.values()) {
      total += entry.total;
      loaded += entry.done ? entry.total : Math.min(entry.loaded, entry.total);
    }
    const next = total > 0 ? Math.min(1, loaded / total) : 0;
    if (next > shown) { shown = next; onChange?.(shown); }
  };
  return {
    file(key, guessBytes) {
      const entry = { loaded: 0, total: Math.max(1, guessBytes), done: false };
      files.set(key, entry);
      update();
      return (loaded, total) => {
        if (entry.done) return;
        if (Number.isFinite(total) && total > 0) entry.total = total;
        entry.loaded = Math.max(entry.loaded, Number.isFinite(loaded) ? loaded : 0);
        update();
      };
    },
    done(key) {
      const entry = files.get(key);
      if (!entry || entry.done) return;
      entry.done = true;
      update();
    },
    get ratio() { return shown; },
  };
}
