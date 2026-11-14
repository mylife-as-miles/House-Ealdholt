import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { CombatCancelled, PairedCombatDirector, stageCombatPair, type CombatSession, type MeleePerformance } from "./pairedCombat";

const flush = async () => { for (let i = 0; i < 24; i++) await Promise.resolve(); };
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
};
function performance(pair: CombatSession, events: string[]): MeleePerformance {
  return {
    approachAttacker: async () => { events.push("approach-attacker"); },
    faceDefender: async () => { events.push("face-defender"); },
    faceAttacker: () => { events.push("face-attacker"); },
    wind: .1,
    strike: () => { events.push("strike"); return { duration: 1, impact: .4 }; },
    swing: () => { events.push("swing"); },
    fallbackStrike: async () => { events.push("fallback"); },
    contact: () => { events.push("contact"); },
    hold: .1,
    recover: () => { events.push("recover"); },
    fall: async () => { events.push("fall"); await pair.wait(.6); events.push("land"); },
    advance: async () => { events.push("advance"); },
  };
}

describe("paired combat director", () => {
  it("plays nonlethal exchange markers before the one final capture contact", async () => {
    const director = new PairedCombatDirector(), pair = director.begin({}, {}, () => true), events: string[] = [];
    const spec = performance(pair, events);
    spec.strike = () => ({ duration: 2, impact: 1.5, events: [{ name: "clash", time: .4 }, { name: "feint", time: .8 }] });
    spec.exchange = event => { events.push(event.name); };
    const run = pair.melee(spec); await flush();
    for (let i = 0; i < 100; i++) { director.update(.05); await flush(); }
    await run;
    expect(events.indexOf("clash")).toBeLessThan(events.indexOf("feint"));
    expect(events.indexOf("feint")).toBeLessThan(events.indexOf("contact"));
    expect(events.filter(e => e === "contact")).toHaveLength(1); pair.close();
  });

  it("waits for both fighters to arrive before allowing the attack", async () => {
    const director = new PairedCombatDirector(), pair = director.begin({}, {}, () => true);
    const events: string[] = [], attacker = deferred(), defender = deferred();
    const spec = performance(pair, events);
    spec.approachAttacker = () => { events.push("approach-attacker"); return attacker.promise; };
    spec.faceDefender = () => { events.push("face-defender"); return defender.promise; };
    const run = pair.melee(spec); await flush();
    expect(events).toEqual(["approach-attacker", "face-defender"]);
    attacker.resolve(); director.update(1); await flush();
    expect(pair.phase).toBe("approach"); expect(events).not.toContain("strike");
    defender.resolve(); await flush(); expect(pair.phase).toBe("anticipate");
    for (let i = 0; i < 50; i++) { director.update(.05); await flush(); }
    await run; expect(pair.phase).toBe("complete"); pair.close();
    expect(director.activePairs).toBe(0);
  });

  it("keeps contact, hit hold and full death on the same frame clock as the characters", async () => {
    const director = new PairedCombatDirector(), pair = director.begin({}, {}, () => true);
    const events: string[] = [], spec = performance(pair, events);
    let elapsed = 0, strikeAt = -1, contactAt = -1, fallAt = -1, advanceAt = -1;
    spec.strike = () => { strikeAt = elapsed; events.push("strike"); return { duration: 1, impact: .4 }; };
    spec.contact = () => { contactAt = elapsed; events.push("contact"); };
    spec.fall = async () => { fallAt = elapsed; events.push("fall"); await pair.wait(.6); events.push("land"); };
    spec.advance = async () => { advanceAt = elapsed; events.push("advance"); };
    const run = pair.melee(spec); await flush();
    for (let i = 0; i < 50; i++) { elapsed += .05; director.update(.05); await flush(); }
    await run;
    expect(contactAt - strikeAt).toBeCloseTo(.4);
    expect(fallAt - contactAt).toBeCloseTo(.1);
    expect(advanceAt - fallAt).toBeCloseTo(.6);
    expect(events).toEqual(["approach-attacker", "face-defender", "face-attacker", "strike", "swing", "contact", "recover", "fall", "land", "advance"]);
    pair.close();
  });

  it("does not jump to the hit or remove the defender when wall time passes without frames", async () => {
    vi.useFakeTimers();
    try {
      const director = new PairedCombatDirector(), pair = director.begin({}, {}, () => true), events: string[] = [];
      const run = pair.melee(performance(pair, events)); await flush();
      director.update(.1); await flush(); expect(events).toContain("strike");
      await vi.advanceTimersByTimeAsync(20000); await flush();
      expect(events).not.toContain("contact"); expect(events).not.toContain("fall");
      const rejected = expect(run).rejects.toBeInstanceOf(CombatCancelled);
      director.cancelAll(); await rejected;
    } finally { vi.useRealTimers(); }
  });

  it("plays the fallback lunge before contact when the strike asset is absent", async () => {
    const director = new PairedCombatDirector(), pair = director.begin({}, {}, () => true), events: string[] = [];
    const spec = performance(pair, events); spec.strike = () => null;
    const run = pair.melee(spec); await flush();
    for (let i = 0; i < 40; i++) { director.update(.05); await flush(); }
    await run;
    expect(events.indexOf("fallback")).toBeLessThan(events.indexOf("contact"));
    expect(events.filter(e => e === "contact")).toHaveLength(1); pair.close();
  });

  it("reserves both actors and releases them when an interrupted board cancels the pair", async () => {
    const director = new PairedCombatDirector(), attacker = {}, defender = {}, events: string[] = [];
    const pair = director.begin(attacker, defender, () => true), run = pair.melee(performance(pair, events));
    expect(() => director.begin(attacker, {}, () => true)).toThrow(/reserved/);
    expect(() => director.begin({}, defender, () => true)).toThrow(/reserved/);
    await flush(); const rejected = expect(run).rejects.toBeInstanceOf(CombatCancelled);
    director.cancelAll(); await rejected;
    for (let i = 0; i < 40; i++) { director.update(.05); await flush(); }
    expect(events).not.toContain("contact"); expect(events).not.toContain("advance");
    expect(pair.phase).toBe("cancelled"); expect(director.activePairs).toBe(0);
    director.begin(attacker, defender, () => true).close(); expect(director.activePairs).toBe(0);
  });

  it("cancels a stale board even while an asynchronous approach is unfinished", async () => {
    const director = new PairedCombatDirector(), events: string[] = [], arrival = deferred(); let valid = true;
    const pair = director.begin({}, {}, () => valid), spec = performance(pair, events);
    spec.approachAttacker = () => arrival.promise;
    const run = pair.melee(spec); await flush();
    const rejected = expect(run).rejects.toBeInstanceOf(CombatCancelled);
    valid = false; director.update(.016); await rejected;
    arrival.resolve(); await flush();
    expect(events).not.toContain("strike"); expect(director.activePairs).toBe(0);
  });

  it("releases actor reservations after a visual callback fails", async () => {
    const director = new PairedCombatDirector(), a = {}, b = {}, events: string[] = [];
    const pair = director.begin(a, b, () => true), spec = performance(pair, events);
    spec.contact = () => { throw new Error("effect failed"); };
    const run = pair.melee(spec).finally(() => pair.close());
    const rejected = expect(run).rejects.toThrow("effect failed"); await flush();
    for (let i = 0; i < 20; i++) { director.update(.05); await flush(); }
    await rejected; expect(events).not.toContain("advance"); expect(director.activePairs).toBe(0);
    director.begin(a, b, () => true).close();
  });

  it("stages en passant against the real defender, preserving all original board inputs", () => {
    const from = new THREE.Vector3(4, .2, 4), victim = new THREE.Vector3(3, .2, 4), destination = new THREE.Vector3(3, .2, 3);
    const pair = stageCombatPair(from, victim, destination, .52);
    expect(pair.direction.toArray()).toEqual([-1, 0, 0]);
    expect(pair.standoff.x).toBeCloseTo(3.52); expect(pair.standoff.z).toBe(4);
    expect(from.toArray()).toEqual([4, .2, 4]); expect(victim.toArray()).toEqual([3, .2, 4]); expect(destination.toArray()).toEqual([3, .2, 3]);
  });

  it("keeps coincident/short approaches finite instead of stepping behind the attacker", () => {
    const origin = new THREE.Vector3();
    const short = stageCombatPair(origin, new THREE.Vector3(.1, 0, 0), new THREE.Vector3(1, 0, 0), .52);
    expect(short.standoff.x).toBeGreaterThan(0); expect(short.standoff.x).toBeLessThan(.1);
    const same = stageCombatPair(origin, origin, origin, .52);
    expect(same.direction.length()).toBeCloseTo(1); expect(same.standoff.toArray().every(Number.isFinite)).toBe(true);
  });
});
