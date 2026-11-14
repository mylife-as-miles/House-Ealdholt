import { describe, expect, it } from "vitest";
import { ARMY_SKINS, ARMY_SKIN_ORDER } from "../assets/generated";
import {
  FLOURISH_SECONDS, MUSTER_SLOTS, MUSTER_STYLES, MusterEffects, SHED_TAIL, SLOT_PARTICLES,
  burstAge, settleSeconds, shedAge, sigilDraw, sigilGlow, sigilPulse, styleParticles,
} from "./musterEffects";

describe("each kingdom's way of taking the field", () => {
  it("has a style for every army, named for its kingdom, each with its own ember and its own sigil", () => {
    for (const army of ARMY_SKIN_ORDER) expect(MUSTER_STYLES[army].kingdom).toBe(ARMY_SKINS[army].label);
    expect(new Set(ARMY_SKIN_ORDER.map((army) => MUSTER_STYLES[army].ember)).size).toBe(ARMY_SKIN_ORDER.length);
    expect(new Set(ARMY_SKIN_ORDER.map((army) => MUSTER_STYLES[army].sigil.pattern)).size).toBe(ARMY_SKIN_ORDER.length);
  });

  it("fits every figure's particles in its share, in whole bolts", () => {
    for (const army of ARMY_SKIN_ORDER) {
      const style = MUSTER_STYLES[army];
      expect(styleParticles(style)).toBeLessThanOrEqual(SLOT_PARTICLES);
      for (const emitter of style.emitters) {
        if (emitter.motion === "arc") expect(emitter.count % (emitter.perArc ?? 12)).toBe(0);
        // A bolt's stretches are worked out from its joints, so only an arc can be drawn as one, and an arc only so.
        expect(emitter.shape === "bolt").toBe(emitter.motion === "arc");
        expect(emitter.size[0]).toBeLessThanOrEqual(emitter.size[1]);
        expect(emitter.life[0]).toBeGreaterThan(0);
        expect(emitter.life[0]).toBeLessThanOrEqual(emitter.life[1]);
      }
    }
  });

  it("sheds something while each figure forms and throws something as it stands", () => {
    for (const army of ARMY_SKIN_ORDER) {
      const emitters = MUSTER_STYLES[army].emitters;
      expect(emitters.some((emitter) => emitter.when === "forming")).toBe(true);
      expect(emitters.some((emitter) => emitter.when === "standing")).toBe(true);
    }
  });

  it("is over within a breath of each figure standing", () => {
    for (const army of ARMY_SKIN_ORDER) {
      expect(settleSeconds(MUSTER_STYLES[army])).toBeGreaterThanOrEqual(FLOURISH_SECONDS);
      expect(settleSeconds(MUSTER_STYLES[army])).toBeLessThanOrEqual(0.8);
    }
  });
});

describe("the timing of one figure's effects", () => {
  it("inscribes the sigil early in the burn and keeps it whole", () => {
    expect(sigilDraw(0)).toBe(0);
    expect(sigilDraw(0.15)).toBeGreaterThan(0);
    expect(sigilDraw(0.15)).toBeLessThan(1);
    expect(sigilDraw(0.3)).toBe(1);
    expect(sigilDraw(1)).toBe(1);
  });

  it("lights the sigil as the figure forms, flares it as it stands and puts it out soon after", () => {
    expect(sigilGlow(0, null)).toBe(0);
    const forming = sigilGlow(0.5, null);
    expect(forming).toBeGreaterThan(0);
    expect(sigilGlow(1, 0)).toBeGreaterThan(forming * 2);
    expect(sigilGlow(1, 0.2)).toBeLessThan(sigilGlow(1, 0.05));
    expect(sigilGlow(1, FLOURISH_SECONDS)).toBe(0);
    expect(sigilGlow(1, FLOURISH_SECONDS + 1)).toBe(0);
  });

  it("runs a pulse out over the board from the stand, fading as it goes", () => {
    expect(sigilPulse(null).glow).toBe(0);
    expect(sigilPulse(0)).toEqual({ radius: 1, glow: 1.4 });
    expect(sigilPulse(0.2).radius).toBeGreaterThan(1);
    expect(sigilPulse(0.2).glow).toBeLessThan(1.4);
    expect(sigilPulse(0.4)).toEqual({ radius: 1.6, glow: 0 });
  });

  it("sheds a forming mote in its turn, again every life, and no more once the figure has stood", () => {
    // Kindled at 1 s; this one is first shed half a life (0.2 s) later.
    expect(shedAge(1.1, 1, Infinity, 0.5, 0.4)).toBeNull();
    expect(shedAge(1.3, 1, Infinity, 0.5, 0.4)).toBeCloseTo(0.1);
    expect(shedAge(1.65, 1, Infinity, 0.5, 0.4)).toBeCloseTo(0.05);
    // It stood at 1.6: the mote shed at 1.6 lives its life out, none after it is shed.
    expect(shedAge(1.9, 1, 1.6, 0.5, 0.4)).toBeCloseTo(0.3);
    expect(shedAge(2.05, 1, 1.6, 0.5, 0.4)).toBeNull();
    expect(shedAge(1.6 + SHED_TAIL + 0.41, 1, 1.6, 0.5, 0.4)).toBeNull();
  });

  it("throws a standing particle once, after its delay", () => {
    expect(burstAge(2, 2.1, 0, 0.5)).toBeNull();
    expect(burstAge(2.2, 2.1, 0, 0.5)).toBeCloseTo(0.1);
    expect(burstAge(2.2, 2.1, 0.2, 0.5)).toBeNull();
    expect(burstAge(2.7, 2.1, 0, 0.5)).toBeNull();
  });
});

