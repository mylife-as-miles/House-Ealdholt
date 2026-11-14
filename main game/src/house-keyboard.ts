import type { LegacyScreenHandle } from './legacy/legacy-handle';

type Key = Pick<KeyboardEvent, 'key' | 'altKey' | 'ctrlKey' | 'metaKey' | 'isComposing' | 'repeat' | 'defaultPrevented'>;
export type HouseKeyTarget = 'editable' | 'native-activation' | 'other';

/** Film actions fire once and never consume system shortcuts or composition. */
export function isFilmShortcutAvailable(event:Key):boolean {
  return !event.defaultPrevented && !event.altKey && !event.ctrlKey && !event.metaKey && !event.isComposing && !event.repeat;
}

/** Route standalone village keys while leaving editable and native controls to the browser.
 * Returns true only if the key was handled, so callers can prevent its default. */
export function routeHouseKey(event:Key, target:HouseKeyTarget, handle:LegacyScreenHandle | null):boolean {
  if (!handle || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return false;
  if (target === 'editable') return false;
  if (event.key === 'Escape') return !event.repeat && handle.cancel();
  const directions:Record<string, 'left'|'right'|'up'|'down'|undefined> = {ArrowLeft:'left',ArrowRight:'right',ArrowUp:'up',ArrowDown:'down'};
  const direction = directions[event.key];
  if (direction) { handle.move(direction); return true; }
  if (event.key.toLowerCase() === 'q' || event.key.toLowerCase() === 'e') { handle.cycle(event.key.toLowerCase() === 'e' ? 1 : -1); return true; }
  if (event.key === 'Home' || event.key === 'End') { handle.edge?.(event.key === 'End'); return !!handle.edge; }
  if ((event.key === 'Enter' || event.key === ' ') && target !== 'native-activation' && !event.repeat) { handle.activate(); return true; }
  return false;
}

export function houseKeyTarget(target:EventTarget | null):HouseKeyTarget {
  if (!(target instanceof HTMLElement)) return 'other';
  if (target.isContentEditable || target.closest('input, select, textarea, [contenteditable=""], [contenteditable="true"], [role="textbox"]')) return 'editable';
  return target.closest('button, a[href], summary') ? 'native-activation' : 'other';
}
