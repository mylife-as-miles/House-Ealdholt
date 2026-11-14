import { LAUNCH_ARTWORK, CROWNFALL_TITLE } from '../../shared/menu/launch';
import './LaunchArtwork.css';

export default function LaunchArtwork({ leaving = false, onContinue }: { leaving?: boolean; onContinue?(): void }) {
  return <section className={`launch-artwork${leaving ? ' is-leaving' : ''}`} aria-label="Loading Crownfall" role="status">
    <img src={`${import.meta.env.BASE_URL}${LAUNCH_ARTWORK.slice(1)}`} alt="" fetchPriority="high" />
    <h1 className="launch-artwork-title">{CROWNFALL_TITLE}</h1>
    {onContinue && <button className="launch-continue" type="button" onClick={onContinue}>Continue</button>}
  </section>;
}
