import { useMenuLocale } from "./MenuLocale";
import { InputPrompt } from "./InputPrompt";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { SettingsPageHandle } from "./settings-types";
import { SHOWCASE_CATEGORIES as categories } from "../../shared/menu/content";
import { SHOWCASE_ARENAS as arenas, SHOWCASE_COPY as sourceCopy, PLAYBACK_SPEEDS, MAX_ARCHIVE_BYTES } from "../../shared/showcase/catalog";
import type { ReplayEntry } from "../../shared/showcase/types";
import { ShowcaseGlyph as Glyph } from "./showcase/ShowcaseGlyph";
import ShowcaseStageView, { type ShowcaseCamera, type StagePreferences } from "./showcase/ShowcaseStageView";
import { useShowcaseSession } from "./showcase/useShowcaseSession";
import "./Showcase.css";
import type { GamePortSetting } from "../../shared/play/match";
import ReplayStage, { type ReplayCamera, type ReplayStageHandle, type ReplayStageStatus } from "./showcase/ReplayStage";
import GameplayShowcase from "./showcase/GameplayShowcase";
import { matchModeLabel } from "../../shared/play/replay";
import { publicUrl } from "./public-url";


export type { ShowcaseView } from "../../shared/menu/types";
import type { ShowcaseView } from "../../shared/menu/types";
interface ShowcaseProps extends StagePreferences {
  replayToOpen?: ReplayEntry | null;
  onReplayOpened?(): void;
  view: ShowcaseView;
  onViewChange(view: ShowcaseView): void;
  onBackRoot(): void;
}
type DialogState = { kind: "delete"; entry: ReplayEntry } | { kind: "import" } | null;

function ShowcaseIcon({ kind }: { kind: "battles" | "arenas" | "replays" }) {
  return <svg className={`showcase-icon showcase-icon--${kind}`} viewBox="0 0 64 64" fill="none" aria-hidden="true">
    {kind === "battles" && <>
      <path d="M17 13 47 51M47 13 17 51M14 41l9 9M41 50l9-9M13 10l8 3-5 5-3-8ZM51 10l-8 3 5 5 3-8Z" />
      <path d="m32 5 4 7-4 7-4-7 4-7Z" className="showcase-icon-accent" />
    </>}
    {kind === "arenas" && <><path d="m8 46 15-28 12 20 8-12 13 20H8ZM15 51h34" /><path d="m23 18 2 14-9-1M43 26v12l-6-3" /><circle cx="45" cy="13" r="4" /></>}
    {kind === "replays" && <><path d="M14 13h36v39H14V13ZM22 13V7h20v6M14 24h36M24 32h16M24 39h16M24 46h10" /><path d="m44 52 4 5 9-11" className="showcase-icon-accent" /></>}
  </svg>;
}

