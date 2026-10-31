import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { parseBackup } from "./backup";
import { exportBackup, getEntries, getMyFoods, importBackup, saveEntry, saveGoals, saveMyFood } from "./db";
import { rowToFood, searchFoods } from "./foods";
import { localDate, nutrientsFor, scaleToPer100g, shiftDate, sumNutrients, type Food, type LogEntry } from "./nutrition";

const banana = rowToFood([1, "Bananas, raw", "S", 89, 1.1, 22.8, 0.3, 2.6, [["1 medium", 118]]]);
const bread = rowToFood([2, "Bread, banana, home-prepared", "S", 326, 4.3, 54.6, 10.5, 1.1, []]);
const mine: Food = { ...banana, id: "my:1", name: "Banana from the corner shop", source: "mine" };

describe("nutrition", () => {
  it("scales values by weight", () => {
    const result = nutrientsFor(banana.per100g, 118);
    expect(result.kcal).toBeCloseTo(105.02);
    expect(result.protein).toBeCloseTo(1.298);
  });

  it("adds up entries", () => {
    const half = nutrientsFor(banana.per100g, 50);
    expect(sumNutrients([half, half]).kcal).toBeCloseTo(89);
    expect(sumNutrients([]).kcal).toBe(0);
  });

  it("converts per-serving label values to per 100g", () => {
    const per100g = scaleToPer100g({ kcal: 120, protein: 3, carbs: 20, fat: 2, fibre: 1 }, 30);
    expect(per100g.kcal).toBeCloseTo(400);
    expect(per100g.protein).toBeCloseTo(10);
  });

  it("moves dates across month ends", () => {
    expect(shiftDate("2026-10-31", 1)).toBe("2026-11-01");
    expect(shiftDate("2026-03-01", -1)).toBe("2026-02-28");
    expect(localDate(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});

describe("search", () => {
  const foods = [bread, banana, mine];

  it("ranks my foods first, then plain foods", () => {
    expect(searchFoods(foods, "banana").map((food) => food.id)).toEqual(["my:1", "usda:1", "usda:2"]);
  });

  it("requires every word and ignores case", () => {
    expect(searchFoods(foods, "BANANA bread").map((food) => food.id)).toEqual(["usda:2"]);
    expect(searchFoods(foods, "   ")).toEqual([]);
  });

  it("ranks whole words above prefixes", () => {
    const eggplant = rowToFood([3, "Eggplant, raw", "F", 22, 1, 5, 0, 3, []]);
    const egg = rowToFood([4, "Egg, whole, raw", "N", 143, 12.6, 0.7, 9.5, 0, []]);
    expect(searchFoods([eggplant, egg], "egg").map((food) => food.id)).toEqual(["usda:4", "usda:3"]);
  });

  it("tolerates a plural search", () => {
    expect(searchFoods([bread], "breads").map((food) => food.id)).toEqual(["usda:2"]);
  });
});

describe("backup", () => {
  const entry: LogEntry = {
    ...nutrientsFor(banana.per100g, 118),
    id: "e1",
    date: "2026-10-31",
    foodId: banana.id,
    name: banana.name,
    grams: 118,
    createdAt: 1,
  };

  it("survives an export and import round trip", async () => {
    await saveMyFood(mine);
    await saveEntry(entry);
    await saveGoals({ kcal: 2200, protein: 150, carbs: 220, fat: 70 });
    const text = JSON.stringify(await exportBackup());
    const backup = parseBackup(text);
    await importBackup({ ...backup, entries: [{ ...entry, id: "e2" }] });
    expect((await getEntries("2026-10-31")).map((item) => item.id)).toEqual(["e1", "e2"]);
    expect(await getMyFoods()).toEqual([mine]);
  });

  it("rejects files that aren't valid backups", () => {
    expect(() => parseBackup("not json")).toThrow(/valid JSON/);
    expect(() => parseBackup("{}")).toThrow(/isn't a Calorie Tracker/);
    const damaged = { app: "calorie-tracker", version: 1, myFoods: [], entries: [{ id: 1 }], goals: null };
    expect(() => parseBackup(JSON.stringify(damaged))).toThrow(/food log/);
  });
});
