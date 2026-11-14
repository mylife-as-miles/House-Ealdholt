import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { LEGACY_EXPLORATION_COPY } from "../../../shared/legacy/exploration/copy";
import { SETTLEMENT_TOOLS } from "../../../shared/legacy/settlement/contract";
import type { LegacySettlementEnvironment, SettlementSnapshot, SettlementTool } from "../../../shared/legacy/settlement/contract";
import "./LegacySettlementEditor.css";

const COPY = LEGACY_EXPLORATION_COPY.editor;
type Chooser = "build" | null;
export interface LegacySettlementEditorHandle {
  open(mode: "build", opener: HTMLElement): void;
  cancel(): boolean;
  dismiss(): void;
}
interface Props {
  environment: Partial<LegacySettlementEnvironment> | null;
  snapshot: SettlementSnapshot | null;
  onBegin(): void;
  onOpenChange(open: boolean): void;
  onShowPlot?: () => void;
}

/** Original building outlines; no image or glyph is extracted from the reference. */
const BUILDING_PATHS: Record<SettlementTool | "build", string> = {
  build: "m8 29 16-19M18 7l5-4 9 8-5 5ZM6 26l5 5",
  cottage: "M3 18 18 5l15 13M7 15v17h22V15M15 32V22h7v10M24 9V4h4v9",
  storehouse: "m3 14 15-9 15 9M6 14h24v18H6Zm5 18V19h14v13M11 20l14 12m0-12L11 32",
  pavilion: "M3 14Q10 14 18 5Q26 14 33 14L29 18H7ZM9 18v13m18-13v13M6 32h24M13 18v13m10-13v13",
  "ruin-arch": "M5 33V18Q5 7 18 3Q31 7 31 18V33H24V18Q24 13 18 10Q12 13 12 18V33ZM5 23h7m12 0h7M8 11l5 5m10 0 5-5M14 5l2 6m4 0 2-6",
};
export function EstateGlyph({ kind }: { kind: SettlementTool | "build" }) {
  return <svg viewBox="0 0 36 36" aria-hidden="true"><path d={BUILDING_PATHS[kind]} /></svg>;
}

