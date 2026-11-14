import { keyLabel, type BindingAction, type MenuBindings } from './settings-types';

export type InputDevice = 'keyboard' | 'xbox' | 'playstation' | 'nintendo';
export type PromptAction = BindingAction | 'reset';

export function controllerDevice(id: string): InputDevice {
  if (/054c|dualsense|dualshock|playstation|sony/i.test(id)) return 'playstation';
  if (/057e|nintendo|switch/i.test(id)) return 'nintendo';
  return 'xbox';
}

export function promptLabel(action: PromptAction, device: InputDevice, bindings: MenuBindings): string {
  if (device === 'keyboard') return action === 'reset' ? 'F9' : keyLabel(bindings[action]);
  const labels = device === 'playstation'
    ? { select: '×', back: '○', reset: '△', previousTab: 'L1', nextTab: 'R1' }
    : device === 'nintendo'
      ? { select: 'B', back: 'A', reset: 'X', previousTab: 'L', nextTab: 'R' }
      : { select: 'A', back: 'B', reset: 'Y', previousTab: 'LB', nextTab: 'RB' };
  if (action in labels) return labels[action as keyof typeof labels];
  return ({ left: 'D-pad ←', right: 'D-pad →', up: 'D-pad ↑', down: 'D-pad ↓', first: 'Unassigned', last: 'Unassigned' } as const)[action as 'left' | 'right' | 'up' | 'down' | 'first' | 'last'];
}
