import { afterEach, describe, expect, it, vi } from "vitest";

import { AudioManager, IDLE_RELEASE_MS } from "./audioManager";

/** The mixer's private state, as the tests below set it up and read it. */
type Inside = {
  ctx: { state: string; currentTime: number; resume(): Promise<void>; suspend(): Promise<void> } | null;
  buffers: Map<string, object>; loads: Map<string, Promise<object | null>>; shots: Map<string, object>;
  muted: boolean; resuming: number; silent: boolean; started: boolean;
};
const inside = (mixer: AudioManager) => mixer as unknown as Inside;
/** A context that is running, as one is in a match. */
const running = () => ({ state: "running", currentTime: 0, resume: async () => {}, suspend: async () => {} });

afterEach(() => { vi.useRealTimers(); });

describe("the match mixer out of a match", () => {
  it("lets its decoded clips go a while after the last match closed, keeping the beds (M-11)", () => {
    vi.useFakeTimers();
    const mixer = new AudioManager(), m = inside(mixer);
    m.ctx = running();
    for (const id of ["bed_hall", "bed_dirge", "bed_heart", "bed_souls", "hit_n", "check_toll", "sting_win"]) { m.buffers.set(id, {}); m.loads.set(id, Promise.resolve({})); }
    m.shots.set("musket.mp3", {});
    mixer.setMuted(true);
    vi.advanceTimersByTime(IDLE_RELEASE_MS - 1000);
    expect(mixer.heldClipCount).toBe(8);
    vi.advanceTimersByTime(2000);
    expect([...m.buffers.keys()].sort()).toEqual(["bed_dirge", "bed_hall", "bed_heart", "bed_souls"]);
    // Let go, they are fetched again when next wanted.
    expect(m.loads.has("hit_n")).toBe(false);
    expect(m.shots.size).toBe(0);
  });

  it("keeps them when a match is heard again before the wait is over", () => {
    vi.useFakeTimers();
    const mixer = new AudioManager(), m = inside(mixer);
    m.ctx = running();
    m.buffers.set("hit_n", {});
    mixer.setMuted(true);
    vi.advanceTimersByTime(IDLE_RELEASE_MS / 2);
    mixer.setMuted(false);
    vi.advanceTimersByTime(IDLE_RELEASE_MS);
    expect(m.buffers.has("hit_n")).toBe(true);
  });
});

describe("sounds asked for while the mixer's context is suspended (M-22)", () => {
  it("are not scheduled, unless a resume the mixer asked for is under way", async () => {
    const mixer = new AudioManager(), m = inside(mixer);
    let wake: () => void = () => {};
    m.ctx = { state: "suspended", currentTime: 0, suspend: async () => {}, resume: () => new Promise<void>((resolve) => { wake = () => { m.ctx!.state = "running"; resolve(); }; }) };
    // Suspended by the browser (or never woken): its clock stands still, so a sound scheduled now would sound later
    // with every other one at once.
    expect(m.silent).toBe(true);
    // Unmuted for a match: the mixer wakes its context, and what the match asks for meanwhile starts as it wakes.
    mixer.setMuted(false);
    expect(m.resuming).toBe(1);
    expect(m.silent).toBe(false);
    wake(); await Promise.resolve(); await Promise.resolve();
    expect(m.resuming).toBe(0);
    expect(m.silent).toBe(false);
    // Muted, nothing is scheduled whatever the context does.
    mixer.setMuted(true);
    expect(m.silent).toBe(true);
  });
});
