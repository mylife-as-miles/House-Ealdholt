import { useEffect, useRef } from 'react';

/** Browser fullscreen starts at the first user gesture; a saved windowed choice stays windowed. */
export function usePreferredFullscreen(preferred: boolean, onWindowed: () => void) {
  const changed = useRef(onWindowed); changed.current = onWindowed;
  useEffect(() => {
    if (!preferred || !document.fullscreenEnabled) return;
    let requested = !!document.fullscreenElement, entered = requested;
    const request = () => {
      if (requested || document.fullscreenElement) return;
      requested = true;
      void document.documentElement.requestFullscreen().catch(() => { requested = false; });
    };
    const change = () => {
      if (document.fullscreenElement) entered = true;
      else if (entered) changed.current();
    };
    document.addEventListener('fullscreenchange', change);
    window.addEventListener('click', request);
    window.addEventListener('keyup', request);
    return () => {
      document.removeEventListener('fullscreenchange', change);
      window.removeEventListener('click', request);
      window.removeEventListener('keyup', request);
    };
  }, [preferred]);
}
