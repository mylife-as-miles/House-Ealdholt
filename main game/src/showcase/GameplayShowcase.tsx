import { useMenuLocale } from "../MenuLocale";
import { useEffect, useMemo, useRef, useState } from 'react';
import { BATTLEFIELDS, type MatchConfig, type GamePortSetting } from '../../../shared/play/match';
import { SHOWCASE_ARENAS as artwork, SHOWCASE_COPY as sourceCopy, PLAYBACK_SPEEDS } from '../../../shared/showcase/catalog';
import type { ReplayEntry } from '../../../shared/showcase/types';
import type { GameSnapshot } from '../../../web/src/core/types';
import type { StagePreferences } from './ShowcaseStageView';
import GameplayStage from './GameplayStage';
import MatchExperience, { type SpectatorControls } from '../play/MatchExperience';
import { ShowcaseGlyph as Glyph } from './ShowcaseGlyph';
import { saveMatchReplay } from './match-replays';
import '../play/play.css';

/** The approved Showcase frame and controls, backed by the real match runtime. */
export default function GameplayShowcase({ kind, setting, onSettingChange, preferences, onBack, onWatchReplay, onViewChange, onBattleRecord }: {
  kind: 'arenas' | 'battles'; setting: GamePortSetting; onSettingChange(value: GamePortSetting): void;
  preferences: StagePreferences; onBack(): void; onViewChange(view: 'battles' | 'replays'): void;
  onWatchReplay(entry: ReplayEntry, ply?: number, autoplay?: boolean): void;
  onBattleRecord(entry: ReplayEntry | null): void;
}) {
  const { t } = useMenuLocale();
  const copy = Object.fromEntries(Object.entries(sourceCopy).map(([key, value]) => [key, t(value)])) as Record<keyof typeof sourceCopy, string>;
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(null);
  const [controls, setControls] = useState<SpectatorControls | null>(null);
  const [completed, setCompleted] = useState<ReplayEntry | null>(null);
  const [round, setRound] = useState(0), [speed, setSpeed] = useState(1);
  const [camera, setCamera] = useState<'cinematic' | 'top' | 'black'>('cinematic');
  const [showArtwork, setShowArtwork] = useState(false), [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false), [saved, setSaved] = useState(false);
  const events = useRef({ onBattleRecord }); events.current = { onBattleRecord };
  const config = useMemo<MatchConfig>(() => ({ mode: 'ai-battle', setting, difficulty: 'easy', playerColor: 'w', clockMinutes: null }), [setting]);
  const field = BATTLEFIELDS.find(item => item.id === setting)!;
  const fieldIndex = BATTLEFIELDS.findIndex(item => item.id === setting);
  const moves = snapshot?.sanList ?? [];
  const ready = !!controls;
  const reset = () => { setSnapshot(null); setControls(null); setCompleted(null); setSaved(false); setNotice(''); events.current.onBattleRecord(null); };
  useEffect(() => { reset(); setShowArtwork(false); }, [setting]);
  useEffect(() => { controls?.camera(camera); }, [controls, camera]);
  useEffect(() => { controls?.speed(speed); }, [controls, speed]);
  // A new exhibition is played on the battlefield already up (MatchExperience rematches in place, A-01); only Retry
  // after a failure loads it afresh.
  const [attempt, setAttempt] = useState(0);
  const restart = () => { reset(); setRound(value => value + 1); };
  const retryLoad = () => { reset(); setAttempt(value => value + 1); };
  // The embedded match shows no HUD of its own, so a computer that failed to answer is said here, with its retry:
  // the controller pauses the battle on that failure, and resuming it asks the computer again.
  const failed = !completed && snapshot?.engineError ? t(snapshot.engineError) : null;
  const retry = () => { if (snapshot?.paused) controls?.pause(); };
  const status = failed ?? (completed ? `${copy.matchComplete} · ${completed.result}` : !ready ? 'Preparing the battlefield' : `${snapshot?.turn === 'b' ? copy.black : copy.white}${snapshot?.thinking ? ' · thinking…' : snapshot?.inCheck ? ` · ${copy.check}` : ''}`);
  const seek = (ply: number) => { if (completed) onWatchReplay(completed, ply); };
  const toggle = () => { if (completed) onWatchReplay(completed, undefined, true); else controls?.pause(); };
  const save = async () => {
    if (!completed) return;
    setSaving(true);
    try { const result = await saveMatchReplay(completed); setNotice(result.message); setSaved(result.ok); }
    catch { setNotice('The replay could not be saved. Try again.'); }
    finally { setSaving(false); }
  };
  return <>
    <section className={`showcase-detail showcase-detail--${kind}`} aria-label={kind === 'arenas' ? copy.arenas : copy.battles}>
      <header className="showcase-detail-header"><div><span className="showcase-eyebrow">CROWNFALL / {copy.title}</span><h1>{kind === 'arenas' ? copy.arenas : copy.battles}</h1></div><span className="showcase-local-indicator"><i />{kind === 'arenas' ? copy.arenaPreview : copy.local}</span></header>
      <div className="showcase-stage-wrap">
        {kind === 'arenas' ? <GameplayStage setting={setting} camera={camera} preferences={preferences} /> : <MatchExperience key={`${setting}-${attempt}`} round={round} embedded config={config} quality={preferences.quality} automaticGraphics={preferences.automaticGraphics} renderScale={preferences.renderScale} frameLimit={preferences.frameLimit} reducedMotion={preferences.reducedMotion} onBack={onBack} onSetup={onBack} onRetry={retryLoad} onSnapshot={setSnapshot} onSpectatorReady={setControls} onReplayReady={entry => { setCompleted(entry); events.current.onBattleRecord(entry); }} />}
        {showArtwork && <div className="showcase-artwork"><img src={artwork[fieldIndex].artwork} alt={artwork[fieldIndex].alt} /><span>{t('Environment artwork')}</span></div>}
        <div className="showcase-stage-topline"><span>{t(field.subtitle)}</span><span>{showArtwork ? 'ARTWORK' : 'LIVE 3D'}</span></div>
        {!showArtwork && <div className="showcase-camera-group" role="group" aria-label={copy.view}>{([{ id: 'cinematic', label: copy.cinematic }, { id: 'top', label: copy.board }, { id: 'black', label: copy.detail }] as const).map(item => <button key={item.id} data-showcase-control data-control={`camera-${item.id}`} aria-pressed={camera === item.id} onClick={() => setCamera(item.id)}>{item.label}</button>)}</div>}
      </div>
      <aside className="showcase-information" aria-label={kind === 'arenas' ? 'Arena selection' : 'Exhibition information'}>
        {kind === 'arenas' ? <>
          <div className="showcase-panel-heading"><span className="showcase-eyebrow">02 / ENVIRONMENTS</span><h2>{t(field.subtitle)}</h2><p>{t('Battlefields used in Classic and Local Duel.')}</p></div>
          <div className="showcase-arena-selectors" role="group" aria-label="Choose an arena">{BATTLEFIELDS.map((item, index) => <button key={item.id} data-showcase-control data-control={`arena-${item.id}`} className={`showcase-arena-option${setting === item.id ? ' is-selected' : ''}`} aria-pressed={setting === item.id} onClick={() => onSettingChange(item.id)}><img src={artwork[index].artwork} alt="" /><span>{t(item.subtitle)}</span><span className="showcase-arena-number">0{index + 1}</span></button>)}</div>
          <div className="showcase-panel-actions"><button data-showcase-control data-control="artwork" className="showcase-text-action" aria-pressed={showArtwork} onClick={() => setShowArtwork(value => !value)}>{showArtwork ? 'Return to 3D stage' : 'View original artwork'}<span>↗</span></button><button data-showcase-control data-control="watch-arena" className="showcase-primary-action" onClick={() => onViewChange('battles')}>{copy.watch}<Glyph kind="play" /></button></div>
        </> : <>
          <div className="showcase-now-playing"><span className="showcase-eyebrow">{copy.exhibition}</span><div className="showcase-current-move"><strong>{moves.at(-1) ?? '—'}</strong><span>{ready ? `${Math.ceil(moves.length / 2)}` : 'READY'}</span></div><p className="showcase-game-status" role={failed ? "alert" : undefined}>{status}</p></div>
          <div className="showcase-move-panel"><h2>{copy.moveList}<span>{moves.length}</span></h2><div className="showcase-moves" aria-label={copy.moves}>{moves.map((move, index) => <button key={index} data-showcase-control data-control={`move-${index + 1}`} disabled={!completed} className={index === moves.length - 1 ? 'is-current' : ''} onClick={() => seek(index + 1)}><small>{index % 2 === 0 ? `${Math.floor(index / 2) + 1}.` : ''}</small>{move}</button>)}</div></div>
          <div className="showcase-panel-actions">{failed && <button data-showcase-control data-control="retry-computer" className="showcase-primary-action" onClick={retry}>{t("Retry computer")}<Glyph kind="play" /></button>}<button data-showcase-control data-control="new-exhibition" className="showcase-primary-action" onClick={restart}>{copy.newBattle}<Glyph kind="new" /></button><button data-showcase-control data-control="open-archive" className="showcase-text-action" onClick={() => completed ? onWatchReplay(completed) : onViewChange('replays')}>{completed ? 'Watch Replay' : copy.archive}<span>↗</span></button></div>
        </>}
      </aside>
      {kind === 'arenas' ? <div className="showcase-arena-bottom"><span>0{fieldIndex + 1}<small> / 02</small></span><p>{t('Choose a stage. Keep the board in view.')}</p></div> : <section className="showcase-transport" aria-label="Playback controls">
        <div className="showcase-timeline"><span>{moves.length.toString().padStart(2, '0')}</span><input type="range" min={0} max={moves.length || 1} value={moves.length} disabled={!completed} aria-label="Replay timeline" data-showcase-control data-control="timeline" onChange={event => seek(Number(event.target.value))} /><span>{moves.length.toString().padStart(2, '0')}</span></div>
        <div className="showcase-playback-row"><div className="showcase-playback-buttons">{([{ kind: 'first', label: copy.first, action: () => seek(0), disabled: !completed }, { kind: 'previous', label: copy.previous, action: () => seek(Math.max(0, moves.length - 1)), disabled: !completed }, { kind: snapshot?.paused || completed ? 'play' : 'pause', label: completed ? copy.restart : snapshot?.paused ? copy.play : copy.pause, action: toggle, disabled: !ready }, { kind: 'next', label: copy.next, action: () => seek(moves.length), disabled: true }, { kind: 'last', label: copy.last, action: () => seek(moves.length), disabled: !completed }] as const).map(item => <button key={item.kind === 'pause' ? 'play' : item.kind} data-showcase-control data-control={`transport-${item.kind}`} className={item.kind === 'play' || item.kind === 'pause' ? 'showcase-play-toggle' : ''} aria-label={item.label} disabled={item.disabled} onClick={item.action}><Glyph kind={item.kind} /></button>)}</div><div className="showcase-speed" role="group" aria-label={copy.speed}>{PLAYBACK_SPEEDS.map(value => <button key={value} data-showcase-control data-control={`speed-${value}`} aria-pressed={speed === value} onClick={() => setSpeed(value)}>{value}×</button>)}</div><button data-showcase-control data-control="save" className="showcase-save" disabled={!completed || saving || saved} onClick={save}><Glyph kind="save" />{saved ? 'Saved' : copy.save}</button></div>
      </section>}
      <div className="showcase-feedback" role="status" aria-live="polite">{notice || (kind === 'arenas' ? 'Drag to explore. Scroll to zoom.' : 'Live computer match. Completed battles can be saved as replays.')}</div>
    </section>
  </>;
}
