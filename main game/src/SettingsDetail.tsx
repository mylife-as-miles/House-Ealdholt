import { InputPrompt } from "./InputPrompt";
import { useMenuLocale } from "./MenuLocale";
import { SUPPORTED_LOCALES, normalizeLocale } from "../../shared/menu/localization";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { ControlsPanel } from "./ControlsPanel";
import { AUDIO_SETTINGS_COPY, type MenuAudioStatus } from "../../shared/menu/audio";
import { NOW_PLAYING_COPY } from "../../shared/menu/soundtrack";
import { SETTINGS_LICENSE_COPY, SETTINGS_STORAGE_COPY } from "../../shared/menu/settings";
import { creditsFilmRow } from "../../shared/menu/credits-film";
import { openingFilmRow } from "../../shared/menu/opening-film";
import { InputDiagram } from "./InputDiagram";
import { VIOLENCE_COPY, VIOLENCE_INTENSITIES, cycleViolenceIntensity, normalizeViolenceIntensity, violenceIntensityRow } from "../../shared/menu/violence";
import { INITIAL_PREFERENCES, SUBTITLE_SIZES, type Direction, type FrameLimit, type Preferences, type Quality, type SettingsCategory, type SettingsPageHandle, type SubtitleSize } from "./settings-types";
import "./SettingsDetail.css";

export interface SettingsDetailProps {
  category: SettingsCategory;
  preferences: Preferences;
  onChange(preferences: Preferences): void;
  onBack(): void;
  preferencesSaved: boolean;
  audioStatus: MenuAudioStatus | null;
  onTestSound(): void;
  /** Skips to the menu soundtrack's next track. Without it (inside a match, where the match has its own sound and the
   * soundtrack is silent) the soundtrack's rows are left out. */
  onNextTrack?(): void;
  /** Opens the end-credits film over this page. Without it (inside a match) its row is left out. */
  onPlayCredits?(): void;
  /** Replays the whole opening film over the Credits page. Without it (inside a match) its row is left out. */
  onPlayOpening?(): void;
  /** The film's notice for the Credits page, such as a playback failure. */
  creditsStatus?: string;
  reducedMotion: boolean;
  onRetrySave(): void;
  onRequestReset(apply: () => void): void;
}

interface SettingsRow {
  id: string;
  label: string;
  value: string;
  description: string;
  section?: string;
  kind?: "toggle" | "choice" | "range" | "fullscreen" | "action";
  number?: number;
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string; label: string; disabled?: boolean }[];
  selectedValue?: string;
  change?(value: string | number | boolean): void;
  adjust?(direction: number): void;
}

function cycle<T>(values: readonly T[], current: T, direction: number): T {
  return values[(values.indexOf(current) + direction + values.length) % values.length];
}

const subtitleSizeLabel = (size: SubtitleSize) => size[0].toUpperCase() + size.slice(1);

