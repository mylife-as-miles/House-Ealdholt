// Integration contract between the two My Legacy workflows (docs/legacy/WORKFLOWS.md).
// Gameplay supplies a LegacySceneState and owns rules, saves, navigation, input
// mapping and panels. The environment renders that state, owns the world,
// camera/staging and landmark picking, and never computes match consequences.
// Pure types and data only; platform interfaces extend LegacyEnvironmentBase in
// main game/src/legacy/environment-contract.ts and
// main-game-vr/src/legacy/environment-contract.ts.

import type { BannerholdPresentation, LandmarkId, Tincture } from "./types";

/** Everything the environment may show. Produced by gameplay's presentBannerhold / presentFoundingDraft. */
export type LegacySceneState = BannerholdPresentation;

export const LEGACY_LANDMARKS = ["banner-hall", "muster-grounds", "war-record", "heralds-station"] as const satisfies readonly LandmarkId[];

/** Authoritative tincture colours (sRGB). Heraldry content, rasters and environment palettes reuse this table. */
export const TINCTURE_SRGB: Readonly<Record<Tincture, string>> = {
  or: "#c9a23a",
  argent: "#dcd8cc",
  gules: "#9e2a24",
  azure: "#2b4f8c",
  vert: "#2f6b3f",
  purpure: "#5e3a78",
  sable: "#1b1a1d",
  sanguine: "#6e2222",
  tenne: "#a8622a",
  celeste: "#7fa6c9",
};

export interface LandmarkDescriptor {
  id: LandmarkId;
  label: string;
  /** Position in environment metres (the shared blueprint coordinate system). */
  position: readonly [number, number, number];
}

export interface LegacyEnvironmentStats {
  /** Live compiled programs, when the consuming renderer exposes them. */
  programs?: number;
  triangles: number;
  drawCalls: number;
  geometries: number;
  textures: number;
  /** Recent frame times. Software-rendered measurements are not representative of real hardware. */
  frameTimesMs: number[];
  /**
   * What frameTimesMs holds. "frame-interval" is the time between frames rendered back to back, so a slow
   * graphics card counts as well as main-thread work; the desktop step-down (adaptive-quality.ts) reads it.
   */
  frameTimesMeasure?: "frame-interval" | "js-submission" | "update-only";
  /** Main-thread time spent submitting each recent frame, when frameTimesMs holds frame intervals. */
  submissionTimesMs?: number[];
}

/** Behaviour shared by the desktop and Quest environment implementations. */
export interface LegacyEnvironmentBase {
  /** Apply a new scene state. Must be cheap for small changes (status, notices) and rebuild only when the nation changes. */
  setState(state: LegacySceneState): void;
  /** Desktop: move to the landmark's authored framing. Quest: emphasise it without ever moving the viewer. null returns to the overview. */
  focusLandmark(id: LandmarkId | null): void;
  /** Hover/keyboard emphasis driven by gameplay UI navigation. */
  highlightLandmark(id: LandmarkId | null): void;
  getLandmarks(): readonly LandmarkDescriptor[];
  setPaused(paused: boolean): void;
  getStats(): LegacyEnvironmentStats;
  /** Releases every GPU resource and listener the environment created. */
  dispose(): void;
}
