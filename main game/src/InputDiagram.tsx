import { InputPrompt, useInputPrompts } from "./InputPrompt";
import { KeyboardInput } from './KeyboardInput';
import { useMenuLocale } from './MenuLocale';
import { promptLabel, type PromptAction } from './input-prompts';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { SettingsPageHandle } from "./settings-types";
import "./InputDiagram.css";
import { connectedGamepads } from "./gamepads";

interface InputDiagramProps { onBack(): void }

function getControllers(): string[] {
  try {
    return Array.from(navigator.getGamepads?.() || []).filter((pad): pad is Gamepad => !!pad && pad.mapping === "standard").map((pad) => pad.id);
  } catch { return []; }
}

const ControllerInput = forwardRef<SettingsPageHandle, InputDiagramProps>(function ControllerInput({ onBack }, ref) {
  const { device, bindings } = useInputPrompts();
  const { t } = useMenuLocale();
  const [pressed, setPressed] = useState<number[]>([]);
  const [selected, setSelected] = useState<PromptAction>('select');
  const host = useRef<HTMLElement>(null);
  const padActions: { action: PromptAction; index: number; label: string }[] = [
    { action: 'previousTab', index: 4, label: 'Previous tab' }, { action: 'nextTab', index: 5, label: 'Next tab' },
    { action: 'select', index: 0, label: 'Select' }, { action: 'back', index: 1, label: 'Back' }, { action: 'reset', index: 3, label: 'Reset settings' },
    { action: 'left', index: 14, label: 'Move left' }, { action: 'right', index: 15, label: 'Move right' }, { action: 'up', index: 12, label: 'Move up' }, { action: 'down', index: 13, label: 'Move down' },
  ];
  useEffect(() => {
    const poll = () => {
      const pad = Array.from(connectedGamepads()).find(pad => pad?.connected && pad.mapping === 'standard');
      const next = pad?.buttons.flatMap((button, index) => button.pressed ? [index] : []) ?? [];
      if (pad && pad.axes[0] < -.55) next.push(14); if (pad && pad.axes[0] > .55) next.push(15);
      if (pad && pad.axes[1] < -.55) next.push(12); if (pad && pad.axes[1] > .55) next.push(13);
      setPressed(current => current.join() === next.join() ? current : next);
    };
    poll(); const timer = window.setInterval(poll, 50); return () => window.clearInterval(timer);
  }, []);
  const [controllers, setControllers] = useState<string[]>(getControllers);
  const backButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const refresh = () => {
      const next = getControllers();
      setControllers((current) => current.join("\n") === next.join("\n") ? current : next);
    };
    window.addEventListener("gamepadconnected", refresh);
    window.addEventListener("gamepaddisconnected", refresh);
    const timer = window.setInterval(refresh, 1500);
    return () => {
      window.removeEventListener("gamepadconnected", refresh);
      window.removeEventListener("gamepaddisconnected", refresh);
      window.clearInterval(timer);
    };
  }, []);
  const controls = () => Array.from(host.current?.querySelectorAll<HTMLButtonElement>('[data-pad-action]') ?? []);
  const focus = (index: number) => { const all = controls(); all[Math.max(0, Math.min(all.length - 1, index))]?.focus({ preventScroll: true }); };
  useImperativeHandle(ref, () => ({
    move(direction) { focus(controls().indexOf(document.activeElement as HTMLButtonElement) + (direction === 'left' || direction === 'up' ? -1 : 1)); },
    activate() { const button = document.activeElement as HTMLButtonElement; if (controls().includes(button)) button.click(); else focus(0); },
    reset() { /* Fixed standard-controller mapping. */ },
    focus() { focus(0); },
    edge(last) { focus(last ? controls().length - 1 : 0); },
    cancel() { return false; },
  }));
  return (
    <section ref={host} className="settings-detail input-detail" aria-label={t('Controller input')} data-input-demo>
      <div className="input-diagram-wrap">
        <svg className="input-diagram" viewBox="0 0 1100 440" role="img" aria-labelledby="controller-title" aria-describedby="controller-description">
          <title id="controller-title">Crownfall menu controller controls</title>
          <desc id="controller-description">Use the left stick or directional pad to navigate, A to select, B to go back, the shoulder buttons to change tabs, and Y to reset editable settings. Other buttons are unassigned.</desc>
          <g className="controller-outline" fill="none" strokeLinecap="round" strokeLinejoin="round">
            <path d="M407 106 C439 93 457 89 482 103 L619 103 C642 90 664 94 695 108 C731 123 748 157 762 203 L796 340 C804 373 782 400 756 388 L671 326 L437 326 L358 388 C331 402 307 377 316 341 L350 202 C364 152 376 119 407 106Z" />
            <path d="M370 135 C387 108 438 97 468 110 L464 118 C429 105 401 116 379 137Z M633 110 C663 98 705 110 725 137 L715 139 C691 118 661 107 635 119Z" />
            <circle cx="421" cy="182" r="27" /><circle cx="421" cy="182" r="20" /><circle cx="421" cy="182" r="14" />
            <circle cx="646" cy="267" r="27" /><circle cx="646" cy="267" r="20" /><circle cx="646" cy="267" r="14" />
            <path d="M461 235 L482 235 L482 215 L504 215 L504 235 L525 235 L525 256 L504 256 L504 277 L482 277 L482 256 L461 256Z" />
            <circle cx="542" cy="182" r="11" /><circle cx="609" cy="182" r="11" />
            <path d="M536 179 L542 176 L548 179 L548 187 L542 183 L536 187Z M604 178 L614 178 M604 182 L614 182 M604 186 L614 186" />
            <circle cx="575" cy="138" r="16" />
            <circle cx="700" cy="146" r="17" className={pressed.includes(3) ? 'controller-live-active' : ''} /><circle cx="733" cy="181" r="17" className={pressed.includes(1) ? 'controller-live-active' : ''} /><circle cx="665" cy="181" r="17" className={pressed.includes(2) ? 'controller-live-active' : ''} /><circle cx="700" cy="216" r="17" className={pressed.includes(0) ? 'controller-live-active' : ''} />
          </g>
          <g className="controller-button-letters" textAnchor="middle">
            <text x="700" y="153">{promptLabel('reset', device, bindings)}</text><text x="733" y="188">{promptLabel('back', device, bindings)}</text><text x="665" y="188">{device === 'playstation' ? '□' : device === 'nintendo' ? 'Y' : 'X'}</text><text x="700" y="223">{promptLabel('select', device, bindings)}</text>
          </g>
          <g className="controller-callout-lines" fill="none">
            <path d="M240 172 L394 182 M240 318 L461 246 M271 78 L411 112 M728 113 L873 77 M718 217 L872 264 M750 182 L872 198 M716 146 L872 132 M622 182 L872 329" />
          </g>
          <g className="controller-callout-labels">
            <text x="76" y="178">LEFT STICK</text><text x="76" y="199" className="controller-callout-action">Navigate</text>
            <text x="76" y="321">D-PAD</text><text x="76" y="342" className="controller-callout-action">Navigate / adjust</text>
            <text x="76" y="72">{promptLabel('previousTab', device, bindings)}</text><text x="76" y="93" className="controller-callout-action">{t('Previous tab')}</text>
            <text x="884" y="72">{promptLabel('nextTab', device, bindings)}</text><text x="884" y="93" className="controller-callout-action">{t('Next tab')}</text>
            <text x="884" y="129" className="controller-button-y">{promptLabel('reset', device, bindings)}</text><text x="910" y="129">{t('Reset settings')}</text><text x="910" y="150" className="controller-callout-secondary">{t('Where available')}</text>
            <text x="884" y="203" className="controller-button-b">{promptLabel('back', device, bindings)}</text><text x="910" y="203">{t('Back')}</text>
            <text x="884" y="269" className="controller-button-a">{promptLabel('select', device, bindings)}</text><text x="910" y="269">{t('Select')}</text>
            <text x="884" y="334" className="controller-callout-secondary">Other buttons</text><text x="884" y="355" className="controller-callout-secondary">Unassigned</text>
          </g>
        </svg>
        <div className="controller-action-grid" role="group" aria-label={t('Interactive controller')}>{padActions.map(item => <button key={item.action} type="button" data-pad-action={item.action} className={pressed.includes(item.index) ? 'is-pressed' : ''} aria-pressed={pressed.includes(item.index)} onClick={() => setSelected(item.action)}><strong>{promptLabel(item.action, device, bindings)}</strong><span>{t(item.label)}</span></button>)}</div>
        <p className="input-connection-status" role="status">{promptLabel(selected, device, bindings)} · {t(padActions.find(item => item.action === selected)?.label ?? 'Select')} · {t('Press a button to see it light up.')}</p>
        {controllers.length > 0 && <p className="input-controller-name">{controllers.join(" · ")}</p>}
      </div>
      <footer className="settings-detail-footer">
        <button ref={backButton} type="button" className="settings-footer-button" aria-label="Back" onClick={onBack}><span className="settings-footer-key" aria-hidden="true"><InputPrompt action="back" /></span> Back</button>
        <span className="settings-footer-hint">{t('Prompts follow your active input device.')}</span>
      </footer>
    </section>
  );
});

export const InputDiagram = forwardRef<SettingsPageHandle, InputDiagramProps>(function InputDiagram(props, ref) {
  return useInputPrompts().device === 'keyboard' ? <KeyboardInput {...props} ref={ref} /> : <ControllerInput {...props} ref={ref} />;
});