export const LegacySettlementEditor = forwardRef<LegacySettlementEditorHandle, Props>(function LegacySettlementEditor({ environment, snapshot, onBegin, onOpenChange, onShowPlot }, ref) {
  const [chooser, setChooser] = useState<Chooser>(null);
  const opener = useRef<HTMLElement | null>(null);
  const toolOpener = useRef<HTMLElement | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const preview = snapshot?.preview ?? null;
  const selected = snapshot?.placements.find((entry) => entry.id === snapshot.selectedId) ?? null;
  const lastSelection = useRef({ id: selected?.id ?? null, hadPreview: preview !== null });
  const active = preview ?? selected;
  const open = chooser !== null || active !== null;
  const tool = SETTLEMENT_TOOLS.find((entry) => entry.id === active?.kind);
  const restore = (wholeEditor = false) => requestAnimationFrame(() => {
    const fallback = root.current?.closest(".legacy-settlement-hud")?.querySelector<HTMLElement>("[data-settlement-build]");
    const target = !wholeEditor && opener.current?.isConnected ? opener.current : fallback ?? (toolOpener.current?.isConnected ? toolOpener.current : null);
    target?.focus({ preventScroll: true });
  });
  const focusSelected = () => requestAnimationFrame(() => root.current?.querySelector<HTMLElement>("[data-estate-panel='selected'] [data-nav]")?.focus({ preventScroll: true }));
  const selectPlaced = (id: string) => { if (environment?.selectSettlementPlacement?.(id)) { setChooser(null); focusSelected(); } };
  const closeChooser = () => { setChooser(null); restore(); };
  const cancel = () => {
    if (chooser) { closeChooser(); return true; }
    if (preview) { environment?.cancelSettlementPlacement?.(); restore(true); return true; }
    if (selected) { environment?.selectSettlementPlacement?.(null); restore(true); return true; }
    return false;
  };
  useImperativeHandle(ref, () => ({
    open(mode, element) {
      if (!snapshot?.available) return;
      opener.current = element;
      toolOpener.current = element;
      onBegin();
      setChooser(mode);
    }, cancel,
    dismiss() {
      setChooser(null);
      environment?.cancelSettlementPlacement?.();
      environment?.selectSettlementPlacement?.(null);
    },
  }));
  useEffect(() => { onOpenChange(open); }, [open, onOpenChange]);
  useEffect(() => {
    if (!chooser) return;
    const frame = requestAnimationFrame(() => root.current?.querySelector<HTMLElement>("[data-estate-chooser] [data-nav]:not(:disabled)")?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [chooser]);
  useEffect(() => {
    const previous = lastSelection.current;
    const id = selected?.id ?? null;
    lastSelection.current = { id, hadPreview: preview !== null };
    if (!id || preview || chooser || (previous.id === id && !previous.hadPreview)) return;
    // Canvas commits arrive through the environment subscription rather than a
    // UI button. Wait past pointer-up and the new pane's first layout before
    // handing focus to its real action, without interrupting a newer gesture.
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        const editor = root.current;
        if (!editor || editor.querySelector<HTMLElement>("[data-estate-chooser]")?.getClientRects().length
          || editor.closest(".legacy-screen")?.querySelector("canvas:active")) return;
        const target = editor.querySelector<HTMLElement>("[data-estate-panel='selected'] [data-nav]:not(:disabled)");
        if (!target?.getClientRects().length) return;
        target.focus({ preventScroll: true });
        target.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
      });
    });
    return () => { cancelAnimationFrame(firstFrame); if (secondFrame) cancelAnimationFrame(secondFrame); };
  }, [selected?.id, preview !== null, chooser]);
  const begin = (kind: SettlementTool) => {
    onBegin();
    if (!environment?.setSettlementTool?.(kind)) return;
    setChooser(null);
    requestAnimationFrame(() => root.current?.querySelector<HTMLElement>("[data-settlement-nudge='north']")?.focus({ preventScroll: true }));
  };
  const recovery = preview?.reason === COPY.plotOutOfView && onShowPlot ? <div className="legacy-estate-recovery"><button type="button" data-nav data-settlement-show-plot onClick={() => {
    onShowPlot();
    requestAnimationFrame(() => {
      const target = chooser
        ? root.current?.querySelector<HTMLElement>("[data-estate-chooser] [data-nav]:not(:disabled)")
        : root.current?.querySelector<HTMLElement>("[data-settlement-confirm]:not(:disabled)") ?? root.current?.querySelector<HTMLElement>("[data-settlement-nudge]");
      target?.focus({ preventScroll: true });
    });
  }}>{COPY.showPlot}<span aria-hidden="true">↗</span></button></div> : null;
  return <div ref={root} className={`legacy-estate-editor${chooser ? " has-chooser" : ""}`} data-settlement-editor={open ? "open" : "closed"} data-selected-placement={selected?.id ?? ""}>
    {active && tool && <section className="legacy-estate-panel legacy-settlement-surface" data-estate-panel={preview ? "preview" : "selected"} aria-label={tool.label}>
      <div className="legacy-context-heading"><p className="legacy-explore-eyebrow">{COPY.estate}</p><h2>{tool.label}</h2><button type="button" className="legacy-context-close" aria-label={LEGACY_EXPLORATION_COPY.close} onClick={() => { environment?.cancelSettlementPlacement?.(); environment?.selectSettlementPlacement?.(null); setChooser(null); restore(true); }}>×</button></div>
      <div className="legacy-estate-body">
      <div className="legacy-estate-emblem"><EstateGlyph kind={active.kind} /></div>
      <p className="legacy-estate-detail">{tool.detail}</p>
      <div className="legacy-estate-measures"><span>{COPY.width}<strong>{active.width} m</strong></span><span>{COPY.depth}<strong>{active.depth} m</strong></span><span>{COPY.rotation}<strong>{active.rotation * 90}°</strong></span></div>
      {preview ? <>
        <p className={`legacy-estate-validity${preview.valid ? " is-valid" : ""}`} role="status" data-placement-valid={preview.valid ? "true" : "false"}>{preview.valid ? COPY.ready : preview.reason ?? COPY.selectGround}</p>
        <div className="legacy-estate-placement-controls" aria-label={COPY.placementHint}>
          <div className="legacy-estate-nudges"><button type="button" data-nav data-settlement-nudge="north" aria-label={COPY.north} onClick={() => environment?.moveSettlementCursor?.(0, -1)}>↑</button><button type="button" data-nav data-settlement-nudge="west" aria-label={COPY.west} onClick={() => environment?.moveSettlementCursor?.(-1, 0)}>←</button><button type="button" data-nav data-settlement-nudge="south" aria-label={COPY.south} onClick={() => environment?.moveSettlementCursor?.(0, 1)}>↓</button><button type="button" data-nav data-settlement-nudge="east" aria-label={COPY.east} onClick={() => environment?.moveSettlementCursor?.(1, 0)}>→</button></div>
          <button type="button" data-nav data-settlement-rotate onClick={() => environment?.rotateSettlementPreview?.()}>{COPY.rotate}<span aria-hidden="true">↻</span></button>
        </div>
      </> : <div className="legacy-estate-selected"><p>{COPY.placed}</p><button type="button" data-nav data-settlement-delete onClick={() => { if (environment?.deleteSettlementPlacement?.(selected!.id)) { setChooser(null); restore(true); } }}>{COPY.delete}<span aria-hidden="true">×</span></button></div>}
      {snapshot?.message && <p className="legacy-estate-message" role="status">{snapshot.message}</p>}
      {snapshot?.storageError && <p className="legacy-estate-error" role="alert">{snapshot.storageError}</p>}
      <p className="legacy-estate-note">{COPY.layoutNote}</p>
      </div>
      {!chooser && recovery}
      {preview && <div className="legacy-estate-primary"><button type="button" data-nav data-settlement-confirm disabled={!preview.valid} onClick={() => { if (environment?.commitSettlementPlacement?.()) focusSelected(); }}>{COPY.place}<span aria-hidden="true">✓</span></button><button type="button" data-nav data-settlement-cancel onClick={() => { environment?.cancelSettlementPlacement?.(); setChooser(null); restore(true); }}>{COPY.cancel}</button></div>}
    </section>}
    {chooser && <section className={`legacy-estate-chooser legacy-settlement-surface${active ? " has-context" : ""}`} data-estate-chooser={chooser} aria-label={COPY.chooseBuilding}>
      <div className="legacy-context-heading"><p className="legacy-explore-eyebrow">{COPY.estate}</p><h2>{COPY.chooseBuilding}</h2><button type="button" className="legacy-context-close" aria-label={LEGACY_EXPLORATION_COPY.close} onClick={closeChooser}>×</button></div>
      <div className="legacy-estate-choices">
        {SETTLEMENT_TOOLS.map((entry) => <button type="button" key={entry.id} data-nav data-settlement-kind={entry.id} onClick={() => begin(entry.id)}><EstateGlyph kind={entry.id} /><span><strong>{entry.label}</strong><span>{entry.width} × {entry.depth} m</span></span><span aria-hidden="true">›</span></button>)}
        {!!snapshot?.placements.length && <><p className="legacy-estate-list-heading">{COPY.placedObjects}</p>{snapshot.placements.map((placement, index) => <button type="button" key={placement.id} data-nav data-settlement-select={placement.id} aria-pressed={snapshot.selectedId === placement.id} onClick={() => selectPlaced(placement.id)}><EstateGlyph kind={placement.kind} /><span><strong>{SETTLEMENT_TOOLS.find((entry) => entry.id === placement.kind)?.label} · {index + 1}</strong><span>{placement.width} × {placement.depth} m</span></span><span aria-hidden="true">›</span></button>)}</>}
      </div>
      {recovery}
      {!active && snapshot?.message && <p className="legacy-estate-message" role="status">{snapshot.message}</p>}
      {!active && snapshot?.storageError && <p className="legacy-estate-error" role="alert">{snapshot.storageError}</p>}
    </section>}
    {preview && <p className="legacy-estate-instruction legacy-settlement-surface">{COPY.placementHint}</p>}
  </div>;
});
