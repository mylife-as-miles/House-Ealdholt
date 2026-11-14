/**
 * The neighbouring houses of Aethelgard, as the observer sees them (shared/legacy/aethelgard/observer/neighbour-houses.ts):
 * each house's arms, seat and road, how it regards Ealdholt and how it fares, its latest news, and the observer's hand
 * over it (bless or blight its year, turn its lord toward Ealdholt or against it), once a village day for each house.
 * Shown in the observer's panel in place of the powers, in the setup screen's rows and tiles.
 */
import { useState } from "react";
import {
  ACT_LABEL, fortuneBand, NEIGHBOUR_HOUSES, neighbourHouse, REALM_ACTS, regardBand,
  type FortuneBand, type RaidAid, type RealmAct, type RealmState, type RegardBand,
} from "../../../../../shared/legacy/aethelgard/observer/neighbour-houses";
import { formatChronicleTime } from "../../../../../shared/legacy/aethelgard/observer/village-chronicle";
import { HeraldryEmblem } from "../../HeraldryEmblem";
import { Glyph, tint } from "./glyphs";

const BAND: Readonly<Record<RegardBand, { readonly label: string; readonly tint: string }>> = {
  feud: { label: "At feud", tint: "#e0533d" }, cold: { label: "Cold", tint: "#8fb0c8" }, wary: { label: "Wary", tint: "#b5b2ac" },
  warm: { label: "Warm", tint: "#e3b75a" }, sworn: { label: "Sworn friends", tint: "#56c2a6" },
};
const FORTUNE: Readonly<Record<FortuneBand, string>> = { lean: "Lean", steady: "Steady", thriving: "Thriving" };
const ACT_TINT: Readonly<Record<RealmAct, string>> = { bless: "#e3b75a", blight: "#8fb0c8", befriend: "#56c2a6", estrange: "#e0533d" };
const OUTING_WORDS = { market: "at market in", kin: "with kin at", pilgrimage: "on pilgrimage to" } as const;

export interface HousesPanelProps {
  realm: RealmState;
  /** The observed absolute minute, once the village clock is known. */
  minute: number | null;
  /** The house that would ride to Ealdholt's beacon now, if any. */
  aid: RaidAid | null;
  onAct(houseId: string, act: RealmAct): void;
  onClose(): void;
}

export function HousesPanel({ realm, minute, aid, onAct, onClose }: HousesPanelProps) {
  const [selected, setSelected] = useState(NEIGHBOUR_HOUSES[0].id);
  const day = minute === null ? null : Math.floor(minute / 1440);
  const outingHouse = realm.outing ? neighbourHouse(realm.outing.houseId) : null;
  return <>
    <header className="obs-legend-row">
      <h3 className="obs-legend"><Glyph name="realm" className="obs-legend-icon" />Houses of Aethelgard</h3>
      <button type="button" className="obs-icon-button" data-nav data-ealdholt-drawer-close aria-label="Close" onClick={onClose}><Glyph name="close" /></button>
    </header>
    <p className="obs-quiet obs-houses-lead">Reach into a neighbour's life once each village day.</p>
    <div className="obs-houses" role="group" aria-label="Neighbouring houses">
      {NEIGHBOUR_HOUSES.map((house, index) => {
        const state = realm.houses[house.id];
        if (!state) return null;
        const band = regardBand(state.regard), open = selected === house.id, acted = day !== null && state.actedDay >= day;
        return <div key={house.id} className="obs-house" data-observer-house={house.id} data-band={band} data-open={open || undefined} style={tint(BAND[band].tint)}>
          <button type="button" className="obs-row obs-house-row" data-nav data-nav-default={index === 0 || undefined} aria-pressed={open} aria-expanded={open} onClick={() => setSelected(house.id)}>
            <HeraldryEmblem heraldry={house.heraldry} aspect="shield" className="obs-house-crest" label="" />
            <span className="obs-house-id"><span className="obs-house-name">{house.name}</span>
              <span className="obs-row-note">{house.seat}</span></span>
            <span className="obs-house-band">{BAND[band].label}</span>
          </button>
          {/* Regard runs from feud on the left to sworn friendship on the right, filling out from the middle. */}
          <span className="obs-regard" role="img" aria-label={`Regard for Ealdholt: ${state.regard > 0 ? "+" : ""}${state.regard}`} data-observer-regard={state.regard}>
            <i style={{ left: `${state.regard < 0 ? 50 + state.regard / 2 : 50}%`, width: `${Math.abs(state.regard) / 2}%` }} />
          </span>
          {open && <div className="obs-house-detail">
            <p className="obs-quiet"><span className="obs-house-seat">{house.seatLine}.</span> {house.temperament}</p>
            <dl className="obs-house-facts">
              <div><dt>Fares</dt><dd data-fortune={fortuneBand(state.fortune)}>{FORTUNE[fortuneBand(state.fortune)]}</dd></div>
              <div><dt>Beacon</dt><dd>{aid?.houseId === house.id ? `${house.riders} riders would come` : state.regard >= 40 ? "Would ride" : "Would not ride"}</dd></div>
            </dl>
            {state.news && <p className="obs-house-news"><b>{formatChronicleTime(state.news.minute)}</b>{state.news.text}</p>}
            <div className="obs-acts" role="group" aria-label={`Your hand over ${house.name}`}>
              {REALM_ACTS.map(act => <button key={act} type="button" className="obs-act" style={tint(ACT_TINT[act])} data-nav data-observer-act={act} disabled={acted || minute === null} onClick={() => onAct(house.id, act)}>
                <Glyph name={act} className="obs-act-icon" /><span>{ACT_LABEL[act]}</span>
              </button>)}
            </div>
            {acted && <p className="obs-quiet" data-observer-acted>Your hand has moved this house today.</p>}
          </div>}
        </div>;
      })}
    </div>
    {realm.outing && outingHouse && <p className="obs-house-outing" data-observer-outing={realm.outing.kind}>
      <Glyph name="journey" className="obs-link-icon" />{realm.outing.residentIds.length} of Ealdholt are away {OUTING_WORDS[realm.outing.kind]} {realm.outing.kind === "pilgrimage" ? "the Barrow-stones" : outingHouse.seat} until {formatChronicleTime(realm.outing.endMinute).split(" · ")[1]}.
    </p>}
  </>;
}
