import { useEffect, useRef, useState } from "react";
import { ShowcaseSession } from "../../../shared/showcase/session";

let pageSession: ShowcaseSession | null = null;

export function sessionForPage(): ShowcaseSession {
  return pageSession ??= new ShowcaseSession();
}

// The lazy Showcase route owns one session per page. Leaving the route pauses
// its clock, while the current board and watch position survive menu changes.
export function useShowcaseSession(suspended = false) {
  const [session] = useState(sessionForPage);
  const [snapshot, setSnapshot] = useState(session.snapshot);
  const suspendedRef = useRef(suspended);
  suspendedRef.current = suspended;
  useEffect(() => { session.setSuspended(suspended || document.hidden); }, [session, suspended]);
  useEffect(() => {
    const unsubscribe = session.subscribe(() => setSnapshot(session.snapshot));
    const visibility = () => session.setSuspended(suspendedRef.current || document.hidden);
    visibility();
    document.addEventListener("visibilitychange", visibility);
    let frame = 0;
    let previous = performance.now();
    const tick = (now: number) => {
      const delta = Math.max(0, (now - previous) / 1000);
      previous = now;
      if (!document.hidden) session.update(delta);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", visibility);
      session.setSuspended(true);
      unsubscribe();
    };
  }, [session]);
  return { session, snapshot };
}

if (import.meta.hot) import.meta.hot.dispose(() => { pageSession?.dispose(); pageSession = null; });
