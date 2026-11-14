import { InputPrompt, useInputPrompts } from "./InputPrompt";
import { promptLabel } from './input-prompts';
import { useMenuLocale } from './MenuLocale';
import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import {
  BINDING_LABELS, DEFAULT_BINDINGS, keyLabel,
  type BindingAction, type MenuBindings, type SettingsPageHandle,
} from "./settings-types";
import "./ControlsPanel.css";

interface ControlsPanelProps {
  bindings: MenuBindings;
  onChange(bindings: MenuBindings): void;
  onBack(): void;
  onRequestReset(apply: () => void): void;
  saveStatus: string;
}

const actions = Object.keys(DEFAULT_BINDINGS) as BindingAction[];
const descriptions: Record<BindingAction, string> = {
  left: "Move to the option on the left. In a settings list, decrease the selected value.",
  right: "Move to the option on the right. In a settings list, increase the selected value.",
  up: "Move to the option above, or the previous settings row.",
  down: "Move to the option below, or the next settings row.",
  select: "Open the selected card, settings category, or control. Enter and Space also activate focused buttons.",
  back: "Return to the previous menu. Escape always remains available as a way back.",
  previousTab: "Switch to the previous main menu tab.",
  nextTab: "Switch to the next main menu tab.",
  first: "Focus the first option in the current menu.",
  last: "Focus the last option in the current menu.",
};
const allowedCode = /^(Arrow(?:Left|Right|Up|Down)|Key[A-Z]|Digit[0-9]|Enter|Space|Escape|Home|End|Backspace|Delete|PageUp|PageDown)$/;

export const ControlsPanel = forwardRef<SettingsPageHandle, ControlsPanelProps>(function ControlsPanel({ bindings, onChange, onBack, onRequestReset, saveStatus }, ref) {
  const { device } = useInputPrompts();
  const { t } = useMenuLocale();
  const keyboard = device === 'keyboard';
  const displayedBinding = (action: BindingAction) => keyboard ? keyLabel(bindings[action]) : promptLabel(action, device, bindings);
  const [selected, setSelected] = useState(0);
  const [capturing, setCapturing] = useState<BindingAction | null>(null);
  const [message, setMessage] = useState("");
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const focusRow = (index: number) => {
    const next = Math.max(0, Math.min(actions.length - 1, index));
    setSelected(next);
    buttons.current[next]?.focus({ preventScroll: true });
    buttons.current[next]?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
  };
  const applyReset = () => {
    onChange({ ...DEFAULT_BINDINGS });
    setCapturing(null);
    setMessage("Default menu controls restored.");
  };
  const reset = () => { if (keyboard) onRequestReset(applyReset); };
  const beginCapture = (action: BindingAction) => {
    if (!keyboard) { setMessage(t('Standard controller buttons are fixed. Use the keyboard to edit keyboard bindings.')); return; }
    setCapturing(action);
    setMessage("Press a key. Escape cancels.");
    buttons.current[actions.indexOf(action)]?.focus({ preventScroll: true });
  };
  useImperativeHandle(ref, () => ({
    move(direction) {
      if (capturing) return;
      focusRow(selected + (direction === "up" ? -1 : direction === "down" ? 1 : 0));
    },
    activate() { if (!capturing) beginCapture(actions[selected]); },
    reset,
    focus() { focusRow(selected); },
    edge(last) { if (!capturing) focusRow(last ? actions.length - 1 : 0); },
    cancel() {
      if (!capturing) return false;
      setCapturing(null);
      setMessage("Binding unchanged.");
      return true;
    },
  }));

  return (
    <section
      className="settings-detail controls-detail"
      aria-label="Menu controls"
      onKeyDownCapture={(event) => {
        if (!capturing) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.repeat) return;
        if (event.code === "Escape") {
          setCapturing(null);
          setMessage("Binding unchanged.");
          return;
        }
        if (event.ctrlKey || event.metaKey || event.altKey || !allowedCode.test(event.code)) {
          setMessage("Choose a letter, number, arrow, or navigation key. Tab is reserved for focus.");
          return;
        }
        const conflict = actions.find((action) => action !== capturing && bindings[action] === event.code);
        if (conflict) {
          setMessage(`${keyLabel(event.code)} is already assigned to ${BINDING_LABELS[conflict].toLowerCase()}. Choose another key.`);
          return;
        }
        onChange({ ...bindings, [capturing]: event.code });
        setMessage(`${BINDING_LABELS[capturing]} assigned to ${keyLabel(event.code)}.`);
        setCapturing(null);
      }}
    >
      <div className="settings-detail-list controls-binding-list" aria-label={t(keyboard ? 'Keyboard bindings' : 'Controller bindings')}>
        {actions.map((action, index) => (
          <button
            key={action}
            ref={(button) => { buttons.current[index] = button; }}
            type="button"
            className={`settings-row controls-binding-row${selected === index ? " is-selected" : ""}${capturing === action ? " is-capturing" : ""}`}
            tabIndex={selected === index ? 0 : -1}
            aria-label={`${t(BINDING_LABELS[action])}: ${capturing === action ? t("press a key") : displayedBinding(action)}. ${t(keyboard ? 'Change binding' : 'Inspect control')}`}
            aria-describedby="controls-row-description controls-binding-status"
            onFocus={() => setSelected(index)}
            onClick={() => { setSelected(index); beginCapture(action); }}
          >
            <span>{t(BINDING_LABELS[action])}</span>
            <span className="settings-value controls-binding-value">{capturing === action ? "..." : displayedBinding(action)}</span>
          </button>
        ))}
      </div>
      <aside className="settings-detail-info">
        <div key={actions[selected]} className="settings-description-swap">
        <h1 className="settings-description-title">{t(BINDING_LABELS[actions[selected]])}</h1>
        <p id="controls-row-description">{t(descriptions[actions[selected]])}</p>
        <p className="controls-binding-instructions">{t(keyboard ? 'Select a binding, then press its new key. These controls apply to the Crownfall menu.' : 'Standard controller buttons are fixed. Use the keyboard to edit keyboard bindings.')}</p>
        <p className="controls-binding-instructions">{t('You can also use a compatible Xbox, PlayStation or Nintendo controller. Connect it by USB or Bluetooth, then press a button. Prompts switch automatically.')}</p>
        </div>
        <p id="controls-binding-status" className="controls-binding-status" role="status" aria-live="polite">{message}{message ? " · " : ""}{saveStatus}</p>
      </aside>
      <footer className="settings-detail-footer">
        <button type="button" className="settings-footer-button" aria-label="Back" onClick={() => {
          if (capturing) { setCapturing(null); setMessage("Binding unchanged."); }
          else onBack();
        }}><span className="settings-footer-key" aria-hidden="true"><InputPrompt action="back" /></span> {t('Back')}</button>
        {keyboard && <button type="button" className="settings-footer-button" aria-label={t('Reset Defaults')} onClick={reset}><span className="settings-footer-key" aria-hidden="true"><InputPrompt action="reset" /></span> {t('Reset Defaults')}</button>}
        <span className="settings-footer-hint">{t(keyboard ? 'Select a binding to change it' : 'Select a control to inspect it')}</span>
      </footer>
    </section>
  );
});
