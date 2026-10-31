import { describe, expect, it } from "vitest";
import { barcodeFoodId, lookupBarcode, normalizeBarcode, parseProduct } from "./barcode";

const nutella = {
  product_name: "Nutella",
  brands: "Nutella, Ferrero",
  serving_quantity: 15,
  serving_quantity_unit: "g",
  nutriments: {
    "energy-kcal_100g": 539,
    "energy-kj_100g": 2252,
    proteins_100g: 6.3,
    carbohydrates_100g: 57.5,
    fat_100g: 30.9,
    fiber_100g: 0,
  },
};

function respond(body: unknown, status = 200): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
}

describe("normalizeBarcode", () => {
  it("accepts valid codes and rejects bad check digits", () => {
    expect(normalizeBarcode("3017620422003")).toBe("3017620422003");
    expect(normalizeBarcode("3017620422004")).toBeNull();
    expect(normalizeBarcode("96385074")).toBe("96385074");
    expect(normalizeBarcode("abc")).toBeNull();
    expect(normalizeBarcode("12345")).toBeNull();
  });

  it("treats a UPC-A code and its EAN-13 form as the same product", () => {
    expect(normalizeBarcode("036000291452")).toBe("0036000291452");
    expect(normalizeBarcode("0036000291452")).toBe("0036000291452");
    expect(normalizeBarcode("0360 0029-1452")).toBe("0036000291452");
  });
});

describe("parseProduct", () => {
  it("reads nutrition and a serving portion", () => {
    const result = parseProduct("3017620422003", nutella);
    expect(result).toEqual({
      status: "found",
      food: {
        id: barcodeFoodId("3017620422003"),
        name: "Nutella",
        source: "barcode",
        per100g: { kcal: 539, protein: 6.3, carbs: 57.5, fat: 30.9, fibre: 0 },
        portions: [{ label: "1 serving", grams: 15 }],
      },
    });
  });

  it("adds the brand when the name lacks it", () => {
    const result = parseProduct("1", { ...nutella, product_name: "Hazelnut spread", brands: "Ferrero" });
    expect(result.status === "found" && result.food.name).toBe("Ferrero Hazelnut spread");
  });

  it("converts kJ and numeric strings", () => {
    const result = parseProduct("1", {
      product_name: "Crackers",
      nutriments: { "energy-kj_100g": "1674", proteins_100g: "10", carbohydrates_100g: "70", fat_100g: "5" },
    });
    expect(result.status === "found" && result.food.per100g.kcal).toBe(400);
  });

  it("flags missing or impossible nutrition for manual entry", () => {
    expect(parseProduct("1", { product_name: "Mystery" })).toEqual({ status: "incomplete", barcode: "1", name: "Mystery" });
    const impossible = { ...nutella, nutriments: { ...nutella.nutriments, "energy-kcal_100g": 5390 } };
    expect(parseProduct("1", impossible).status).toBe("incomplete");
    const negative = { ...nutella, nutriments: { ...nutella.nutriments, fat_100g: -3 } };
    expect(parseProduct("1", negative).status).toBe("incomplete");
  });

  it("ignores a serving that isn't in grams", () => {
    const result = parseProduct("1", { ...nutella, serving_quantity_unit: "ml" });
    expect(result.status === "found" && result.food.portions).toEqual([]);
  });
});

describe("lookupBarcode", () => {
  it("handles found, missing and failed lookups", async () => {
    expect((await lookupBarcode("1", respond({ status: 1, product: nutella }))).status).toBe("found");
    expect((await lookupBarcode("1", respond({ status: 0 }))).status).toBe("not-found");
    expect((await lookupBarcode("1", respond({}, 404))).status).toBe("not-found");
    expect((await lookupBarcode("1", respond({}, 500))).status).toBe("error");
    const offline = (async () => {
      throw new TypeError("offline");
    }) as typeof fetch;
    expect((await lookupBarcode("1", offline)).status).toBe("error");
  });
});