function ArchiveArt() {
  return <span className="showcase-archive-art" aria-hidden="true"><span className="showcase-board-pattern" /><svg viewBox="0 0 160 160" className="showcase-archive-seal" fill="none"><path d="M80 18 123 43v50l-43 25-43-25V43l43-25Z" /><path d="m54 57 9 26h34l9-26-17 12-9-20-9 20-17-12ZM64 91h32M59 100h42" /><circle cx="80" cy="73" r="64" strokeDasharray="2 7" /><path d="M30 136h100M55 144h50" /></svg></span>;
}
function download(text: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a"); link.href = url; link.download = name; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function readableDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "" : date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default forwardRef<SettingsPageHandle, ShowcaseProps>(function Showcase({ view, onViewChange, onBackRoot, quality, automaticGraphics = false, renderScale, frameLimit, reducedMotion, replayToOpen, onReplayOpened }, ref) {
  const [setting, setSetting] = useState<GamePortSetting>("scene-01");
  const { t } = useMenuLocale();
  const copy = Object.fromEntries(Object.entries(sourceCopy).map(([key, value]) => [key, t(value)])) as Record<keyof typeof sourceCopy, string>;
  const [battleEntry, setBattleEntry] = useState<ReplayEntry | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const { session, snapshot: state } = useShowcaseSession(view === "overview");
  const [selected, setSelected] = useState(0);
  const [camera, setCamera] = useState<ShowcaseCamera>("cinematic");
  // A recorded match is played back as it was played (ReplayStage): from the match's own seat by default.
  const [matchCamera, setMatchCamera] = useState<ReplayCamera>("match");
  const [battlesOnly, setBattlesOnly] = useState(false);
  const [replayStatus, setReplayStatus] = useState<ReplayStageStatus>({ ready: false, performing: null, notes: [] });
  const replayStage = useRef<ReplayStageHandle>(null);
  const [artwork, setArtwork] = useState(false);
  const [archivePage, setArchivePage] = useState(0);
  const [compact, setCompact] = useState(() => window.matchMedia("(max-height:460px) and (orientation:landscape)").matches);
  const [importText, setImportText] = useState("");
  const [notice, setNotice] = useState("");
  const [dialogError, setDialogError] = useState("");
  const root = useRef<HTMLElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const focused = useRef<string>("");
  const originFocus = useRef<HTMLElement | null>(null);
  const activeView = useRef(view); activeView.current = view;
  const generating = state.phase === "generating";
  const opening = state.phase === "opening";
  const busy = generating || opening;
  const archiveLoading = state.storage === "loading";
  const record = state.record;
  const maxPly = record?.plies ?? 0;
  /** A recorded match on the replay stage: its transport is the cinematic one (each move as long as its performance). */
  const cinematic = view === "replays" && !!record?.match;
  const frame = state.frame;
  const title = view === "battles" ? copy.battles : view === "arenas" ? copy.arenas : copy.replays;
  const archivePageSize = compact ? 2 : 3;
  const totalPages = Math.max(1, Math.ceil(state.library.length / archivePageSize));
  const currentPage = Math.min(archivePage, totalPages - 1);
  const visibleEntries = state.library.slice(currentPage * archivePageSize, (currentPage + 1) * archivePageSize);

  useEffect(() => {
    if (!replayToOpen || view !== 'replays') return;
    session.setSuspended(false);
    void session.load(replayToOpen).then(result => { setNotice(result.message); onReplayOpened?.(); });
  }, [replayToOpen, view, session]);

  useEffect(() => { session.setCinematic(cinematic); }, [session, cinematic]);
  const reachReplay = useCallback((ply: number) => session.reach(ply), [session]);
  const finishReplay = useCallback(() => session.finishPlayback(), [session]);
  useEffect(() => {
    const media = window.matchMedia("(max-height:460px) and (orientation:landscape)");
    const resize = () => setCompact(media.matches);
    media.addEventListener("change", resize);
    return () => media.removeEventListener("change", resize);
  }, []);

  const generate = async () => {
    setNotice("");
    const created = await session.generate({ arena: state.arena });
    if (created && activeView.current === "battles" && !document.hidden) session.play();
  };
  useEffect(() => {
    session.pause();

    setArtwork(false);
    setNotice("");
    // One entry action per route change, not per playback snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);
  useEffect(() => {
    if (!dialog) return;
    dialogRef.current?.showModal();
    cancelRef.current?.focus({ preventScroll: true });
    return () => { dialogRef.current?.close(); };
  }, [dialog]);
  useEffect(() => {
    const move = root.current?.querySelector<HTMLElement>(`.showcase-moves [data-control="move-${state.ply}"]`);
    const list = move?.parentElement;
    if (move && list) {
      const itemBox = move.getBoundingClientRect(), listBox = list.getBoundingClientRect();
      if (itemBox.top < listBox.top) list.scrollTop -= listBox.top - itemBox.top;
      else if (itemBox.bottom > listBox.bottom) list.scrollTop += itemBox.bottom - listBox.bottom;
    }
  }, [state.ply, view]);
  const closeDialog = () => {
    setDialog(null); setDialogError("");
    session.cancelOpening();
    window.requestAnimationFrame(() => {
      if (originFocus.current?.isConnected) originFocus.current.focus({ preventScroll: true });
      else root.current?.querySelector<HTMLElement>('[data-control="import"]')?.focus({ preventScroll: true });
    });
  };
  const openDialog = (value: NonNullable<DialogState>) => {
    session.pause(); session.cancelGeneration(); originFocus.current = document.activeElement as HTMLElement;
    setDialogError(""); setDialog(value);
  };
  const controls = () => Array.from((dialog ? dialogRef.current : root.current)?.querySelectorAll<HTMLElement>("[data-showcase-control]") ?? [])
    .filter(element => {
      const box = element.getBoundingClientRect();
      if (element.hasAttribute("disabled") || !box.width || element.closest("[inert]")) return false;
      const list = element.closest(".showcase-moves");
      if (!list) return true;
      const listBox = list.getBoundingClientRect();
      return box.bottom > listBox.top && box.top < listBox.bottom;
    });
  const focusControl = (element?: HTMLElement) => {
    element?.focus({ preventScroll: true });
    if (element?.closest(".showcase-moves")) element.scrollIntoView({ block: "nearest", inline: "nearest" });
  };
  const chooseOverview = (index: number) => {
    const next = Math.max(0, Math.min(categories.length - 1, index)); setSelected(next);
    focusControl(root.current?.querySelector<HTMLElement>(`[data-control="category-${next}"]`) ?? undefined);
  };
  const focusCurrent = () => {
    if (dialog) { cancelRef.current?.focus(); return; }
    if (view === "overview") chooseOverview(selected);
    else { const items = controls(); focusControl(items.find(item => item.dataset.control === focused.current) ?? items[0]); }
  };
  // The Showcase chunk loads lazily, so App's focus pass on entry can run before it exists: take focus on mount.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { focusCurrent(); }, []);
  useImperativeHandle(ref, () => ({
    move(direction) {
      if (view === "overview" && !dialog) { chooseOverview(selected + (direction === "left" || direction === "up" ? -1 : 1)); return; }
      const moveItem = (document.activeElement as HTMLElement)?.closest<HTMLElement>(".showcase-moves [data-showcase-control]");
      if (moveItem) {
        const moves = Array.from(moveItem.parentElement?.querySelectorAll<HTMLElement>("[data-showcase-control]") ?? []);
        const delta = direction === "left" ? -1 : direction === "right" ? 1 : direction === "up" ? -2 : 2;
        const target = moves[moves.indexOf(moveItem) + delta];
        if (target) { focusControl(target); return; }
      }
      const items = controls();
      const current = items.includes(document.activeElement as HTMLElement) ? document.activeElement as HTMLElement : items.find(item => item.dataset.control === focused.current);
      if (!current) { focusControl(items[0]); return; }
      const box = current.getBoundingClientRect(); const x = box.x + box.width / 2; const y = box.y + box.height / 2;
      const horizontal = direction === "left" || direction === "right";
      const sign = direction === "left" || direction === "up" ? -1 : 1;
      const candidates = items.filter(item => item !== current).map(item => {
        const rect = item.getBoundingClientRect(); const dx = rect.x + rect.width / 2 - x; const dy = rect.y + rect.height / 2 - y;
        const along = horizontal ? dx : dy; const across = horizontal ? dy : dx;
        return { item, along: along * sign, score: Math.abs(along) + Math.abs(across) * 2.8 };
      }).filter(item => item.along > 4).sort((a, b) => a.score - b.score);
      focusControl(candidates[0]?.item ?? current);
    },
    edge(last) { const items = controls(); focusControl(items[last ? items.length - 1 : 0]); },
    activate() {
      const active = document.activeElement as HTMLElement;
      if (controls().includes(active)) active.click();
      else if (view === "overview") onViewChange(categories[selected].id);
      else focusControl(controls()[0]);
    },
    focus: focusCurrent,
    reset() { /* Replay controls do not change menu preferences. */ },
    cancel() { if (dialog) { closeDialog(); return true; } return false; },
  }));
  const back = () => { session.pause(); onBackRoot(); };
  // A cinematic replay plays on from where the timeline is put; the procedural viewer pauses there.
  const seek = (ply: number) => { if (cinematic) session.seek(ply, true); else { session.pause(); session.seek(ply); } };
  const openReplay = async (entry: ReplayEntry) => {
    const result = await session.load(entry, false); setNotice(result.message);
    if (result.ok) setArtwork(false);
  };
  const importReplay = async (text: string) => {
    setDialogError("");
    const result = await session.import(text);
    if (!result.ok) { setDialogError(result.message); return; }
    setNotice(result.message); setImportText(""); closeDialog();
  };
  const status = opening ? copy.openingReplay : generating ? copy.generating : !record ? copy.opening : state.ended ? (record.termination === "move-limit" ? copy.moveLimit : record.match ? `${copy.matchComplete} · ${record.result}` : copy.complete) : frame?.check ? `${frame.turn === "w" ? copy.white : copy.black} · ${copy.check}` : frame?.turn === "w" ? copy.white : copy.black;
  const operationMessage = notice || state.error || state.message;
  const stagePreferences = { automaticGraphics, quality, renderScale, frameLimit, reducedMotion };


  return <section ref={root} className={`showcase-screen${reducedMotion ? " showcase-screen--still" : ""}`} aria-label="Showcase" data-showcase-view={view} data-showcase-phase={state.phase} data-showcase-playing={state.playing} onFocusCapture={event => { const key = (event.target as HTMLElement).dataset.control; if (key) focused.current = key; }}>
    {view === "overview" ? <section className="showcase-overview" aria-label="Showcase options">
      {categories.map((category, index) => <button key={category.id} data-showcase-control data-control={`category-${index}`} className={`showcase-tile showcase-tile--${category.id}${selected === index ? " is-selected" : ""}`} type="button" aria-label={t(category.label)} aria-pressed={selected === index} tabIndex={selected === index ? 0 : -1} onFocus={() => setSelected(index)} onClick={() => { setSelected(index); onViewChange(category.id); }}>
        {category.art ? <img className="showcase-tile-art" src={publicUrl(category.art)} alt="" draggable={false} /> : <ArchiveArt />}
        <span className="showcase-tile-shade" aria-hidden="true" /><span className="showcase-tile-heading"><span className="showcase-eyebrow">{t(category.status)}</span><span className="showcase-title">{t(category.title)}</span></span>
        <ShowcaseIcon kind={category.id} /><span className="showcase-tile-foot"><span>{t(category.description)}</span><span aria-hidden="true">↗</span></span>
      </button>)}
    </section> : (['arenas', 'battles'] as ShowcaseView[]).includes(view) ? <GameplayShowcase key={view} kind={view as "arenas" | "battles"} setting={setting} onSettingChange={setSetting} preferences={stagePreferences} onBack={back} onViewChange={onViewChange} onBattleRecord={setBattleEntry} onWatchReplay={(entry, ply, autoplay) => { session.setSuspended(false); onViewChange('replays'); void session.load(entry, autoplay).then(result => { if (result.ok && ply !== undefined) session.seek(ply); }); }} /> : <section className={`showcase-detail showcase-detail--${view}`} aria-label={title}>
      <header className="showcase-detail-header"><div><span className="showcase-eyebrow">CROWNFALL / {copy.title}</span><h1>{title}</h1></div><span className="showcase-local-indicator"><i />{view === "arenas" ? copy.arenaPreview : record?.match ? copy.recordedMatch : record?.source === "import" ? copy.imported : copy.local}</span></header>
      <div className="showcase-stage-wrap">
        {cinematic ? <ReplayStage ref={replayStage} record={record} ply={state.ply} playing={state.playing} speed={state.speed} battlesOnly={battlesOnly} camera={matchCamera} preferences={stagePreferences} onReach={reachReplay} onFinish={finishReplay} onStatus={setReplayStatus} />
          : <ShowcaseStageView frame={frame} arena={state.arena} camera={camera} preferences={stagePreferences} />}
        {artwork && <div className="showcase-artwork"><img src={publicUrl(arenas[state.arena].artwork)} alt={arenas[state.arena].alt} /><span>Environment artwork</span></div>}
        <div className="showcase-stage-topline"><span>{record?.match ? record.match.setting === "scene-01" ? "Eclipse" : "Violet Night" : arenas[state.arena].label}</span><span>{artwork ? "ARTWORK" : "LIVE 3D"}</span></div>
        {!artwork && (cinematic ? <div className="showcase-camera-group" role="group" aria-label={copy.view}>{([["match", copy.matchView], ["cinematic", copy.cinematic], ["top", copy.board], ["black", copy.detail]] as const).map(([mode, label]) => <button key={mode} type="button" data-showcase-control data-control={`camera-${mode === "top" ? "board" : mode === "black" ? "side" : mode}`} aria-pressed={matchCamera === mode} onClick={() => setMatchCamera(mode)}>{label}</button>)}</div>
          : <div className="showcase-camera-group" role="group" aria-label={copy.view}>{(["cinematic", "board", "side"] as const).map(mode => <button key={mode} type="button" data-showcase-control data-control={`camera-${mode}`} aria-pressed={camera === mode} onClick={() => setCamera(mode)}>{mode === "side" ? copy.detail : copy[mode]}</button>)}</div>)}
        {cinematic && replayStatus.ready && (replayStatus.performing === "battle" || replayStatus.performing === "ending") && <button type="button" className="showcase-replay-skip" data-showcase-control data-control="skip-fight" onClick={() => replayStage.current?.skip()}>{replayStatus.performing === "ending" ? copy.skipEnding : copy.skipFight}</button>}
        {busy && <div className="showcase-generation" role="status"><span className="showcase-generation-seal" aria-hidden="true">♜</span><strong>{opening ? copy.openingReplay : copy.generating}</strong><progress value={opening ? undefined : state.progress} max={1} />{!opening && <span>{Math.round(state.progress * 100)}%</span>}</div>}
      </div>
      <aside className="showcase-information" aria-label={view === "arenas" ? "Arena selection" : view === "replays" ? copy.archive : "Exhibition information"}>
        {view === "arenas" ? <>
          <div className="showcase-panel-heading"><span className="showcase-eyebrow">04 / ENVIRONMENTS</span><h2>{arenas[state.arena].label}</h2><p>Original tabletop stages inspired by the environment artwork.</p></div>
          <div className="showcase-arena-selectors" role="group" aria-label="Choose an arena">{arenas.map(arena => <button type="button" data-showcase-control data-control={`arena-${arena.id}`} key={arena.id} className={`showcase-arena-option${state.arena === arena.id ? " is-selected" : ""}`} aria-pressed={state.arena === arena.id} onClick={() => session.setArena(arena.id)}><img src={publicUrl(arena.artwork)} alt="" /><span>{arena.label}</span><span className="showcase-arena-number">0{arena.id + 1}</span></button>)}</div>
          <div className="showcase-panel-actions"><button type="button" data-showcase-control data-control="artwork" className="showcase-text-action" aria-pressed={artwork} onClick={() => setArtwork(value => !value)}>{artwork ? "Return to 3D stage" : "View original artwork"}<span>↗</span></button><button type="button" data-showcase-control data-control="watch-arena" className="showcase-primary-action" onClick={() => onViewChange("battles")}>{copy.watch}<Glyph kind="play" /></button></div>
        </> : <>
          <div className="showcase-now-playing"><span className="showcase-eyebrow">{view === "replays" ? copy.archive : copy.exhibition}</span><div className="showcase-current-move"><strong>{frame?.move?.san ?? "—"}</strong><span>{record ? `${Math.ceil(state.ply / 2)} / ${Math.ceil(maxPly / 2)}` : "READY"}</span></div><p className="showcase-game-status">{status}</p>{record?.declaredResult && <span className="showcase-recorded-result">{copy.recordedResult}: {record.declaredResult}</span>}</div>
          {view === "replays" ? <div className="showcase-archive-panel">
            {archiveLoading ? <div className="showcase-archive-loading" role="status"><Glyph kind="replays" /><span>{copy.loadingArchive}</span><i /><i /><i /></div> : state.library.length ? <><div className="showcase-archive-list">{visibleEntries.map(entry => <div key={entry.id} className={`showcase-replay-row${record?.id === entry.id ? " is-current" : ""}`}><button type="button" data-showcase-control data-control={`replay-${entry.id}`} disabled={busy} onClick={() => openReplay(entry)}><Glyph kind="replays" /><span><strong>{entry.match ? `${entry.match.white} vs ${entry.match.black}` : entry.title}</strong><small>{entry.match ? `${matchModeLabel(entry.match.mode)} · ${entry.result} · ` : ""}{readableDate(entry.createdAt)} · {entry.plies} plies</small></span><span className="showcase-replay-open" aria-label={copy.open}>▷</span></button><button type="button" data-showcase-control data-control={`delete-${entry.id}`} className="showcase-delete-button" disabled={archiveLoading || busy} aria-label={`${copy.delete} ${entry.title}`} onClick={() => openDialog({ kind: "delete", entry })}>×</button></div>)}</div><div className="showcase-archive-paging"><button type="button" data-showcase-control data-control="archive-previous" disabled={currentPage === 0} aria-label="Previous archive page" onClick={() => setArchivePage(value => value - 1)}>‹</button><span>{copy.page} {currentPage + 1} / {totalPages}</span><button type="button" data-showcase-control data-control="archive-next" disabled={currentPage === totalPages - 1} aria-label="Next archive page" onClick={() => setArchivePage(value => value + 1)}>›</button></div></> : <div className="showcase-empty"><Glyph kind="replays" /><h2>{copy.emptyTitle}</h2><p>{copy.emptyBody}</p><button type="button" data-showcase-control data-control="empty-create" className="showcase-text-action" onClick={() => onViewChange("battles")}>{copy.emptyAction}<span>↗</span></button></div>}
          </div> : <div className="showcase-move-panel"><h2>{copy.moveList}<span>{state.ply} / {maxPly}</span></h2><div className="showcase-moves" aria-label={copy.moves}>{record ? record.moves.map((move, index) => <button type="button" key={index} data-showcase-control data-control={`move-${index + 1}`} disabled={busy} className={state.ply === index + 1 ? "is-current" : ""} aria-label={`Move ${index + 1}: ${move}`} aria-current={state.ply === index + 1 ? "step" : undefined} onClick={() => seek(index + 1)}><small>{index % 2 === 0 ? `${Math.floor(index / 2) + 1}.` : ""}</small>{move}</button>) : <p>{copy.generating}</p>}</div></div>}
          <div className="showcase-panel-actions"><button type="button" data-showcase-control data-control="new-exhibition" disabled={busy} className="showcase-primary-action" onClick={() => { session.pause(); onViewChange("battles"); }}>{copy.newBattle}<Glyph kind="new" /></button>{view === "battles" && <button type="button" data-showcase-control data-control="open-archive" className="showcase-text-action" onClick={() => onViewChange("replays")}>{copy.archive}<span>{state.library.length.toString().padStart(2, "0")} ↗</span></button>}</div>
        </>}
      </aside>
      {view === "arenas" ? <div className="showcase-arena-bottom"><span>0{state.arena + 1}<small> / 04</small></span><p>Choose a stage. Keep the board in view.</p></div> : <section className="showcase-transport" aria-label="Playback controls">
        <div className="showcase-timeline"><span>{state.ply.toString().padStart(2, "0")}</span><input type="range" min={0} max={maxPly || 1} value={state.ply} disabled={!record || busy} aria-label="Replay timeline" data-showcase-control data-control="timeline" onChange={event => seek(Number(event.target.value))} /><span>{maxPly.toString().padStart(2, "0")}</span></div>
        <div className="showcase-playback-row"><div className="showcase-playback-buttons">{([{ kind: "first", label: copy.first, action: () => seek(0), disabled: !state.ply }, { kind: "previous", label: copy.previous, action: () => seek(state.ply - 1), disabled: !state.ply }, { kind: state.playing ? "pause" : "play", label: state.playing ? copy.pause : state.ended ? copy.restart : copy.play, action: () => session.toggle(), disabled: false }, { kind: "next", label: copy.next, action: () => { if (cinematic) replayStage.current?.next(); else seek(state.ply + 1); }, disabled: state.ply === maxPly }, { kind: "last", label: copy.last, action: () => seek(maxPly), disabled: state.ply === maxPly }] as const).map(button => <button key={button.kind === "pause" ? "play" : button.kind} type="button" data-showcase-control data-control={`transport-${button.kind === "pause" ? "play" : button.kind}`} className={button.kind === "play" || button.kind === "pause" ? "showcase-play-toggle" : ""} aria-label={button.label} disabled={!record || busy || button.disabled} onClick={button.action}><Glyph kind={button.kind} /></button>)}</div><div className="showcase-speed" role="group" aria-label={copy.speed}>{PLAYBACK_SPEEDS.map(speed => <button key={speed} type="button" data-showcase-control data-control={`speed-${speed}`} aria-pressed={state.speed === speed} onClick={() => session.setSpeed(speed)}>{speed}×</button>)}{cinematic && <button type="button" data-showcase-control data-control="battles-only" className="showcase-battles-only" aria-pressed={battlesOnly} title={copy.battlesOnlyDetail} onClick={() => setBattlesOnly(value => !value)}>{copy.battlesOnly}</button>}</div><button type="button" data-showcase-control data-control="save" className="showcase-save" disabled={!record || busy || state.saved || archiveLoading} onClick={() => { const result = session.save(); setNotice(result.message); }}><Glyph kind="save" />{state.saved ? "Saved" : copy.save}</button></div>
      </section>}
      <div className="showcase-feedback" role="status" aria-live="polite">{operationMessage || (archiveLoading ? copy.loadingArchive : state.storage === "corrupt" ? copy.corrupt : state.storage === "session" ? copy.unavailable : copy.localOnly)}</div>
    </section>}
    <footer className="showcase-footer" aria-label="Showcase controls"><button className="showcase-footer-button" type="button" data-showcase-control data-control="back" aria-label="Back" onClick={back}><span className="controller-key" aria-hidden="true"><InputPrompt action="back" /></span>{t("Back")}</button>{view === "overview" ? <span className="showcase-footer-note">{t("Select an experience")}</span> : <>{view !== "arenas" && <div className="showcase-file-actions"><button type="button" data-showcase-control data-control="reload-archive" disabled={archiveLoading || busy} onClick={async () => { session.pause(); const result = await session.reloadArchive(); setNotice(result.message); }}>{copy.reloadArchive}</button><button type="button" data-showcase-control data-control="import" disabled={archiveLoading || busy} onClick={() => { if (view === "battles") onViewChange("replays"); openDialog({ kind: "import" }); }}>{copy.import}</button><button type="button" data-showcase-control data-control="export" disabled={view === "battles" ? !battleEntry : !record} onClick={() => download(view === "battles" ? battleEntry!.pgn : session.exportPGN(), "crownfall-replay.pgn", "application/x-chess-pgn")}>{copy.export}</button><button type="button" data-showcase-control data-control="export-json" disabled={view === "battles" ? !battleEntry : !record} onClick={() => download(view === "battles" ? JSON.stringify({ format: "crownfall-showcase-replay", version: 1, entry: battleEntry }, null, 2) : session.exportJSON(), "crownfall-replay.json", "application/json")}>{copy.exportJSON}</button></div>}</>}</footer>
    {dialog && <dialog ref={dialogRef} className="showcase-dialog" aria-labelledby="showcase-dialog-title" onCancel={event => { event.preventDefault(); closeDialog(); }}><div className="showcase-dialog-content"><span className="showcase-eyebrow">CROWNFALL</span><h2 id="showcase-dialog-title">{dialog.kind === "delete" ? copy.deleteTitle : copy.import}</h2><p>{dialog.kind === "delete" ? copy.deleteBody : copy.importDescription}</p>{dialog.kind === "import" && <><textarea aria-label="Replay PGN or JSON" data-showcase-control data-control="import-text" disabled={opening} value={importText} onChange={event => setImportText(event.target.value)} placeholder="Paste PGN or Crownfall replay JSON" maxLength={MAX_ARCHIVE_BYTES} /><input ref={fileRef} type="file" accept=".pgn,.json,.txt" className="showcase-file-input" aria-label="Choose replay file" onChange={async event => { const input = event.currentTarget; const file = input.files?.[0]; input.value = ""; if (!file) return; if (file.size > MAX_ARCHIVE_BYTES) { setDialogError("This replay file is too large."); return; } try { const text = await file.text(); setImportText(text); setDialogError(""); } catch { setDialogError("The replay file could not be read. Choose another file."); } }} /><button type="button" data-showcase-control data-control="choose-file" disabled={opening} className="showcase-text-action" onClick={() => fileRef.current?.click()}>Choose local file<span>↗</span></button></>}{opening && <p role="status">{copy.openingReplay}</p>}{dialogError && <p className="showcase-dialog-error" role="alert">{dialogError}</p>}<div className="showcase-dialog-actions"><button type="button" data-showcase-control data-control="dialog-confirm" disabled={opening || archiveLoading || (dialog.kind === "import" && !importText.trim())} onClick={() => { if (dialog.kind === "import") importReplay(importText); else { const result = session.removeReplay(dialog.entry.id); if (result.ok) { setNotice(result.message); closeDialog(); } else setDialogError(result.message); } }}><span className="controller-key" aria-hidden="true"><InputPrompt action="select" /></span>{dialog.kind === "delete" ? copy.confirmDelete : copy.import}</button><button ref={cancelRef} type="button" data-showcase-control data-control="dialog-cancel" onClick={closeDialog}><span className="controller-key" aria-hidden="true"><InputPrompt action="back" /></span>{copy.cancel}</button></div></div></dialog>}
  </section>;
});
