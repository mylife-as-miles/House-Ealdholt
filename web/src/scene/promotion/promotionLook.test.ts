import { describe, expect, it } from "vitest";
import { MUSTER_STYLES } from "../musterEffects";
import { PROMOTION_LOOK, type PromotionArmy } from "./promotionPlan";

describe("promotion look", () => {
  it("burns each kingdom's figures in with the ember its army takes the field in", () => {
    for (const army of Object.keys(PROMOTION_LOOK) as PromotionArmy[]) {
      expect(PROMOTION_LOOK[army].burn).toBe(MUSTER_STYLES[army].ember);
      expect(PROMOTION_LOOK[army].burnGain).toBe(MUSTER_STYLES[army].emberGain);
      expect(PROMOTION_LOOK[army].kingdom).toBe(MUSTER_STYLES[army].kingdom);
    }
  });
});
