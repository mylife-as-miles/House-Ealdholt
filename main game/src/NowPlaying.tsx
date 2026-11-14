import { useMenuLocale } from "./MenuLocale";
import { useEffect, useRef, useState } from "react";
import type { MenuAudioStatus } from "../../shared/menu/audio";
import { NOW_PLAYING_COPY } from "../../shared/menu/soundtrack";
import { consumeNowPlayingSequence } from "./now-playing-state";
import "./NowPlaying.css";

type PlayingTrack = NonNullable<MenuAudioStatus["nowPlaying"]>;

export interface NowPlayingProps {
  status: MenuAudioStatus | null;
  blocked: boolean;
  reducedMotion: boolean;
  surface?: "menu" | "legacy";
}

/** A new audible track gets one brief announcement. Its sequence is consumed
 * even behind another surface, so returning or resuming cannot replay a toast. */
export default function NowPlaying({ status, blocked, reducedMotion, surface = "menu" }: NowPlayingProps) {
  const { t } = useMenuLocale();
  const seenSequence = useRef<number | null>(null);
  const [track, setTrack] = useState<PlayingTrack | null>(null);
  const [shown, setShown] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const current = status?.nowPlaying;
  const playing = !!current?.playing && status?.musicState === "playing" && !!status.musicPlaying;

  useEffect(() => {
    const next = consumeNowPlayingSequence(seenSequence.current, current, !blocked && playing);
    seenSequence.current = next.seenSequence;
    if (next.show && current) setTrack({ ...current });
    else if (blocked || !playing) setTrack(null);
  }, [current?.sequence, current?.trackId, current?.title, current?.artist, playing, blocked]);

  useEffect(() => {
    if (!track) { setShown(false); setAnnouncement(""); return; }
    setShown(true);
    setAnnouncement(`${NOW_PLAYING_COPY.nowPlaying}: ${track.title}. ${track.artist ?? NOW_PLAYING_COPY.collection}.`);
    const fade = window.setTimeout(() => setShown(false), 5000);
    const remove = window.setTimeout(() => setTrack(null), 5260);
    return () => { window.clearTimeout(fade); window.clearTimeout(remove); };
  }, [track]);

  return <>
    {track && !blocked && playing && <aside className={`now-playing${shown ? " is-shown" : ""}${reducedMotion ? " is-still" : ""}`} data-now-playing={track.trackId} data-now-playing-sequence={track.sequence} data-now-playing-surface={surface} aria-hidden="true">
      <span className="now-playing-glyph"><svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M13 23V8l13-3v15M13 12l13-3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /><ellipse cx="9.5" cy="24" rx="3.5" ry="2.5" transform="rotate(-18 9.5 24)" fill="currentColor" /><ellipse cx="22.5" cy="21" rx="3.5" ry="2.5" transform="rotate(-18 22.5 21)" fill="currentColor" /></svg></span>
      <div className="now-playing-copy"><p className="now-playing-label">{t(NOW_PLAYING_COPY.nowPlaying)}</p><p className="now-playing-title">{track.title}</p><p className="now-playing-credit">{track.artist ?? t(NOW_PLAYING_COPY.collection)}</p></div>
    </aside>}
    <span className="now-playing-announcement" role="status" aria-live="polite" aria-atomic="true">{blocked || !playing ? "" : announcement}</span>
  </>;
}
