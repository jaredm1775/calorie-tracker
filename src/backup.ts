import type { Food, Goals, LogEntry, Nutrients } from "./nutrition";

export interface Backup {
  app: "calorie-tracker";
  version: 1;
  myFoods: Food[];
  entries: LogEntry[];
  goals: Goals | null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function hasNutrients(value: unknown): value is Nutrients {
  const item = value as Nutrients | null;
  return Boolean(item) && [item?.kcal, item?.protein, item?.carbs, item?.fat, item?.fibre].every(isFiniteNumber);
}

function isFood(value: unknown): value is Food {
  const food = value as Food | null;
  return (
    Boolean(food) &&
    typeof food?.id === "string" &&
    typeof food.name === "string" &&
    typeof food.source === "string" &&
    hasNutrients(food.per100g) &&
    Array.isArray(food.portions) &&
    food.portions.every((portion) => typeof portion?.label === "string" && isFiniteNumber(portion.grams))
  );
}

function isEntry(value: unknown): value is LogEntry {
  const entry = value as LogEntry | null;
  return (
    hasNutrients(entry) &&
    typeof entry.id === "string" &&
    typeof entry.foodId === "string" &&
    typeof entry.name === "string" &&
    typeof entry.date === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(entry.date) &&
    isFiniteNumber(entry.grams) &&
    isFiniteNumber(entry.createdAt)
  );
}

function isGoals(value: unknown): value is Goals {
  const goals = value as Goals | null;
  return Boolean(goals) && [goals?.kcal, goals?.protein, goals?.carbs, goals?.fat].every(isFiniteNumber);
}

export function parseBackup(text: string): Backup {
  let data: Partial<Backup>;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("That file isn't valid JSON.");
  }
  if (data?.app !== "calorie-tracker" || data.version !== 1) {
    throw new Error("That file isn't a Calorie Tracker backup.");
  }
  if (!Array.isArray(data.myFoods) || !data.myFoods.every(isFood)) {
    throw new Error("The backup's food list is damaged.");
  }
  if (!Array.isArray(data.entries) || !data.entries.every(isEntry)) {
    throw new Error("The backup's food log is damaged.");
  }
  if (data.goals !== null && !isGoals(data.goals)) {
    throw new Error("The backup's goals are damaged.");
  }
  return data as Backup;
}