describe("following the figures of an opening", () => {
  const armies = { w: "ivory", b: "sun" } as const;

  it("follows nothing and draws nothing until an opening begins, nor when switched off", () => {
    const effects = new MusterEffects();
    expect(effects.group.visible).toBe(false);
    expect(effects.track("a1", "w", -3.57, 3.57, 0.98, 0.5, 1)).toBeNull();
    effects.enabled = false;
    effects.begin(armies);
    expect(effects.active).toBe(false);
    expect(effects.track("a1", "w", -3.57, 3.57, 0.98, 0.5, 1)).toBeNull();
    effects.dispose();
  });

  it("gives each figure its own kingdom's style", () => {
    const effects = new MusterEffects();
    effects.begin(armies);
    expect(effects.group.visible).toBe(true);
    expect(effects.track("e1", "w", 0.51, 3.57, 1.48, 0, 0)).toBe(MUSTER_STYLES.ivory);
    expect(effects.track("e8", "b", 0.51, -3.57, 1.48, 0, 0)).toBe(MUSTER_STYLES.sun);
    effects.dispose();
  });

  it("notes when a figure starts to form and when it stands, and starts it again if it is taken off the field", () => {
    const effects = new MusterEffects();
    effects.begin(armies);
    effects.track("a1", "w", -3.57, 3.57, 0.98, 0, 0);
    expect(effects.stateOf("a1")).toMatchObject({ reveal: 0, kindledAt: null, stoodAt: null });
    effects.track("a1", "w", -3.57, 3.57, 0.98, 0.1, 1.2);
    effects.track("a1", "w", -3.57, 3.57, 0.98, 0.6, 1.5);
    expect(effects.stateOf("a1")).toMatchObject({ reveal: 0.6, kindledAt: 1.2, stoodAt: null });
    effects.track("a1", "w", -3.57, 3.57, 0.98, 1, 1.9);
    expect(effects.stateOf("a1")).toMatchObject({ reveal: 1, kindledAt: 1.2, stoodAt: 1.9 });
    effects.track("a1", "w", -3.57, 3.57, 0.98, 0, 2);
    expect(effects.stateOf("a1")).toMatchObject({ kindledAt: null, stoodAt: null });
    effects.dispose();
  });

  it("starts and stands a figure on the one frame when it forms within it", () => {
    const effects = new MusterEffects();
    effects.begin(armies);
    effects.track("h1", "w", 3.57, 3.57, 0.98, 0, 0);
    effects.track("h1", "w", 3.57, 3.57, 0.98, 1, 0.25);
    expect(effects.stateOf("h1")).toMatchObject({ kindledAt: 0.25, stoodAt: 0.25 });
    effects.dispose();
  });

  it("keeps a square's slot when the board is rebuilt under it", () => {
    const effects = new MusterEffects();
    effects.begin(armies);
    effects.track("d1", "w", -0.51, 3.57, 1.32, 0.2, 1);
    const slot = effects.stateOf("d1")!.slot;
    effects.track("d1", "w", -0.51, 3.57, 1.32, 0.4, 1.1);
    expect(effects.stateOf("d1")!.slot).toBe(slot);
    effects.dispose();
  });

  it("follows no more figures than it has slots for, and still names their style", () => {
    const effects = new MusterEffects();
    effects.begin(armies);
    for (let index = 0; index < MUSTER_SLOTS; index += 1) effects.track(`sq${index}`, "w", 0, 0, 1, 0, 0);
    expect(effects.track("one-too-many", "b", 0, 0, 1, 0.5, 0)).toBe(MUSTER_STYLES.sun);
    expect(effects.stateOf("one-too-many")).toBeNull();
    effects.dispose();
  });

  it("clears at once: nothing drawn, no figure followed, and a new opening starts afresh", () => {
    const effects = new MusterEffects();
    effects.begin(armies);
    effects.track("a1", "w", -3.57, 3.57, 0.98, 0.5, 1);
    effects.clear();
    expect(effects.active).toBe(false);
    expect(effects.group.visible).toBe(false);
    expect(effects.stateOf("a1")).toBeNull();
    effects.begin({ w: "empire", b: "kwind" });
    expect(effects.track("a1", "w", -3.57, 3.57, 0.98, 0, 0)).toBe(MUSTER_STYLES.empire);
    expect(effects.stateOf("a1")).toMatchObject({ kindledAt: null, stoodAt: null });
    effects.dispose();
  });
});
