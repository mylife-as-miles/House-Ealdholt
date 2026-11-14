/** Observer viewpoints measured from the supplied Elderbloom landmark bounds.
 * Coordinates are source-model metres. These are presentation views, not
 * locations added to Crownfall's canon or an embodied-player camera. Quest
 * focuses its stationary miniature on the same target instead of moving the
 * tracked head. Exact screenshot matching still requires visual review. */
export type EaldholtViewId = "overview" | "churchyard" | "well" | "lakeside" | "riverside";

export const EALDHOLT_VILLAGE_VIEWS = [
  { id: "overview", label: "Overview", position: [25, 90, 90], target: [25, 1, 25], fov: 58 },
  { id: "churchyard", label: "Churchyard", position: [51, 2.7, 37.75], target: [40.8, 3.8, 37.75], fov: 60 },
  { id: "well", label: "Well", position: [22.328, 1.95, 29.231], target: [15.655, 1.95, 31.682], fov: 60 },
  { id: "lakeside", label: "Village pond", position: [-1, 6, 3], target: [-10.4, 1.05, -4.4], fov: 55 },
  { id: "riverside", label: "Riverside", position: [42, 18, 184], target: [25, 1, 126], fov: 58 },
] as const satisfies readonly {
  id: EaldholtViewId; label: string;
  position: readonly [number, number, number]; target: readonly [number, number, number]; fov: number;
}[];
