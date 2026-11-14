import { describe, expect, it } from "vitest";

import { nudgeOrbit, orbitLimits, seatAzimuth, type ViewportProfile } from "./viewport";

const desk = orbitLimits({ handheld: false } as ViewportProfile, 10.7);
const view = { radius: 10.7, phi: 0.93, theta: 0 };

describe("the view turned from the keys or a controller", () => {
  it("turns freely round the board", () => {
    expect(nudgeOrbit(view, 0.4, 0, 0, desk).theta).toBeCloseTo(0.4);
    expect(nudgeOrbit({ ...view, theta: 3 }, 0.4, 0, 0, desk).theta).toBeCloseTo(3.4);
    expect(nudgeOrbit(view, -0.4, 0, 0, desk)).toMatchObject({ radius: view.radius, phi: view.phi });
  });

  it("climbs and sinks only as far as a drag of the mouse may", () => {
    expect(nudgeOrbit(view, 0, 0.1, 0, desk).phi).toBeCloseTo(0.83);
    expect(nudgeOrbit(view, 0, 5, 0, desk).phi).toBe(desk.minPolarAngle);
    expect(nudgeOrbit(view, 0, -5, 0, desk).phi).toBe(desk.maxPolarAngle);
  });

  it("closes and backs away by a share of the distance, within the same limits", () => {
    expect(nudgeOrbit(view, 0, 0, 0.1, desk).radius).toBeCloseTo(9.63);
    expect(nudgeOrbit(view, 0, 0, -0.1, desk).radius).toBeCloseTo(11.77);
    expect(nudgeOrbit(view, 0, 0, 0.99, desk).radius).toBe(desk.minDistance);
    expect(nudgeOrbit(view, 0, 0, -9, desk).radius).toBe(desk.maxDistance);
  });
});

describe("the side a reset view settles on", () => {
  it("is the framing's own side when the camera is nearer it", () => {
    expect(seatAzimuth(0.6, 0)).toBeCloseTo(0);
    expect(seatAzimuth(-1.2, 0)).toBeCloseTo(0);
  });

  it("is the far side for the player sitting there, by the short way round", () => {
    expect(seatAzimuth(2.6, 0)).toBeCloseTo(Math.PI);
    expect(seatAzimuth(-2.6, 0)).toBeCloseTo(-Math.PI);
    // Black's own framing, seen from White's side after a flip.
    expect(seatAzimuth(0.3, Math.PI)).toBeCloseTo(0);
  });

  it("keeps the turns the camera has already made, so it never unwinds", () => {
    expect(seatAzimuth(Math.PI * 4 + 0.2, 0)).toBeCloseTo(Math.PI * 4);
    expect(seatAzimuth(Math.PI * 3 - 0.2, 0)).toBeCloseTo(Math.PI * 3);
  });
});
