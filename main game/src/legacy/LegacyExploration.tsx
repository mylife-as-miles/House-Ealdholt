import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { LEGACY_COPY } from "../../../shared/legacy/content/copy";
import { LEGACY_ENVIRONMENTS } from "../../../shared/legacy/content/environments";
import type { LegacyEnvironmentLayout } from "../../../shared/legacy/content/environments";
import { LEGACY_EXPLORATION_COPY as COPY } from "../../../shared/legacy/exploration/copy";
import type { LegacyExplorationSnapshot } from "../../../shared/legacy/exploration/contract";
import { LEGACY_LANDMARKS } from "../../../shared/legacy/environment-contract";
import type { Heraldry, LandmarkId } from "../../../shared/legacy/types";
import type { LegacySettlementEnvironment, SettlementSnapshot } from "../../../shared/legacy/settlement/contract";
import type { NextStep } from "./next-step";
import { Cycler } from "./Cycler";
import { HeraldryEmblem } from "./HeraldryEmblem";
import { EstateGlyph, LegacySettlementEditor } from "./LegacySettlementEditor";
import type { LegacySettlementEditorHandle } from "./LegacySettlementEditor";
import "./LegacyExploration.css";

export interface LegacyExplorationHandle { cancel(): boolean; dismiss(): void; showLandmark(id: LandmarkId): void }
export interface SettlementHouse {
  name: string;
  nation: string;
  rank: string;
  heraldry: Heraldry;
  recognition: number;
  memberCount: number;
  matchCount: number;
  unreadNotices: number;
  sessionLabel: string | null;
}
interface Props {
  snapshot: LegacyExplorationSnapshot | null;
  settlement: SettlementSnapshot | null;
  settlementEnvironment: Partial<LegacySettlementEnvironment> | null;
  house: SettlementHouse;
  selected: LandmarkId;
  inspected: LandmarkId | null;
  layout: LegacyEnvironmentLayout;
  changing: boolean;
  error: string | null;
  nextStep: NextStep | null;
  onLayout(layout: LegacyEnvironmentLayout): void;
  onEnabled(enabled: boolean): void;
  onMember(id: string): void;
  onTravel(id: LandmarkId): void;
  onCancel(): void;
  onInteract(id: LandmarkId): void;
  onInspect(id: LandmarkId): void;
  onRosterOpen(): void;
  onEditorBegin(): void;
  onShowPlot?: () => void;
  onOverlayChange(open: boolean): void;
  onNextStep(step: NextStep): void;
}

/** Original heraldic silhouettes, never a portrait or an invented character identity. */
function MemberPortrait({ representative }: { representative: boolean }) {
  return <svg viewBox="0 0 64 76" aria-hidden="true" className="legacy-party-portrait">
    <path className="legacy-portrait-halo" d="M5 24 15 8 32 2 49 8 59 24 56 61 32 74 8 61Z" />
    <path className="legacy-portrait-mantle" d="m6 69 5-22 15-7h12l15 7 5 22-26 6Z" />
    <path className="legacy-portrait-armour" d="m19 46 9-7h8l9 7-3 23-10 5-10-5Z" />
    <path className="legacy-portrait-face" d="M22 23q0-14 10-14t10 14l-3 12-7 7-7-7Z" />
    <path className="legacy-portrait-helm" d="M19 23q0-18 13-18t13 18l-9-3-4 13-4-13Zm13-17v16" />
    <path className="legacy-portrait-line" d="m16 49 11 6 5-8 5 8 11-6M32 49v22M23 30l6 2m6 0 6-2" />
    {representative && <path className="legacy-portrait-insignia" d="m26 58 6-6 6 6-6 7Z" />}
  </svg>;
}

