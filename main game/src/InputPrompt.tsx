import { createContext, useContext } from 'react';
import { DEFAULT_BINDINGS, type MenuBindings } from './settings-types';
import { promptLabel, type InputDevice, type PromptAction } from './input-prompts';

export const InputPromptContext = createContext<{ device: InputDevice; bindings: MenuBindings }>({ device: 'keyboard', bindings: DEFAULT_BINDINGS });
export const useInputPrompts = () => useContext(InputPromptContext);

export function InputPrompt({ action }: { action: PromptAction }) {
  const { device, bindings } = useInputPrompts();
  return <>{promptLabel(action, device, bindings)}</>;
}
