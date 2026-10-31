import type { Food } from "./nutrition";

export type LookupResult =
  | { status: "found"; food: Food }
  // The product exists but its nutrition data is missing or implausible, so the person fills it in.
  | { status: "incomplete"; barcode: string; name: string }
  | { status: "not-found"; barcode: string }
  | { status: "error"; barcode: string };

interface OffNutriments {
  "energy-kcal_100g"?: unknown;
  "energy-kj_100g"?: unknown;
  proteins_100g?: unknown;
  carbohydrates_100g?: unknown;
  fat_100g?: unknown;
  fiber_100g?: unknown;
}

interface OffProduct {
  product_name?: unknown;
  brands?: unknown;
  serving_quantity?: unknown;
  serving_quantity_unit?: unknown;
  nutriments?: OffNutriments;
}

const FIELDS = "product_name,brands,serving_quantity,serving_quantity_unit,nutriments";
const KJ_PER_KCAL = 4.184;

// Open Food Facts is crowd-sourced, and it sometimes stores numbers as strings.
function toNumber(value: unknown): number | null {
  const number = typeof value === "string" && value.trim() ? Number(value) : value;
  return typeof number === "number" && Number.isFinite(number) && number >= 0 ? number : null;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

// Scanners read a 12-digit UPC-A, while databases often store the same code as 13-digit EAN.
export function normalizeBarcode(input: string): string | null {
  const digits = input.replace(/[\s-]/g, "");
  if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(digits)) return null;
  const body = digits.slice(0, -1);
  const sum = [...body].reverse().reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 3 : 1), 0);
  if ((10 - (sum % 10)) % 10 !== Number(digits.at(-1))) return null;
  return digits.length === 12 ? `0${digits}` : digits;
}

export function barcodeFoodId(barcode: string): string {
  return `barcode:${barcode}`;
}

function productName(product: OffProduct): string {
  const name = typeof product.product_name === "string" ? product.product_name.trim() : "";
  const brand = typeof product.brands === "string" ? product.brands.split(",")[0].trim() : "";
  if (!name) return brand.slice(0, 200);
  const includesBrand = !brand || name.toLowerCase().includes(brand.toLowerCase());
  return (includesBrand ? name : `${brand} ${name}`).slice(0, 200);
}

export function parseProduct(barcode: string, product: OffProduct): LookupResult {
  const name = productName(product);
  const nutriments = product.nutriments ?? {};
  const kj = toNumber(nutriments["energy-kj_100g"]);
  const kcal = toNumber(nutriments["energy-kcal_100g"]) ?? (kj === null ? null : kj / KJ_PER_KCAL);
  const protein = toNumber(nutriments.proteins_100g);
  const carbs = toNumber(nutriments.carbohydrates_100g);
  const fat = toNumber(nutriments.fat_100g);
  if (
    !name ||
    kcal === null ||
    protein === null ||
    carbs === null ||
    fat === null ||
    kcal > 910 ||
    protein + carbs + fat > 105
  ) {
    return { status: "incomplete", barcode, name };
  }
  const servingGrams = toNumber(product.serving_quantity);
  const isGrams = String(product.serving_quantity_unit ?? "g").toLowerCase() === "g";
  return {
    status: "found",
    food: {
      id: barcodeFoodId(barcode),
      name,
      source: "barcode",
      per100g: {
        kcal: Math.round(kcal),
        protein: round(protein),
        carbs: round(carbs),
        fat: round(fat),
        fibre: round(toNumber(nutriments.fiber_100g) ?? 0),
      },
      portions: servingGrams && isGrams ? [{ label: "1 serving", grams: round(servingGrams) }] : [],
    },
  };
}

export async function lookupBarcode(barcode: string, fetcher: typeof fetch = fetch): Promise<LookupResult> {
  try {
    const response = await fetcher(
      `https://world.openfoodfacts.org/api/v2/product/${barcode}.json?fields=${FIELDS}`,
      { signal: AbortSignal.timeout(10000) },
    );
    if (response.status === 404) return { status: "not-found", barcode };
    if (!response.ok) return { status: "error", barcode };
    const data = (await response.json()) as { status?: number; product?: OffProduct };
    if (data.status !== 1 || !data.product) return { status: "not-found", barcode };
    return parseProduct(barcode, data.product);
  } catch {
    return { status: "error", barcode };
  }
}
