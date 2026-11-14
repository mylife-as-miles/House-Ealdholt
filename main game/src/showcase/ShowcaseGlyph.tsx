export function ShowcaseGlyph({ kind }: { kind: "play" | "pause" | "previous" | "next" | "first" | "last" | "save" | "new" | "battles" | "arenas" | "replays" }) {
  return <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" className={`showcase-glyph showcase-glyph--${kind}`}>
    {kind === "play" && <path d="m11 7 14 9-14 9V7Z" fill="currentColor" stroke="none" />}
    {kind === "pause" && <path d="M10 8v16M22 8v16" strokeWidth="5" />}
    {(kind === "previous" || kind === "first") && <><path d="m22 8-13 8 13 8V8Z" fill="currentColor" stroke="none" />{kind === "first" && <path d="M7 8v16" />}</>}
    {(kind === "next" || kind === "last") && <><path d="m10 8 13 8-13 8V8Z" fill="currentColor" stroke="none" />{kind === "last" && <path d="M25 8v16" />}</>}
    {kind === "save" && <><path d="M7 5h16l4 4v18H5V5h2ZM10 5v9h12V5M10 27V18h12v9" /><path d="M18 8v3" /></>}
    {kind === "new" && <><path d="M16 5v22M5 16h22" /><path d="m16 2 2 3-2 3-2-3 2-3Z" fill="currentColor" stroke="none" /></>}
    {kind === "battles" && <><path d="m7 5 20 22M25 5 5 27M6 23l4 4M23 27l4-4" /><path d="m5 3 6 2-4 4-2-6Zm22 0-6 2 4 4 2-6Z" /></>}
    {kind === "arenas" && <><path d="m3 25 9-18 8 13 5-8 5 13H3ZM8 29h17" /><circle cx="24" cy="5" r="2.5" /></>}
    {kind === "replays" && <><path d="M7 6h20v24H7V6ZM11 6V2h12v4M7 13h20M12 18h10M12 23h7" /><path d="m20 28 3 3 7-8" /></>}
  </svg>;
}
