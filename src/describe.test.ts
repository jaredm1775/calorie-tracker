import { describe, expect, it } from "vitest";
import { findFoods, gramsFor, parseDescription, parseItem } from "./describe";
import { rowToFood } from "./foods";

const banana = rowToFood([1, "Bananas, raw", "S", 89, 1, 23, 0.3, 2.6, [["1 cup, sliced", 150], ["1 small", 101], ["1 medium", 118], ["1 extra large", 152], ["1 large", 136]]]);
const rice = rowToFood([2, "Rice, white, cooked", "S", 130, 2.7, 28, 0.3, 0.4, [["0.5 cup", 79]]]);
const riceAndBeans = rowToFood([3, "Rice and beans", "N", 150, 5, 25, 3, 4, []]);
const egg = rowToFood([4, "Egg, whole, cooked", "S", 155, 13, 1, 11, 0, [["1 large", 50], ["1 cup", 136]]]);
const toast = rowToFood([5, "Bread, toasted", "S", 290, 10, 50, 4, 3, [["1 slice", 30]]]);
const foods = [banana, rice, riceAndBeans, egg, toast];

describe("parseItem", () => {
  it("reads weights before or after the food", () => {
    expect(parseItem("200g rice")).toMatchObject({ query: "rice", quantity: { grams: 200 } });
    expect(parseItem("200 grams of rice")).toMatchObject({ query: "rice", quantity: { grams: 200 } });
    expect(parseItem("rice 200g")).toMatchObject({ query: "rice", quantity: { grams: 200 } });
    expect(parseItem("4 oz chicken")).toMatchObject({ query: "chicken", quantity: { grams: 113.4 } });
  });

  it("reads counts, number words, fractions and sizes", () => {
    expect(parseItem("2 eggs").quantity).toEqual({ amount: 2, unit: null, size: null });
    expect(parseItem("two large eggs").quantity).toEqual({ amount: 2, unit: null, size: "large" });
    expect(parseItem("a banana").quantity).toEqual({ amount: 1, unit: null, size: null });
    expect(parseItem("half an avocado").quantity).toEqual({ amount: 0.5, unit: null, size: null });
    expect(parseItem("1 1/2 cups rice").quantity).toEqual({ amount: 1.5, unit: "cup", size: null });
  });

  it("doesn't mistake food names for units", () => {
    expect(parseItem("2 grapes")).toMatchObject({ query: "grapes", quantity: { unit: null } });
    expect(parseItem("a cantaloupe")).toMatchObject({ query: "cantaloupe", quantity: { unit: null } });
  });

  it("reads a slice named after the food", () => {
    expect(parseItem("a large pizza slice")).toMatchObject({ query: "pizza", quantity: { amount: 1, unit: "slice", size: "large" } });
  });

  it("leaves the quantity empty when none is given", () => {
    expect(parseItem("I had some rice")).toEqual({ text: "I had some rice", query: "rice", quantity: null });
  });
});

describe("parseDescription", () => {
  it("splits a meal into foods", () => {
    const items = parseDescription("2 eggs and toast, a banana\n200g rice", foods);
    expect(items.map((item) => item.query)).toEqual(["eggs", "toast", "banana", "rice"]);
  });

  it("keeps a dish the library knows together", () => {
    expect(parseDescription("rice and beans", foods).map((item) => item.query)).toEqual(["rice and beans"]);
  });

  it("handles fraction characters and ignores empty parts", () => {
    const [item, ...others] = parseDescription("½ cup rice,, ", foods);
    expect(item.quantity).toEqual({ amount: 0.5, unit: "cup", size: null });
    expect(others).toEqual([]);
  });
});

describe("findFoods", () => {
  it("falls back to the later words", () => {
    expect(findFoods("sourdough toast", foods).map((food) => food.id)).toEqual(["usda:5"]);
  });

  it("returns nothing for an unknown food", () => {
    expect(findFoods("zzz", foods)).toEqual([]);
  });
});

describe("gramsFor", () => {
  it("uses a stated weight for any food", () => {
    expect(gramsFor({ grams: 200 }, rice)).toBe(200);
  });

  it("scales a unit from the food's portions", () => {
    expect(gramsFor({ amount: 2, unit: "cup", size: null }, rice)).toBe(316);
  });

  it("uses a medium portion for a plain count, and honours a stated size", () => {
    expect(gramsFor({ amount: 2, unit: null, size: null }, banana)).toBe(236);
    expect(gramsFor({ amount: 1, unit: null, size: "large" }, banana)).toBe(136);
  });

  it("doesn't count in volume or slice portions", () => {
    expect(gramsFor({ amount: 2, unit: null, size: null }, rice)).toBeNull();
    expect(gramsFor({ amount: 1, unit: null, size: null }, toast)).toBeNull();
  });

  it("returns null instead of guessing", () => {
    expect(gramsFor(null, rice)).toBeNull();
    expect(gramsFor({ amount: 1, unit: "slice", size: null }, rice)).toBeNull();
    expect(gramsFor({ amount: 100, unit: "ml", size: null }, rice)).toBeNull();
  });
});
