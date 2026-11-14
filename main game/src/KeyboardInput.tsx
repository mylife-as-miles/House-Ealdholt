import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { BINDING_LABELS, keyLabel, type BindingAction, type SettingsPageHandle } from './settings-types';
import { InputPrompt, useInputPrompts } from './InputPrompt';
import { useMenuLocale } from './MenuLocale';

const rows = [
  ['Escape', 'F9', 'Home', 'End', 'PageUp', 'PageDown', 'Delete'],
  [...'1234567890'.split('').map(key => `Digit${key}`), 'Backspace'],
  'QWERTYUIOP'.split('').map(key => `Key${key}`),
  [...'ASDFGHJKL'.split('').map(key => `Key${key}`), 'Enter'],
  [...'ZXCVBNM'.split('').map(key => `Key${key}`), 'ArrowUp'],
  ['Space', 'ArrowLeft', 'ArrowDown', 'ArrowRight'],
];

export const KeyboardInput = forwardRef<SettingsPageHandle, { onBack(): void }>(function KeyboardInput({ onBack }, ref) {
  const { bindings } = useInputPrompts();
  const { t } = useMenuLocale();
  const host = useRef<HTMLElement>(null);
  const [selected, setSelected] = useState('Enter');
  const [pressed, setPressed] = useState<string[]>([]);
  const label = (code: string) => {
    if (code === 'F9') return t('Reset settings');
    const action = (Object.keys(bindings) as BindingAction[]).find(action => bindings[action] === code);
    return t(action ? BINDING_LABELS[action] : 'Unassigned');
  };
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.repeat) return;
      setPressed(current => current.includes(event.code) ? current : [...current, event.code]);
      if (event.code !== 'Tab') setSelected(event.code);
    };
    const up = (event: KeyboardEvent) => setPressed(current => current.filter(code => code !== event.code));
    const clear = () => setPressed([]);
    window.addEventListener('keydown', down, true); window.addEventListener('keyup', up, true); window.addEventListener('blur', clear);
    return () => { window.removeEventListener('keydown', down, true); window.removeEventListener('keyup', up, true); window.removeEventListener('blur', clear); };
  }, []);
  const controls = () => Array.from(host.current?.querySelectorAll<HTMLButtonElement>('[data-key-code]') ?? []);
  const focus = (index: number) => { const all = controls(); all[Math.max(0, Math.min(all.length - 1, index))]?.focus({ preventScroll: true }); };
  useImperativeHandle(ref, () => ({
    move(direction) { focus(controls().indexOf(document.activeElement as HTMLButtonElement) + (direction === 'up' || direction === 'left' ? -1 : 1)); },
    activate() { const button = document.activeElement as HTMLButtonElement; if (controls().includes(button)) button.click(); else focus(0); },
    reset() {}, focus() { focus(0); }, edge(last) { focus(last ? controls().length - 1 : 0); }, cancel() { return false; },
  }));
  return <section ref={host} className="settings-detail input-detail" aria-label={t('Keyboard input')} data-input-demo>
    <div className="input-diagram-wrap input-live-layout">
      <div className="input-device-visual">
        <h1>{t('Keyboard')}</h1>
        <div className="keyboard-diagram" role="group" aria-label={t('Interactive keyboard')}>
          {rows.map((row, index) => <div className="keyboard-key-row" key={index}>{row.map(code => <button key={code} type="button" data-key-code={code}
            className={`keyboard-key${Object.values(bindings).includes(code) || code === 'F9' ? ' is-bound' : ''}${pressed.includes(code) ? ' is-pressed' : ''}${selected === code ? ' is-selected' : ''}${code === 'Space' ? ' is-space' : ''}`}
            aria-label={`${keyLabel(code)}: ${label(code)}`} aria-pressed={pressed.includes(code)} onClick={() => setSelected(code)}>{keyLabel(code)}</button>)}</div>)}
        </div>
      </div>
      <aside className="input-action-info">
        <span className="input-device-eyebrow">{t('Active input')}</span>
        <h2>{label(selected)}</h2><div className="input-selected-key">{keyLabel(selected)}</div>
        <p>{t('Press a key to see it light up, or click a key to inspect its action.')}</p>
        <p>{t('Keyboard bindings can be changed in Controls.')}</p>
      </aside>
    </div>
    <footer className="settings-detail-footer">
      <button type="button" className="settings-footer-button" aria-label={t('Back')} onClick={onBack}><span className="settings-footer-key" aria-hidden="true"><InputPrompt action="back" /></span> {t('Back')}</button>
      <span className="settings-footer-hint">{t('Prompts follow your active input device.')}</span>
    </footer>
  </section>;
});
