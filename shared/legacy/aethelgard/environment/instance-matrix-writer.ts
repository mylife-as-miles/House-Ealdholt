/** Change-tracked instance matrix writes (audit L-14). Regional forest, rock
 * and groundcover draws rebuild their culled instance lists on a timer; three
 * re-uploads a whole buffer whenever `needsUpdate` is set, which cost about
 * 4 MB of upload every 180 ms with a still camera. Writes here compare with the
 * stored Float32 values and record each buffer's dirty span, so an unchanged
 * list uploads nothing and a small change uploads only its range. Engine-free:
 * it touches only the attribute's array and its public update-range method. */
export interface InstanceMatrixAttribute {
  readonly array: { [index: number]: number; readonly length: number };
  needsUpdate: boolean;
  addUpdateRange(start: number, count: number): void;
}
export interface InstanceMatrixUploads {
  /** Writes 16 column-major elements at an instance slot of a buffer. */
  write(attribute: InstanceMatrixAttribute, slot: number, elements: ArrayLike<number>): void;
  /** Queues only the changed span of every written buffer. Ranges accumulate
   * until three uploads them, so a rebuild with no render between keeps the
   * earlier span. Returns the number of floats queued by this commit. */
  commit(): number;
  /** Forgets a retired buffer. */
  release(attribute: InstanceMatrixAttribute): void;
  readonly stats: { commits: number; uploads: number; floatsQueued: number };
}
export function createInstanceMatrixUploads(): InstanceMatrixUploads {
  const spans = new Map<InstanceMatrixAttribute, { first: number; last: number }>();
  const stats = { commits: 0, uploads: 0, floatsQueued: 0 };
  return {
    stats,
    write(attribute, slot, elements) {
      const target = attribute.array, offset = slot * 16;
      if (!(offset >= 0 && offset + 16 <= target.length)) throw Error('Instance matrix slot is outside its buffer.');
      let span = spans.get(attribute);
      for (let i = 0; i < 16; i++) {
        const value = Math.fround(elements[i]);
        if (target[offset + i] === value) continue;
        target[offset + i] = value;
        if (!span) { span = { first: Infinity, last: -1 }; spans.set(attribute, span); }
        if (slot < span.first) span.first = slot;
        if (slot > span.last) span.last = slot;
      }
    },
    commit() {
      let queued = 0; stats.commits++;
      for (const [attribute, span] of spans) {
        if (span.last < span.first) continue;
        const count = (span.last - span.first + 1) * 16;
        attribute.addUpdateRange(span.first * 16, count); attribute.needsUpdate = true;
        queued += count; stats.uploads++; span.first = Infinity; span.last = -1;
      }
      stats.floatsQueued += queued;
      return queued;
    },
    release(attribute) { spans.delete(attribute); },
  };
}
