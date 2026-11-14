/**
 * Solforiz's Fire portal, and the portal itself.
 *
 * The spell (portal/firePortal.ts, its clock in portal/firePortalPlan.ts) strikes a ring of fire over the victim and
 * breathes fire through it; tested in shared/play/spell-fire-portal.test.ts. The portal (portal/portal.ts, placed and
 * timed by portal/portalPlan.ts) is kept apart from the spell so a summon can hang one as its doorway: place it with
 * `portalFacing`, run `portalScribe` and `portalAperture` on its own clock, and throw `portalSparks` off it.
 */
import type { SpellEntry } from "../spell";
import { makeFirePortal } from "./firePortal";

export { makeFirePortal } from "./firePortal";
export { FIRE_PORTAL_BUDGET, firePortalCounts, firePortalSize, firePortalState, firePortalTimeline } from "./firePortalPlan";
export { FIRE_RAMP, FirePortal, type PortalLook, type PortalState } from "./portal";
export { portalAperture, portalFacing, portalScribe, portalSparks, ringFrame, ringPoint, type PortalPlacement } from "./portalPlan";

/** The entry for the library's registry. Its id is the spellbook's. */
export const firePortal: SpellEntry = { id: "fire-portal", name: "Fire portal", make: makeFirePortal, mark: "burn", air: 2.2 };
