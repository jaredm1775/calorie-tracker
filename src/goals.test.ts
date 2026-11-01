import { describe, expect, it } from "vitest";
import { feetToCm, isValidGoalInput, poundsToKg, suggestGoals, type GoalInput } from "./goals";

const man: GoalInput = { age: 30, heightCm: 180, weightKg: 80, sex: "male", activity: "moderate", aim: "maintain" };
const woman: GoalInput = { age: 30, heightCm: 165, weightKg: 60, sex: "female", activity: "sedentary", aim: "maintain" };

describe("suggestGoals", () => {
  it("applies the Mifflin-St Jeor equation and activity level", () => {
    expect(suggestGoals(man)).toMatchObject({ restingKcal: 1780, maintenanceKcal: 2759 });
    expect(suggestGoals(woman)).toMatchObject({ restingKcal: 1320, maintenanceKcal: 1584 });
  });

  it("caps the deficit at 500 kcal or a fifth of maintenance", () => {
    expect(suggestGoals({ ...man, aim: "lose" }).goals.kcal).toBe(2260);
    expect(suggestGoals({ ...woman, aim: "lose" }).goals.kcal).toBe(1270);
  });

  it("adds a modest surplus to gain", () => {
    expect(suggestGoals({ ...man, aim: "gain" }).goals.kcal).toBe(3010);
  });

  it("splits macros so they add up to the calories", () => {
    const { kcal, protein, carbs, fat } = suggestGoals({ ...man, aim: "lose" }).goals;
    expect({ protein, carbs, fat }).toEqual({ protein: 128, carbs: 268, fat: 75 });
    expect(Math.abs(protein * 4 + carbs * 4 + fat * 9 - kcal)).toBeLessThan(10);
  });

  it("doesn't scale protein past the healthy weight range", () => {
    expect(suggestGoals({ ...man, weightKg: 150 }).goals.protein).toBe(130);
  });

  it("never suggests losing below the minimum", () => {
    const small = suggestGoals({ ...woman, age: 50, heightCm: 155, weightKg: 50, aim: "lose" });
    expect(small.goals.kcal).toBe(1200);
    expect(small.limit).toBe("minimum");
    const man65 = suggestGoals({ ...man, age: 65, heightCm: 165, weightKg: 60, activity: "sedentary", aim: "lose" });
    expect(man65.goals.kcal).toBe(1500);
  });

  it("doesn't raise calories when the aim is to lose", () => {
    const older = suggestGoals({ ...woman, age: 75, heightCm: 150, weightKg: 45, aim: "lose" });
    expect(older.goals.kcal).toBeLessThanOrEqual(older.maintenanceKcal + 5);
    expect(older.limit).toBe("minimum");
  });

  it("suggests maintenance rather than loss for someone underweight", () => {
    const light = suggestGoals({ ...woman, weightKg: 48, aim: "lose" });
    expect(light.limit).toBe("underweight");
    expect(light.goals.kcal).toBe(Math.round(light.maintenanceKcal / 10) * 10);
  });
});

describe("isValidGoalInput", () => {
  it("accepts adults with plausible measurements", () => {
    expect(isValidGoalInput(man)).toBe(true);
  });

  it("rejects under-18s and implausible values", () => {
    expect(isValidGoalInput({ ...man, age: 17 })).toBe(false);
    expect(isValidGoalInput({ ...man, heightCm: 60 })).toBe(false);
    expect(isValidGoalInput({ ...man, weightKg: 0 })).toBe(false);
  });
});

describe("unit conversions", () => {
  it("converts feet, inches and pounds", () => {
    expect(feetToCm(5, 10)).toBeCloseTo(177.8);
    expect(poundsToKg(150)).toBeCloseTo(68.04, 2);
  });
});