function LandmarkGlyph({ id }: { id: LandmarkId }) {
  const paths: Record<LandmarkId, string> = {
    "banner-hall": "M8 30V11l10-5 10 5v19M5 30h26M12 14h12M15 30V20h6v10M18 6V2l9 3-9 3",
    "muster-grounds": "m7 30 22-24M23 5l7 7M8 4l20 25M4 8l7-5M23 27l6-5M5 25l6 6",
    "war-record": "M7 5h17l5 5v21H7ZM23 5v7h6M12 17h12M12 22h12M12 27h8",
    "heralds-station": "M5 12h12l13-7v24l-13-7H5ZM10 23v8h6l-2-8M25 8v18",
  };
  return <svg viewBox="0 0 36 36" aria-hidden="true"><path d={paths[id]} /></svg>;
}

function UtilityGlyph({ kind }: { kind: "party" | "overview" | "explore" | "recognition" | "matches" | "notices" }) {
  const paths = {
    party: "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm12-1a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM4 29v-4q0-7 8-7t8 7v4Zm17 0v-5q0-4-2-6 11-2 11 7v4Z",
    overview: "M3 18s6-10 15-10 15 10 15 10-6 10-15 10S3 18 3 18Zm15 5a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z",
    explore: "m18 3 5 10 10 5-10 5-5 10-5-10-10-5 10-5Zm0 10-5 10 10-5Z",
    recognition: "m18 3 4 9 10 2-7 7 2 11-9-5-9 5 2-11-7-7 10-2Z",
    matches: "m7 30 22-24M23 5l7 7M8 4l20 25M4 8l7-5M23 27l6-5M5 25l6 6",
    notices: "M5 8h26v21H5Zm0 0 13 12L31 8M5 29l9-10m17 10-9-10",
  };
  return <svg viewBox="0 0 36 36" aria-hidden="true"><path d={paths[kind]} /></svg>;
}

