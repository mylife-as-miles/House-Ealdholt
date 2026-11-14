import { useState } from "react";
import { BATTLEFIELD_PREVIEWS } from "../../../shared/play/setup";
import type { BATTLEFIELDS } from "../../../shared/play/match";
import { useMenuLocale } from "../MenuLocale";

/** Lightweight captures of the playable arena; this screen does not load a second game. */
export function BattlefieldPreview({ battlefield }: { battlefield: typeof BATTLEFIELDS[number] }) {
  const { t } = useMenuLocale();
  const [view, setView] = useState<"arena" | "board">("arena");
  const [failed, setFailed] = useState<string | null>(null);
  const source = BATTLEFIELD_PREVIEWS[battlefield.id][view === "arena" ? "preview" : "overview"];
  return <section className="setup-preview" data-preview={view} data-preview-setting={battlefield.id} aria-label={t("Battlefield preview")}>
    <div className="setup-preview-heading"><span>{t(battlefield.title)}</span><h2>{t(battlefield.subtitle)}</h2></div>
    <figure className="setup-preview-frame">
      {failed === source ? <div className="setup-preview-unavailable" role="status">{t("Preview unavailable")}</div>
        : <img key={source} className="setup-preview-image" src={source} alt={`${t(battlefield.subtitle)} — ${t(view === "arena" ? "Arena view" : "Board view")}`} onError={() => setFailed(source)} />}
      <figcaption>{t(battlefield.description)}</figcaption>
    </figure>
    <div className="setup-preview-controls" role="group" aria-label={t("Battlefield preview")}>
      <button type="button" aria-pressed={view === "arena"} onClick={() => setView("arena")}><svg viewBox="0 0 24 20" fill="none" aria-hidden="true"><path d="m2 17 6-12 5 9 4-6 5 9H2Z" stroke="currentColor" strokeWidth="1.2" /></svg>{t("Arena view")}</button>
      <button type="button" aria-pressed={view === "board"} onClick={() => setView("board")}><svg viewBox="0 0 24 20" fill="none" aria-hidden="true"><path d="M4 3H20V17H4V3ZM4 10H20M12 3V17" stroke="currentColor" strokeWidth="1.2" /><path d="M4 3H12V10H4ZM12 10H20V17H12Z" fill="currentColor" opacity=".6" /></svg>{t("Board view")}</button>
    </div>
  </section>;
}
