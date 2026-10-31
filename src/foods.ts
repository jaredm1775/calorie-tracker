import type { Food, FoodSource } from "./nutrition";

export type ReferenceRow = [
  fdcId: number,
  name: string,
  source: "F" | "S" | "N",
  kcal: number,
  protein: number | null,
  carbs: number | null,
  fat: number | null,
  fibre: number | null,
  portions: [string, number][],
];

const SOURCES: Record<ReferenceRow[2], FoodSource> = { F: "foundation", S: "sr", N: "fndds" };

export const SOURCE_LABELS: Record<FoodSource, string> = {
  foundation: "USDA Foundation",
  sr: "USDA SR Legacy",
  fndds: "USDA FNDDS",
  mine: "My food",
  barcode: "Open Food Facts",
};

export function rowToFood(row: ReferenceRow): Food {
  const [fdcId, name, source, kcal, protein, carbs, fat, fibre, portions] = row;
  return {
    id: `usda:${fdcId}`,
    name,
    source: SOURCES[source],
    per100g: { kcal, protein: protein ?? 0, carbs: carbs ?? 0, fat: fat ?? 0, fibre: fibre ?? 0 },
    portions: portions.map(([label, grams]) => ({ label, grams })),
  };
}

function words(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9%]+/).filter(Boolean);
}

// Treats "bananas" and "banana" as the same word.
function matchesWord(foodWord: string, term: string): boolean {
  return foodWord.startsWith(term) || (term.endsWith("s") && foodWord.startsWith(term.slice(0, -1)));
}

function score(food: Food, terms: string[]): number | null {
  const foodWords = words(food.name);
  let total = 0;
  for (const term of terms) {
    const position = foodWords.findIndex((word) => matchesWord(word, term));
    if (position === -1) return null;
    total += position * 4;
    // A whole-word match beats a prefix, so "egg" finds eggs before eggplant.
    const found = foodWords[position];
    if (found !== term && found !== `${term}s` && `${found}s` !== term) total += 6;
  }
  // USDA lists a plain food under its shortest name, so short names rank higher.
  total += foodWords.length;
  if (/\braw\b/i.test(food.name)) total -= 2;
  if (food.source === "mine" || food.source === "barcode") total -= 1000;
  return total;
}

export function searchFoods(foods: Food[], query: string, limit = 50): Food[] {
  const terms = words(query);
  if (terms.length === 0) return [];
  const matches: { food: Food; rank: number }[] = [];
  for (const food of foods) {
    const rank = score(food, terms);
    if (rank !== null) matches.push({ food, rank });
  }
  return matches
    .sort((a, b) => a.rank - b.rank || a.food.name.localeCompare(b.food.name))
    .slice(0, limit)
    .map((match) => match.food);
}