/** A compact settlement HUD. Every counter and action comes from the real house. */
export const LegacyExploration = forwardRef<LegacyExplorationHandle, Props>(function LegacyExploration({ snapshot, settlement, settlementEnvironment, house, selected, inspected, layout, changing, error, nextStep, onLayout, onEnabled, onMember, onTravel, onCancel, onInteract, onInspect, onRosterOpen, onEditorBegin, onShowPlot, onOverlayChange, onNextStep }, ref) {
  const root = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const [membersOpen, setMembersOpen] = useState(false);
  const [chosen, setChosen] = useState<LandmarkId | null>(null);
  const [contextClosed, setContextClosed] = useState(false);
  const editorRef = useRef<LegacySettlementEditorHandle>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const editorChanged = useCallback((open: boolean) => { setEditorOpen(open); if (open) { setMembersOpen(false); setContextClosed(true); } }, []);
  const exploring = snapshot?.enabled === true;
  const selectedMember = snapshot?.members.find((member) => member.id === snapshot.selectedMemberId);
  const destination = LEGACY_LANDMARKS.find((id) => id === snapshot?.destination) ?? null;
  const arrived = snapshot?.status === "arrived" && destination !== null && !snapshot.paused;
  const moving = snapshot?.status === "moving";
  const available = snapshot?.available === true;
  const unavailableReason = snapshot?.unavailableReason || COPY.unavailableRenderer;
  const context = exploring && !inspected && !contextClosed ? destination ?? chosen : null;
  useEffect(() => { onOverlayChange(membersOpen || context !== null || editorOpen); }, [membersOpen, context, editorOpen, onOverlayChange]);
  useEffect(() => () => onOverlayChange(false), [onOverlayChange]);
  const restoreOpener = () => requestAnimationFrame(() => { if (opener.current?.isConnected) opener.current.focus({ preventScroll: true }); });
  const closeMembers = () => { setMembersOpen(false); restoreOpener(); };
  const closeContext = () => { setContextClosed(true); restoreOpener(); };
  useImperativeHandle(ref, () => ({
    cancel() {
      if (editorRef.current?.cancel()) return true;
      if (membersOpen) { closeMembers(); return true; }
      if (context) { closeContext(); return true; }
      return false;
    },
    dismiss() {
      editorRef.current?.dismiss();
      setMembersOpen(false);
      setChosen(null);
      setContextClosed(true);
    },
    showLandmark(id) {
      setMembersOpen(false);
      setChosen(id);
      setContextClosed(false);
      const active = document.activeElement;
      opener.current = active instanceof HTMLElement && root.current?.contains(active)
        ? active : root.current?.querySelector<HTMLElement>(`[data-dock-landmark="${id}"]`) ?? null;
    },
  }));
  const toggleMembers = (element: HTMLElement) => {
    if (membersOpen) { closeMembers(); return; }
    editorRef.current?.dismiss();
    opener.current = element;
    setMembersOpen(true);
    onRosterOpen();
  };
  const selectLandmark = (id: LandmarkId, element: HTMLElement) => {
    editorRef.current?.dismiss();
    opener.current = element;
    setMembersOpen(false);
    setChosen(id);
    setContextClosed(false);
    if (exploring) onTravel(id); else onInspect(id);
  };
  const inspectHouse = (id: LandmarkId) => {
    editorRef.current?.dismiss();
    setMembersOpen(false);
    onInspect(id);
  };
  const status = snapshot?.paused ? COPY.paused : moving ? COPY.walking : arrived ? COPY.arrived : COPY.chooseDestination;
  const contextDestination = snapshot?.destinations.find((entry) => entry.id === context);
  return <div ref={root} className={`legacy-exploration legacy-settlement-hud${exploring ? " is-exploring" : ""}${membersOpen ? " has-party" : ""}${editorOpen ? " is-editing" : ""}`} data-exploration={exploring ? "active" : "overview"} data-exploration-status={snapshot?.status ?? "unavailable"} data-selected-member={snapshot?.selectedMemberId ?? ""} data-selected-landmark={selected} data-destination={snapshot?.destination ?? ""}>
    <header className="legacy-settlement-topbar" aria-label={COPY.holding}>
      <div className="legacy-settlement-stats legacy-settlement-surface">
        <button type="button" data-nav data-house-stat="members" aria-label={`${COPY.members}: ${house.memberCount}`} aria-expanded={membersOpen} title={COPY.members} onClick={(event) => toggleMembers(event.currentTarget)}><UtilityGlyph kind="party" /><strong>{house.memberCount}</strong></button>
        <button type="button" data-nav data-house-stat="recognition" aria-label={`${COPY.recognition}: ${house.recognition}`} title={COPY.recognition} onClick={() => inspectHouse("banner-hall")}><UtilityGlyph kind="recognition" /><strong>{house.recognition}</strong></button>
        <button type="button" data-nav data-house-stat="matches" aria-label={`${COPY.conflicts}: ${house.matchCount}`} title={COPY.conflicts} onClick={() => inspectHouse("war-record")}><UtilityGlyph kind="matches" /><strong>{house.matchCount}</strong></button>
        <button type="button" data-nav data-house-stat="notices" aria-label={`${COPY.unread}: ${house.unreadNotices}`} title={COPY.unread} onClick={() => inspectHouse("heralds-station")}><UtilityGlyph kind="notices" /><strong>{house.unreadNotices}</strong></button>
      </div>
      <button type="button" data-nav className="legacy-settlement-nameplate legacy-settlement-surface" aria-label={`${house.name}. ${house.rank}. ${house.nation}. ${COPY.manageHouse}`} onClick={() => inspectHouse("banner-hall")}>
        <HeraldryEmblem heraldry={house.heraldry} aspect="shield" className="legacy-settlement-crest" label="" /><span><strong>{house.name}</strong><span>{house.rank} · {house.nation}</span></span>
      </button>
      <div className="legacy-settlement-utilities">
        <div className="legacy-world-picker legacy-settlement-surface" aria-busy={changing} aria-disabled={changing || undefined}><Cycler id="legacy-environment" label={COPY.environment} value={layout} options={LEGACY_ENVIRONMENTS.map((entry) => ({ value: entry.id, label: entry.label }))} onChange={(id) => { if (!changing) { editorRef.current?.dismiss(); onLayout(id); } }} /></div>
        <div className="legacy-view-switch legacy-settlement-surface" role="group" aria-label={COPY.mode}>
          <button type="button" data-nav data-exploration-overview aria-pressed={!exploring} aria-label={COPY.overview} title={COPY.overview} onClick={() => { editorRef.current?.dismiss(); setMembersOpen(false); onEnabled(false); }}><UtilityGlyph kind="overview" /></button>
          <button type="button" data-nav data-exploration-enter aria-pressed={exploring} aria-label={COPY.explore} title={!available ? unavailableReason : COPY.explore} disabled={!available || changing} onClick={() => { editorRef.current?.dismiss(); setMembersOpen(false); onEnabled(true); }}><UtilityGlyph kind="explore" /></button>
        </div>
      </div>
    </header>
    {(changing || error || !available || settlement?.storageError) && <p className={`legacy-world-message legacy-settlement-surface${error || settlement?.storageError ? " is-error" : ""}`} role="status">{changing ? COPY.changingEnvironment : error ?? (settlement?.storageError ? COPY.editor.unsaved : unavailableReason)}</p>}
    {house.sessionLabel && <p className="legacy-settlement-session" data-session-label>{house.sessionLabel}</p>}

    {membersOpen && <section className="legacy-party legacy-settlement-surface" data-party-panel aria-label={COPY.showParty}>
      <div className="legacy-context-heading"><p className="legacy-explore-eyebrow">{COPY.party}</p><h2>{COPY.members}</h2><button type="button" className="legacy-context-close" aria-label={COPY.close} onClick={closeMembers}>×</button></div>
      <div className="legacy-party-members">{snapshot?.members.map((member) => <button type="button" key={member.id} data-nav data-party-member={member.id} className={`legacy-party-member${member.id === snapshot.selectedMemberId ? " is-selected" : ""}`} aria-pressed={member.id === snapshot.selectedMemberId} aria-label={`${member.name}. ${member.role === "representative" ? COPY.representative : COPY.levy}. ${LEGACY_COPY.status[member.status].label}`} disabled={!member.available || changing} onClick={() => onMember(member.id)}><span className="legacy-party-frame"><MemberPortrait representative={member.role === "representative"} /></span><span className="legacy-party-identity"><span className="legacy-party-name">{member.name}</span><span className="legacy-party-role">{member.role === "representative" ? COPY.representative : COPY.levy}</span><span className="legacy-party-status">{LEGACY_COPY.status[member.status].label}</span></span>{member.id === snapshot.selectedMemberId && <span className="legacy-party-selected" aria-hidden="true">◆</span>}</button>)}{!snapshot?.members.length && <p className="legacy-explore-empty">{COPY.noParty}</p>}</div>
    </section>}

    {context && <section className="legacy-landmark-context legacy-settlement-surface" data-landmark-preview={context} aria-label={LEGACY_COPY.landmarks[context].title}>
      <div className="legacy-context-heading"><p className="legacy-explore-eyebrow">{COPY.holding}</p><h2>{LEGACY_COPY.landmarks[context].title}</h2><button type="button" className="legacy-context-close" aria-label={COPY.close} onClick={closeContext}>×</button></div>
      <div className="legacy-context-emblem"><LandmarkGlyph id={context} /></div>
      <p className="legacy-context-description">{LEGACY_COPY.landmarks[context].description}</p>
      <div className="legacy-context-facts"><p><span>{COPY.selectedMember}</span><strong>{selectedMember?.name ?? COPY.party}</strong></p><p><span>{COPY.journey}</span><strong>{status}</strong></p></div>
      {moving && <progress max={1} value={snapshot.progress} className="legacy-journey-progress" aria-label={COPY.journey} />}
      {snapshot?.error && <p className="legacy-context-error" role="status">{snapshot.error}</p>}
      <div className="legacy-context-action">
        {moving ? <button type="button" data-nav className="legacy-journey-stop" onClick={onCancel}>{COPY.cancelTravel}<span aria-hidden="true">×</span></button> : arrived && destination === context ? <button type="button" data-nav data-interact={context} className="legacy-journey-interact" onClick={() => onInteract(context)}>{LEGACY_COPY.landmarks[context].action}<span aria-hidden="true">›</span></button> : <button type="button" data-nav className="legacy-journey-interact" disabled={!contextDestination?.available || !selectedMember?.available} onClick={() => onTravel(context)}>{contextDestination?.travelMode === "fast-travel" ? COPY.fastTravelTo : COPY.walkTo}<span aria-hidden="true">›</span></button>}
      </div>
    </section>}

    {nextStep && <button type="button" className="legacy-settlement-journal legacy-settlement-surface" data-nav data-explore-objective aria-label={`${COPY.objectiveAction}: ${nextStep.title}`} onClick={() => { editorRef.current?.dismiss(); onNextStep(nextStep); }}><UtilityGlyph kind="notices" /><span><span className="legacy-explore-eyebrow">{COPY.objective}</span><strong>{nextStep.title}</strong></span><span className="legacy-journal-chevron" aria-hidden="true">›</span></button>}
    <nav className="legacy-settlement-dock" data-settlement-dock aria-label={COPY.controls}>
      <button type="button" data-nav data-settlement-build className={`legacy-settlement-tool legacy-settlement-surface${editorOpen ? " is-selected" : ""}`} aria-label={COPY.editor.build} title={settlement?.available ? COPY.editor.build : settlement?.reason ?? COPY.editor.unavailable} disabled={!settlement?.available || changing} onClick={(event) => editorRef.current?.open("build", event.currentTarget)}><EstateGlyph kind="build" /><span className="legacy-tool-label">{COPY.editor.build}</span></button>
      <button type="button" data-nav data-party-toggle className={`legacy-settlement-tool legacy-settlement-surface${membersOpen ? " is-selected" : ""}`} aria-label={COPY.showParty} aria-expanded={membersOpen} title={COPY.showParty} onClick={(event) => toggleMembers(event.currentTarget)}><UtilityGlyph kind="party" /><span className="legacy-tool-label">{COPY.members}</span></button>
      {LEGACY_LANDMARKS.map((id) => <button key={id} type="button" data-nav data-dock-landmark={id} data-landmark={id} className={`legacy-settlement-tool legacy-settlement-surface${(inspected ?? destination) === id ? " is-selected" : ""}`} aria-label={LEGACY_COPY.landmarks[id].title} aria-pressed={(inspected ?? destination) === id} title={LEGACY_COPY.landmarks[id].title} onFocus={() => { /* Selection does not open a pane or move the camera. */ }} onClick={(event) => selectLandmark(id, event.currentTarget)}><LandmarkGlyph id={id} /><span className="legacy-tool-label">{LEGACY_COPY.landmarks[id].title}</span></button>)}
      {moving && <button type="button" data-nav className="legacy-settlement-tool legacy-settlement-surface is-travelling" aria-label={COPY.cancelTravel} title={COPY.cancelTravel} onClick={onCancel}><span aria-hidden="true">×</span><span className="legacy-tool-label">{COPY.cancelTravel}</span></button>}
    </nav>
    <LegacySettlementEditor ref={editorRef} environment={settlementEnvironment} snapshot={settlement} onBegin={() => { setMembersOpen(false); setContextClosed(true); onEditorBegin(); }} onOpenChange={editorChanged} onShowPlot={onShowPlot} />
  </div>;
});