const PreferencePage = forwardRef<SettingsPageHandle, SettingsDetailProps>(function PreferencePage({ category, preferences, onChange, onBack, preferencesSaved, audioStatus, onTestSound, onNextTrack, onPlayCredits, onPlayOpening, creditsStatus, reducedMotion, onRetrySave, onRequestReset }, ref) {
  const { t } = useMenuLocale();
  const [active, setActive] = useState(0);
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight, ratio: Math.min(window.devicePixelRatio, 1.5) }));
  const [fullscreen, setFullscreen] = useState(() => !!document.fullscreenElement);
  const [fullscreenError, setFullscreenError] = useState("");
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const p = preferences;
  const musicStatus = AUDIO_SETTINGS_COPY.musicStatus[audioStatus?.musicState ?? "idle"];
  const fullscreenAvailable = !!document.fullscreenElement || Boolean(document.fullscreenEnabled && typeof document.documentElement.requestFullscreen === "function");
  const update = (patch: Partial<Preferences>) => onChange({ ...p, ...patch });

  useEffect(() => {
    const resize = () => setViewport({ width: window.innerWidth, height: window.innerHeight, ratio: Math.min(window.devicePixelRatio, 1.5) });
    const change = () => { setFullscreen(!!document.fullscreenElement); setFullscreenError(""); };
    window.addEventListener("resize", resize);
    document.addEventListener("fullscreenchange", change);
    return () => { window.removeEventListener("resize", resize); document.removeEventListener("fullscreenchange", change); };
  }, []);

  const toggleFullscreen = async () => {
    setFullscreenError("");
    try {
      if (document.fullscreenElement) { onChange({ ...preferences, fullscreen: false }); await document.exitFullscreen(); }
      else if (document.fullscreenEnabled) { await document.documentElement.requestFullscreen(); onChange({ ...preferences, fullscreen: true }); }
      else setFullscreenError("Fullscreen is unavailable in this browser.");
    } catch {
      setFullscreenError("The browser did not allow fullscreen. Try the on-screen button.");
    }
  };

  let rows: SettingsRow[];
  if (category === "general") {
    rows = [
      { id: "language", label: "Language", value: SUPPORTED_LOCALES.find(item => item.value === p.locale)!.label, selectedValue: p.locale, kind: "choice", options: [...SUPPORTED_LOCALES], change: value => update({ locale: normalizeLocale(value) }), adjust: direction => update({ locale: cycle(SUPPORTED_LOCALES.map(item => item.value), p.locale, direction) }), description: "Choose the language used by the Crownfall menus. Your choice is saved on this device." },
      { id: "ambient-motion", label: "Ambient Motion", value: p.motion ? "On" : "Off", kind: "toggle", change: () => update({ motion: !p.motion }), adjust: () => update({ motion: !p.motion }), description: "Animate menu transitions, the sorcerer, and ambient particles. Your device’s reduced-motion preference always takes priority." },
      { id: "show-hints", label: "Control Hints", value: p.showHints ? "On" : "Off", kind: "toggle", change: () => update({ showHints: !p.showHints }), adjust: () => update({ showHints: !p.showHints }), description: "Show the control prompts along the bottom of the menu." },
      // Shared with Quest: how much blood a capture shows in a match.
      { ...violenceIntensityRow(p.violence, { match: true }), selectedValue: p.violence, kind: "choice", options: VIOLENCE_INTENSITIES.map(level => ({ value: level, label: VIOLENCE_COPY.values[level] })), change: value => update({ violence: normalizeViolenceIntensity(value) }), adjust: direction => update({ violence: cycleViolenceIntensity(p.violence, direction) }) },
      { id: "experience", label: "Experience", value: "Desktop", description: "Desktop and landscape screens. The Quest version uses hands in an immersive session." },
      { id: "save-preferences", label: "Save Preferences", value: preferencesSaved ? SETTINGS_STORAGE_COPY.saved : SETTINGS_STORAGE_COPY.session, kind: preferencesSaved ? undefined : "action", change: onRetrySave, adjust: onRetrySave, description: preferencesSaved ? SETTINGS_STORAGE_COPY.savedDescription : SETTINGS_STORAGE_COPY.sessionDescription },
    ];
  } else if (category === "video") {
    const qualityOptions = [{ value: "low", label: "Low" }, { value: "medium", label: "Medium" }, { value: "high", label: "High" }];
    const isPreset = p.renderScale === { low: 75, medium: 90, high: 100 }[p.quality];
    const setQuality = (quality: Quality | "auto") => quality === "auto" ? update({ automaticGraphics: true, renderScale: 100 }) : update({ quality, automaticGraphics: false, renderScale: { low: 75, medium: 90, high: 100 }[quality] });
    const resolutionScales = Array.from({ length: 11 }, (_, index) => 50 + index * 5);
    const resolutionLabel = (scale: number) => `${Math.floor(viewport.width * viewport.ratio * scale / 100)} × ${Math.floor(viewport.height * viewport.ratio * scale / 100)} (${scale}%)`;
    rows = [
      { id: "screen-resolution", label: "Render Resolution", value: resolutionLabel(p.renderScale), selectedValue: String(p.renderScale), kind: "choice", options: resolutionScales.map(scale => ({ value: String(scale), label: resolutionLabel(scale) })), change: value => update({ renderScale: Number(value) }), adjust: direction => update({ renderScale: Math.max(50, Math.min(100, p.renderScale + direction * 5)) }), section: "General Settings", description: `Choose the internal 3D rendering resolution. Text stays sharp. This follows Resolution Scale; the browser controls the ${viewport.width} × ${viewport.height} display area. Resize the window or use Fullscreen for a larger display area.` },
      { id: "window-mode", label: "Window Mode", value: fullscreen ? "Fullscreen" : fullscreenAvailable ? "Windowed" : "Unavailable", kind: fullscreenAvailable ? "fullscreen" : undefined, change: () => { void toggleFullscreen(); }, adjust: () => { void toggleFullscreen(); }, description: fullscreenError || (fullscreenAvailable ? "Switch between the browser window and fullscreen. Browser permissions and a direct button press may be required." : "Fullscreen is unavailable in this browser. The menu follows the browser window.") },
      { id: "resolution-scale", label: "Resolution Scale", value: `${p.renderScale}`, kind: "range", number: p.renderScale, min: 50, max: 100, step: 5, change: (value) => update({ renderScale: Number(value) }), adjust: (direction) => update({ renderScale: Math.max(50, Math.min(100, p.renderScale + direction * 5)) }), description: "Adjust internal 3D resolution in menus, Play and Showcase. Lower values can improve performance. Menu text and artwork stay sharp." },
      { id: "frame-limit", label: "Frame Rate Limit", value: p.frameLimit === 0 ? "Unlimited" : String(p.frameLimit), kind: "choice", options: [{ value: "0", label: "Unlimited" }, { value: "30", label: "30" }, { value: "60", label: "60" }, { value: "120", label: "120" }], change: (value) => update({ frameLimit: Number(value) as FrameLimit }), adjust: (direction) => update({ frameLimit: cycle<FrameLimit>([0, 30, 60, 120], p.frameLimit, direction) }), description: "Limit scene updates to reduce rendering work. The actual frame rate also depends on your device and browser." },
      { id: "overall-quality", label: "Overall Quality", section: "Graphic Settings", value: p.automaticGraphics ? "Auto" : isPreset ? p.quality[0].toUpperCase() + p.quality.slice(1) : "Custom", selectedValue: p.automaticGraphics ? "auto" : isPreset ? p.quality : "custom", kind: "choice", options: [...(!isPreset && !p.automaticGraphics ? [{ value: "custom", label: "Custom", disabled: true }] : []), { value: "auto", label: "Auto" }, ...qualityOptions], change: value => setQuality(value as Quality | "auto"), adjust: direction => setQuality(cycle<Quality | "auto">(["auto", "low", "medium", "high"], p.automaticGraphics ? "auto" : p.quality, direction)), description: "Auto adapts effects to your GPU and adjusts resolution when the frame rate drops." },
      { id: "particle-quality", label: "Particle Quality", value: p.quality[0].toUpperCase() + p.quality.slice(1), kind: "choice", options: qualityOptions, change: (value) => update({ quality: value as Quality }), adjust: (direction) => update({ quality: cycle<Quality>(["low", "medium", "high"], p.quality, direction) }), description: "Set the density of ambient sparks, wisps, and floating particles. Reduced motion pauses their movement." },
    ];
  } else if (category === "audio") {
    const range = (id: string, copy: { label: string; description: string }, key: "volume" | "musicVolume" | "sfxVolume"): SettingsRow => ({
      id, ...copy, value: `${p[key]}`, kind: "range", number: p[key], min: 0, max: 100, step: 1,
      change: (value) => update({ [key]: Number(value) }),
      adjust: (direction) => update({ [key]: Math.max(0, Math.min(100, p[key] + direction * 5)) }),
    });
    const toggle = (id: string, copy: { label: string; description: string }, key: "music" | "soundEffects" | "subtitles"): SettingsRow => ({
      id, ...copy, value: p[key] ? "On" : "Off", kind: "toggle",
      change: () => update({ [key]: !p[key] }), adjust: () => update({ [key]: !p[key] }),
    });
    rows = [
      range("master-volume", AUDIO_SETTINGS_COPY.masterVolume, "volume"),
      toggle("music", AUDIO_SETTINGS_COPY.music, "music"),
      range("music-volume", AUDIO_SETTINGS_COPY.musicVolume, "musicVolume"),
      ...(onNextTrack ? [{ id: "next-track", label: NOW_PLAYING_COPY.nextTrack, value: "→", description: AUDIO_SETTINGS_COPY.nextTrack.description, kind: audioStatus?.supported === false ? undefined : "action", change: onNextTrack, adjust: onNextTrack } satisfies SettingsRow] : []),
      toggle("sound-effects", AUDIO_SETTINGS_COPY.soundEffects, "soundEffects"),
      range("sfx-volume", AUDIO_SETTINGS_COPY.sfxVolume, "sfxVolume"),
      // Desktop only: the match, the one place with spoken lines, does not run on Quest.
      toggle("subtitles", { label: "Voice Subtitles", description: "Show what the pieces say in a match as subtitles: their pleas as their killers come, the king in check and in defeat, and the whispers of the fallen." }, "subtitles"),
      { id: "subtitle-size", label: "Subtitle Size", value: subtitleSizeLabel(p.subtitleSize), selectedValue: p.subtitleSize, kind: "choice", options: SUBTITLE_SIZES.map((size) => ({ value: size, label: subtitleSizeLabel(size) })), change: (value) => update({ subtitleSize: value as SubtitleSize }), adjust: (direction) => update({ subtitleSize: cycle(SUBTITLE_SIZES, p.subtitleSize, direction) }), description: "Draw match subtitles small, medium or large." },
      { id: "test-audio", ...AUDIO_SETTINGS_COPY.test, value: audioStatus?.supported === false ? AUDIO_SETTINGS_COPY.status.unsupported : "Play", kind: audioStatus?.supported === false ? undefined : "action", change: onTestSound, adjust: onTestSound },
      ...(onNextTrack ? [{ id: "audio-playback", ...AUDIO_SETTINGS_COPY.playback, value: audioStatus?.nowPlaying?.title ?? musicStatus, description: audioStatus?.error || AUDIO_SETTINGS_COPY.playback.description } satisfies SettingsRow] : []),
      { id: "audio-device", ...AUDIO_SETTINGS_COPY.output },
    ];
  } else {
    rows = [
      // Shared with Quest: replays the end-credits film over this page.
      ...(onPlayCredits ? [{ ...creditsFilmRow({ reducedMotion }), kind: "action", change: onPlayCredits, adjust: onPlayCredits } satisfies SettingsRow] : []),
      // Shared with Quest: replays the whole opening film over this page.
      ...(onPlayOpening ? [{ ...openingFilmRow({ reducedMotion }), kind: "action", change: onPlayOpening, adjust: onPlayOpening } satisfies SettingsRow] : []),
      { id: "project", label: "Project", value: "Crownfall", description: "Crownfall: Aethelgard. A standalone main-menu preview for the Crownfall project." },
      { id: "artwork", label: "Artwork & Sorcerer", value: "Supplied assets", description: "The card artwork, Home artwork, and animated sorcerer were supplied for this project." },
      // The licence (CC BY 4.0) asks for this credit wherever the model is used: the arena's flock and the Queen's rite.
      { id: "wyvern", label: "Wyvern Model", value: "Seth Santos · CC BY 4.0", description: "The wyverns over the arena and the Aethelgard Queen's beast are \"Zagmatorah - An Ancient Dragon\" by Seth Santos (@Seth7Santos), via Sketchfab, licensed under CC BY 4.0 (creativecommons.org/licenses/by/4.0). Changed for Crownfall: posed for flight, scaled, recoloured, given a flight cycle and its textures re-encoded." },
      { id: "technology", label: "Built With", value: "React · TypeScript · Three.js", description: "The interface uses React and TypeScript. The sorcerer and particle scene use Three.js and custom shaders." },
      { id: "typeface", label: "Typefaces", value: "Barlow", description: "Barlow and Barlow Condensed. Distributed under the SIL Open Font License; the license is included with this build." },
      { id: "licenses", label: "Open Source", value: "License notices", description: SETTINGS_LICENSE_COPY },
    ];
  }

  const selectRow = (index: number) => {
    const next = Math.max(0, Math.min(rows.length - 1, index));
    setActive(next);
    rowRefs.current[next]?.focus({ preventScroll: true });
    rowRefs.current[next]?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
  };
  const applyReset = () => {
    if (category === "general") update({ locale: INITIAL_PREFERENCES.locale, motion: INITIAL_PREFERENCES.motion, showHints: INITIAL_PREFERENCES.showHints, violence: INITIAL_PREFERENCES.violence });
    if (category === "video") update({ quality: INITIAL_PREFERENCES.quality, automaticGraphics: INITIAL_PREFERENCES.automaticGraphics, renderScale: INITIAL_PREFERENCES.renderScale, frameLimit: INITIAL_PREFERENCES.frameLimit });
    if (category === "audio") update({ volume: INITIAL_PREFERENCES.volume, musicVolume: INITIAL_PREFERENCES.musicVolume, sfxVolume: INITIAL_PREFERENCES.sfxVolume, music: INITIAL_PREFERENCES.music, soundEffects: INITIAL_PREFERENCES.soundEffects, subtitles: INITIAL_PREFERENCES.subtitles, subtitleSize: INITIAL_PREFERENCES.subtitleSize });
  };
  const reset = () => onRequestReset(applyReset);
  useImperativeHandle(ref, () => ({
    edge(last: boolean) { selectRow(last ? rows.length - 1 : 0); },
    move(direction: Direction) {
      if (direction === "up" || direction === "down") selectRow(active + (direction === "up" ? -1 : 1));
      // Left and right never start a three-minute film; Select does.
      else if (rows[active]?.id !== "play-credits" && rows[active]?.id !== "play-opening") rows[active]?.adjust?.(direction === "left" ? -1 : 1);
    },
    activate() { rows[active]?.adjust?.(1); },
    reset,
    focus() { selectRow(active); },
    cancel() { return false; },
  }));
  const current = rows[active] || rows[0];
  const mutable = category !== "credits";

  return <section className={`settings-detail settings-detail--${category}`} aria-label={`${category[0].toUpperCase() + category.slice(1)} settings`}>
    <div className="settings-detail-list" role="group" aria-label={`${category} options`}>
      {rows.map((row, index) => <div key={row.id}>
        {row.section && <h2 className="settings-section-heading">{t(row.section)}</h2>}
        <div
          ref={(element) => { rowRefs.current[index] = element; }}
          className={`settings-row${active === index ? " is-selected" : ""}${!row.kind ? " is-readonly" : ""}`}
          tabIndex={active === index ? 0 : -1}
          onFocus={() => setActive(index)}
          onClick={(event) => { setActive(index); if (event.target === event.currentTarget) rowRefs.current[index]?.focus({ preventScroll: true }); }}
          aria-label={`${t(row.label)}: ${t(row.value)}${row.kind ? "" : ", read only"}`}
          aria-describedby={active === index ? "settings-description" : undefined}
          data-setting={row.id}
        >
          <span className="settings-row-label">{t(row.label)}</span>
          <div className={`settings-value${row.kind ? " is-adjustable" : ""}`}>
            {row.kind === "choice" ? <>
              <button className="settings-step" type="button" aria-label={`${t("Decrease")} ${t(row.label)}`} onClick={() => row.adjust?.(-1)}>−</button>
              <select aria-label={t(row.label)} id={row.id === "particle-quality" ? "effect-quality" : row.id} value={row.selectedValue || (row.id === "frame-limit" ? String(p.frameLimit) : p.quality)} onChange={(event) => row.change?.(event.target.value)}>
                {row.options?.map((option) => <option key={option.value} value={option.value} disabled={option.disabled}>{t(option.label)}</option>)}
              </select>
              <button className="settings-step" type="button" aria-label={`${t("Increase")} ${t(row.label)}`} onClick={() => row.adjust?.(1)}>+</button>
            </> : row.kind === "toggle" ? <>
              <button className="settings-step" type="button" aria-label={`${t("Toggle")} ${t(row.label)}`} onClick={() => row.adjust?.(-1)}>−</button>
              <button className="settings-toggle" id={row.id === "ambient-motion" ? "motion-toggle" : row.id} type="button" role="switch" aria-checked={row.value === "On"} aria-label={t(row.label)} onClick={() => row.change?.(row.value !== "On")}>{t(row.value)}</button>
              <button className="settings-step" type="button" aria-label={`${t("Toggle")} ${t(row.label)}`} onClick={() => row.adjust?.(1)}>+</button>
            </> : row.kind === "range" ? <>
              <output htmlFor={row.id === "master-volume" ? "ambient-volume" : row.id}>{t(row.value)}</output>
              <input aria-label={t(row.label)} id={row.id === "master-volume" ? "ambient-volume" : row.id} type="range" value={row.number} min={row.min} max={row.max} step={row.step} onChange={(event) => row.change?.(Number(event.target.value))} />
            </> : row.kind === "fullscreen" ? <button className="settings-fullscreen" type="button" aria-label="Change window mode" onClick={() => row.change?.(true)}>{t(row.value)}<span aria-hidden="true">+</span></button> : row.kind === "action" ? <button className="settings-toggle" type="button" aria-label={t(row.label)} data-audio-test={row.id === "test-audio" ? "true" : undefined} onClick={() => row.change?.(true)}>{t(row.value)}</button> : <span className="settings-readonly-value">{t(row.value)}</span>}
          </div>
        </div>
      </div>)}
    </div>
    <aside className="settings-detail-info" aria-live="polite">
      <div key={current.id} className="settings-description-swap">
      <h1 className="settings-description-title">{t(current.label)}</h1>
      <p id="settings-description">{t(current.description)}</p>
      {category === "general" && current.id === "language" && <div className="settings-language-list"><p>{t('Available languages:')}</p><p>{SUPPORTED_LOCALES.map(item => item.label).join(' · ')}</p></div>}
      </div>
      {category === "audio" && audioStatus?.error && <p className="settings-audio-error" role="status">{audioStatus.error}</p>}
      {category === "credits" && creditsStatus && <p className="settings-audio-error" role="status" data-credits-status>{creditsStatus}</p>}
      {category === "audio" && audioStatus?.nowPlaying && <p className="settings-audio-track" aria-live="off" data-settings-audio-track={audioStatus.nowPlaying.trackId}><strong>{audioStatus.nowPlaying.title}</strong><span>{audioStatus.nowPlaying.artist ?? NOW_PLAYING_COPY.collection}</span><span>{t(musicStatus)}</span></p>}
    </aside>
    {category !== "credits" && <p className="settings-save-status" role="status">{t(preferencesSaved ? SETTINGS_STORAGE_COPY.saved : SETTINGS_STORAGE_COPY.session)}</p>}
    <footer className="settings-detail-footer">
      <button type="button" className="settings-footer-button" aria-label={t('Back')} onClick={onBack}><span className="settings-prompt" aria-hidden="true"><InputPrompt action="back" /></span>{t('Back')}</button>
      {mutable && <button type="button" className="settings-footer-button" aria-label={t('Reset Defaults')} onClick={reset}><span className="settings-prompt" aria-hidden="true"><InputPrompt action="reset" /></span>{t('Reset Defaults')}</button>}
      {mutable && <span className="settings-footer-hint"><span className="settings-direction" aria-hidden="true"><InputPrompt action="left" /> <InputPrompt action="right" /></span>{t('Adjust')}</span>}
    </footer>
  </section>;
});

export const SettingsDetail = forwardRef<SettingsPageHandle, SettingsDetailProps>(function SettingsDetail(props, ref) {
  if (props.category === "controls") return <ControlsPanel ref={ref} bindings={props.preferences.bindings} onChange={(bindings) => props.onChange({ ...props.preferences, bindings })} onBack={props.onBack} onRequestReset={props.onRequestReset} saveStatus={props.preferencesSaved ? SETTINGS_STORAGE_COPY.saved : SETTINGS_STORAGE_COPY.session} />;
  if (props.category === "input") return <InputDiagram ref={ref} onBack={props.onBack} />;
  return <PreferencePage key={props.category} ref={ref} {...props} />;
});

export default SettingsDetail;
