// Desktop side of the gameplay ↔ environment contract (docs/legacy/WORKFLOWS.md).
// The environment workflow implements CreateDesktopLegacyEnvironment in
// ./environment/createLegacyEnvironment.ts; gameplay discovers it lazily with
// import.meta.glob and falls back to its stand-in when the module is absent.

import type { LandmarkId } from "../../../shared/legacy/types";
import type { LegacyEnvironmentBase, LegacySceneState } from "../../../shared/legacy/environment-contract";
import type { LegacyEnvironmentLayout } from "../../../shared/legacy/content/environments";
import type { LegacySettlementEnvironment } from "../../../shared/legacy/settlement/contract";
import type { LegacyExplorationEnvironment } from "../../../shared/legacy/exploration/contract";

export interface DesktopEnvironmentQuality {
  preset: "low" | "medium" | "high";
  /** Internal resolution percentage, 50–100. */
  renderScale: number;
  frameLimit: 0 | 30 | 60 | 120;
}

export interface DesktopLegacyEnvironmentOptions {
  container: HTMLElement;
  state: LegacySceneState;
  quality: DesktopEnvironmentQuality;
  reducedMotion: boolean;
  layout?: LegacyEnvironmentLayout;
  highlight?: LandmarkId | null;
  onLandmarkHover: (id: LandmarkId | null) => void;
  onLandmarkSelect: (id: LandmarkId) => void;
  /** Called once the first frame of the real scene has rendered. */
  onReady?: () => void;
  /**
   * Called when the environment fails after it was created: a world rebuild that cannot finish, or a lost
   * graphics context. The caller shows its failure state with Retry and disposes the environment.
   */
  onError?: (error: Error) => void;
}

export interface ScreenAnchor {
  /** CSS pixels relative to the container. */
  x: number;
  y: number;
  visible: boolean;
  docked?: boolean;
}

export interface DesktopLegacyEnvironment extends LegacyEnvironmentBase, Partial<LegacyExplorationEnvironment>, Partial<LegacySettlementEnvironment> {
  setLayout?(layout: LegacyEnvironmentLayout): Promise<void>;
  setQuality(quality: DesktopEnvironmentQuality): void;
  setReducedMotion(reduced: boolean): void;
  /** Gamepad/keyboard orbit nudges in normalised units; the camera system clamps them. */
  nudgeOrbit(yaw: number, pitch: number, zoom?: number): void;
  /** Return to the establishing composition. */
  resetView(): void;
  /** Close inspection of the nominated representative, or of their empty place. */
  inspectRepresentative(): void;
  /** Label anchor for HTML overlays. */
  projectLandmark(id: LandmarkId): ScreenAnchor | null;
  /** Read-only projection for world input/accessibility and verification. */
  projectSettlementPoint?(x: number, z: number, worldY?: number): ScreenAnchor | null;
  /** Explicit user action; pans the desktop camera to the current placement. */
  focusSettlementPreview?(): void;
  resize(): void;
}

export type CreateDesktopLegacyEnvironment = (options: DesktopLegacyEnvironmentOptions) => Promise<DesktopLegacyEnvironment>;
