export interface Nutrients {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  fibre: number;
}

export type FoodSource = "foundation" | "sr" | "fndds" | "mine" | "barcode";

export interface Portion {
  label: string;
  grams: number;
}

export interface Food {
  id: string;
  name: string;
  source: FoodSource;
  per100g: Nutrients;
  portions: Portion[];
}

export interface LogEntry extends Nutrients {
  id: string;
  date: string;
  foodId: string;
  name: string;
  grams: number;
  createdAt: number;
}

export interface Goals {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}

export const EMPTY_NUTRIENTS: Nutrients = { kcal: 0, protein: 0, carbs: 0, fat: 0, fibre: 0 };

// Below this, the app shows a gentle note rather than blocking the goal.
export const LOW_GOAL_KCAL = 1200;

export function nutrientsFor(per100g: Nutrients, grams: number): Nutrients {
  const factor = grams / 100;
  return {
    kcal: per100g.kcal * factor,
    protein: per100g.protein * factor,
    carbs: per100g.carbs * factor,
    fat: per100g.fat * factor,
    fibre: per100g.fibre * factor,
  };
}

export function sumNutrients(items: Nutrients[]): Nutrients {
  return items.reduce(
    (total, item) => ({
      kcal: total.kcal + item.kcal,
      protein: total.protein + item.protein,
      carbs: total.carbs + item.carbs,
      fat: total.fat + item.fat,
      fibre: total.fibre + item.fibre,
    }),
    EMPTY_NUTRIENTS,
  );
}

// Food labels usually list values per serving, so custom foods are scaled to per 100g.
export function scaleToPer100g(values: Nutrients, servingGrams: number): Nutrients {
  return nutrientsFor(values, (100 * 100) / servingGrams);
}

export function isValidGrams(grams: number): boolean {
  return Number.isFinite(grams) && grams > 0 && grams <= 10000;
}

export function localDate(date = new Date()): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function shiftDate(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return localDate(new Date(year, month - 1, day + days));
}
