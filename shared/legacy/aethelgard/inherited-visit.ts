// Shared controller only. The lazy host supplies storage ownership and time;
// importing or constructing a preview neither enters a house nor writes data.
import { chooseInheritedBannerDesign, createInheritedBannerDraft, type InheritedBannerDraft } from "./entry-draft";
import { EALDHOLT_HOUSE } from "./house";
import { EALDHOLT_INHERITED_COPY as C } from "./inherited-copy";
import {
  applyInheritedStoryChoice, createInheritedSession, type InheritedEntry, type InheritedSession,
} from "./inherited-session";
import type { InheritedSessionStore } from "./inherited-storage";
import { createEaldholtDraftChoice, EALDHOLT_DRAFT_CAST, EALDHOLT_DRAFT_STORY_FACTS } from "./people-draft";

export interface InheritedVisitSnapshot {
  readonly mode: "preview" | "inherited";
  readonly busy: boolean;
  readonly bannerDraft: InheritedBannerDraft;
  readonly session: InheritedSession | null;
  readonly error: string | null;
}

export interface InheritedVisitOptions {
  readonly mode: InheritedVisitSnapshot["mode"];
  /** The browser host supplies the shared cross-tab-locked store, or null.
   * Preview ignores this capability; inherited mode never falls back to memory. */
  readonly store: InheritedSessionStore | null;
  readonly at: () => string;
}

export interface InheritedVisit {
  getSnapshot(): InheritedVisitSnapshot;
  subscribe(listener: (snapshot: InheritedVisitSnapshot) => void): () => void;
  /** Read only; ignored while a command owns the controller. */
  load(): boolean;
  chooseBanner(proposed: InheritedBannerDraft): boolean;
  confirmBanner(): Promise<boolean>;
  chooseResponse(personId: string, optionId: string): Promise<boolean>;
  /** Stops new commands and notifications. A store command already submitted
   * remains authorized; its eventual result cannot update a disposed host. */
  dispose(): void;
}

type Result = { ok: true; session: InheritedSession } | { ok: false; error: string; session?: InheritedSession };

