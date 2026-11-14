/** Crownfall's blood and gore system. Architecture: docs/play/GORE_SYSTEM.md. */
export * from "./GoreTypes";
export * from "./GoreQuality";
export * from "./GoreProfiles";
export * from "./ImpactResolver";
export * from "./ballistics";
export * from "./GoreDirector";
export * from "./GoreBuffers";
export * from "./SkinDecal";
export * from "./GoreLedger";
export { HEAVY_WEAPONS, goreShow, goreTier, naturalTier, goreBudget as goreTierBudget, type GoreShow, type GoreTier, type KillMoment, type TierSettings } from "./goreTiers";
export * from "./woundMaskPlan";
export { WoundMasks, asWoundBody, type WoundBody, type WoundWear, type WoundMaskStats } from "./WoundMasks";
export { BloodParticles, type ParticleBackend } from "./BloodParticles";
export { BloodDecals } from "./BloodDecals";
export { BloodFlow } from "./BloodFlow";
export { WoundRenderer, type MarkKind } from "./WoundRenderer";
export { GoreSystem, type GoreBindings, type GoreEventInput, type GoreSystemOptions } from "./GoreSystem";
