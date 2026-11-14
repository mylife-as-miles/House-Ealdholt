/** The observer's fine-line marks (original), shared by its panels. */
import type { CSSProperties } from "react";
import type { ChronicleKind } from "../../../../../shared/legacy/aethelgard/observer/village-chronicle";
import type { ObserverWeather } from "../../../../../shared/legacy/aethelgard/observer/observer-time";

export type GlyphName = ChronicleKind | ObserverWeather | "hold" | "clock" | "sky" | "chronicle" | "eye" | "release" | "moon" | "close" | "arrow" | "bell" | "torch" | "bless" | "blight" | "befriend" | "estrange" | "beacon";
const GLYPH: Record<GlyphName, string> = {
  hold: "M8 5v14 M16 5v14",
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 7v5l3 2",
  sky: "M7 18h10a4 4 0 0 0 0-8 6 6 0 0 0-11.3 2A3 3 0 0 0 7 18z",
  chronicle: "M6 3h10a3 3 0 0 1 3 3v15H9a3 3 0 0 1-3-3z M6 3a2 2 0 0 0 0 4h3 M10 10h6 M10 14h6",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6",
  release: "M3 12a9 9 0 1 0 3-6.7 M3 4v5h5",
  moon: "M20 13.5A8 8 0 1 1 10.5 4a6.5 6.5 0 0 0 9.5 9.5z",
  close: "M5 5l14 14 M19 5L5 19",
  arrow: "M2 12h28 M24 6l6 6-6 6",
  clear: "M12 7.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9z M12 2v2.5 M12 19.5V22 M4.9 4.9l1.8 1.8 M17.3 17.3l1.8 1.8 M2 12h2.5 M19.5 12H22 M4.9 19.1l1.8-1.8 M17.3 6.7l1.8-1.8",
  overcast: "M7 18h10a4 4 0 0 0 0-8 6 6 0 0 0-11.3 2A3 3 0 0 0 7 18z",
  rain: "M7 14h10a4 4 0 0 0 0-8 6 6 0 0 0-11.3 2A3 3 0 0 0 7 14z M8 17l-1 3 M12 17l-1 3 M16 17l-1 3",
  storm: "M7 14h10a4 4 0 0 0 0-8 6 6 0 0 0-11.3 2A3 3 0 0 0 7 14z M13 13l-3 4.5h4L11 22",
  power: "M12 2l2 8 8 2-8 2-2 8-2-8-8-2 8-2z",
  life: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6",
  worship: "M12 2v4 M10 4h4 M5 21V11l7-5 7 5v10 M10 21v-5h4v5",
  journey: "M5 21L10 3 M19 21L14 3 M12 7v2 M12 12v2 M12 17v2",
  gathering: "M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6 M2 20v-1a6 6 0 0 1 12 0v1 M16 5a3 3 0 0 1 0 6 M18 14a5 5 0 0 1 4 5v1",
  threat: "M4 4l11 11 M20 4L9 15 M13 17l4-4 M11 17l-4-4 M16 16l4 4 M8 16l-4 4",
  bell: "M6 16v-5a6 6 0 0 1 12 0v5l2 2H4z M10 20a2 2 0 0 0 4 0",
  torch: "M12 3c2 3 4 4.5 4 8a4 4 0 0 1-8 0c0-2 1-3 2-4 0 2 1 3 2 3 0-2-1-4 0-7z M10 15l-1 6h6l-1-6",  realm: "M5 22V3 M5 4h14v11l-7-3-7 3",
  bless: "M12 21V10 M12 14c-3.2 0-5.5-2.2-5.5-5.4 3.2 0 5.5 2.2 5.5 5.4z M12 11.5c3.2 0 5.5-2.2 5.5-5.4-3.2 0-5.5 2.2-5.5 5.4z M12 6V3",
  blight: "M12 3v18 M4.2 7.5l15.6 9 M19.8 7.5l-15.6 9 M9.5 4.5L12 7l2.5-2.5 M9.5 19.5L12 17l2.5 2.5",
  befriend: "M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z",
  estrange: "M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z M12 7.4l-2 3.4 3.4 2-2 3.6",
  beacon: "M12 2c1.6 2.4 3.4 3.8 3.4 6.6a3.4 3.4 0 0 1-6.8 0c0-1.7.9-2.6 1.7-3.4 0 1.7.8 2.5 1.7 2.5 0-1.7-.8-3.4 0-5.7z M7 13h10l-2 9H9z",
};
export function Glyph({ name, className = "obs-glyph" }: { name: GlyphName; className?: string }) {
  return <svg className={className} viewBox={name === "arrow" ? "0 0 32 24" : "0 0 24 24"} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={GLYPH[name]} /></svg>;
}
export const tint = (color: string) => ({ "--obs-tint": color }) as CSSProperties;