export function createInheritedVisit(options: InheritedVisitOptions): InheritedVisit {
  const { mode, store, at } = options;
  let snapshot: InheritedVisitSnapshot = Object.freeze({ mode, busy: false, bannerDraft: createInheritedBannerDraft(), session: null, error: null });
  const listeners = new Set<(value: InheritedVisitSnapshot) => void>();
  let disposed = false;
  let pending: { key: string; promise: Promise<boolean> } | null = null;
  // Preserve the confirmed command's timestamp across an uncertain entry retry.
  let entryAttempt: InheritedEntry | null = null;

  function publish(update: Partial<InheritedVisitSnapshot>): void {
    if (disposed) return;
    snapshot = Object.freeze({ ...snapshot, ...update });
    for (const listener of [...listeners]) {
      if (disposed) break;
      if (listeners.has(listener)) {
        // An observer cannot turn a completed storage command into a failure.
        try { listener(snapshot); } catch { /* Other observers still receive the current snapshot. */ }
      }
    }
  }

  function sessionUpdate(session: InheritedSession): Pick<InheritedVisitSnapshot, "session" | "bannerDraft"> {
    return { session, bannerDraft: Object.freeze({ houseId: EALDHOLT_HOUSE.id, heraldry: session.banner.heraldry }) };
  }

  function failed(error: string): Result {
    // A successful write can have an unavailable readback. Observe any actual
    // saved session without claiming the failed operation was verified.
    if (mode === "inherited" && store) {
      try {
        const loaded = store.load();
        if (loaded.status === "loaded") return { ok: false, error, session: loaded.session };
      } catch { /* Retain the last observed session and the operation error. */ }
    }
    return { ok: false, error };
  }

  function run(key: string, action: () => Promise<Result>): Promise<boolean> {
    if (disposed) return Promise.resolve(false);
    if (pending) return pending.key === key ? pending.promise : Promise.resolve(false);
    let finish!: (ok: boolean) => void;
    const owner = { key, promise: new Promise<boolean>((resolve) => { finish = resolve; }) };
    pending = owner;
    publish({ busy: true, error: null });
    void Promise.resolve().then(async () => {
      if (disposed) return null;
      try { return await action(); } catch { return failed(C.entryError); }
    }).then((result) => {
      if (disposed || pending !== owner || result === null) { finish(false); return; }
      pending = null;
      publish({ busy: false, ...(result.session ? sessionUpdate(result.session) : {}), error: result.ok ? null : result.error });
      finish(result.ok);
    });
    return owner.promise;
  }

  const visit: InheritedVisit = {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      if (disposed) return () => undefined;
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    load() {
      if (disposed || pending) return false;
      if (mode === "preview") return true;
      if (!store) { publish({ error: C.unavailable }); return false; }
      try {
        const loaded = store.load();
        if (loaded.status === "invalid") { publish({ error: loaded.error }); return false; }
        publish({ error: null, ...(loaded.status === "loaded" ? sessionUpdate(loaded.session) : { session: null }) });
        return true;
      } catch { publish({ error: C.unavailable }); return false; }
    },
    chooseBanner(proposed) {
      if (disposed || pending || snapshot.session) return false;
      if (!proposed || proposed.houseId !== EALDHOLT_HOUSE.id) {
        publish({ error: "The inherited house identity cannot be changed." });
        return false;
      }
      const chosen = chooseInheritedBannerDesign(snapshot.bannerDraft, proposed.heraldry);
      if (!chosen.ok) { publish({ error: chosen.errors.join(" ") }); return false; }
      entryAttempt = null;
      publish({ bannerDraft: chosen.draft, error: null });
      return true;
    },
    confirmBanner() {
      if (snapshot.session && !pending && !disposed) { publish({ error: null }); return Promise.resolve(true); }
      return run("entry", async () => {
        if (mode === "inherited" && !store) return { ok: false, error: C.unavailable };
        if (!snapshot.bannerDraft.heraldry) return { ok: false, error: "Choose a banner design before confirming entry." };
        const attempted = entryAttempt ?? Object.freeze({
          type: "enter-inherited-house", origin: "inherited", houseId: EALDHOLT_HOUSE.id,
          nationId: EALDHOLT_HOUSE.nationId, bannerDraft: snapshot.bannerDraft, bannerConfirmed: true,
          at: at(), cast: EALDHOLT_DRAFT_CAST, storyFacts: EALDHOLT_DRAFT_STORY_FACTS,
        });
        const created = createInheritedSession(attempted);
        if (!created.ok) return { ok: false, error: created.error };
        entryAttempt = attempted;
        if (mode === "preview") return { ok: true, session: created.session };
        const saved = await store!.enter(entryAttempt);
        return saved.ok ? { ok: true, session: saved.session } : failed(saved.error);
      });
    },
    chooseResponse(personId, optionId) {
      return run(`choice:${personId}/${optionId}`, async () => {
        if (!snapshot.session) return { ok: false, error: "Confirm your banner before recording a response." };
        const built = createEaldholtDraftChoice(personId, optionId, at());
        if (!built.ok) return { ok: false, error: built.error };
        if (mode === "preview") {
          const applied = applyInheritedStoryChoice(snapshot.session, built.choice);
          return applied.ok ? { ok: true, session: applied.session } : { ok: false, error: applied.error };
        }
        if (!store) return { ok: false, error: C.unavailable };
        const saved = await store.choose(built.choice);
        return saved.ok ? { ok: true, session: saved.session } : failed(saved.error);
      });
    },
    dispose() {
      disposed = true;
      pending = null;
      listeners.clear();
      snapshot = Object.freeze({ ...snapshot, busy: false });
    },
  };
  visit.load();
  return visit;
}
