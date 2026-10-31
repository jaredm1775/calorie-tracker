// Compares a sample of public/foods.json with USDA's live API, and checks every row's values.
// Uses USDA's rate-limited DEMO_KEY, so keep the sample under 30 foods.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const rows = JSON.parse(readFileSync(join(root, "public", "foods.json"), "utf8"));

const invalid = rows.filter((row) => {
  const [, name, , kcal, protein, carbs, fat] = row;
  return !name || !(kcal >= 0 && kcal <= 910) || (protein ?? 0) + (carbs ?? 0) + (fat ?? 0) > 105;
});
console.log(`${rows.length} rows, ${invalid.length} invalid`);

const SAMPLE = [
  "Bananas, raw", "Egg, whole, raw, fresh", "Rice, white, long-grain, regular, cooked",
  "Oil, olive, salad or cooking", "Butter, salted", "Apples, raw, with skin",
  "Broccoli, raw", "Oats", "Milk, whole, 3.25% milkfat, with added vitamin D",
  "Yogurt, plain, whole milk", "Peanut butter, smooth style, with salt", "Sugars, granulated",
  "Honey", "Salmon, Atlantic, farmed, cooked, dry heat", "Avocados, raw, all commercial varieties",
  "Potatoes, baked, flesh and skin, without salt", "Spaghetti, cooked, enriched, without added salt",
  "Pizza, cheese, from restaurant or fast food, thin crust", "Sourdough bread, toasted", "Chicken breast, baked or broiled, skin eaten",
];
const ENERGY = ["208", "958", "957"];

let mismatches = 0;
for (const name of SAMPLE) {
  const row = rows.find((candidate) => candidate[1].toLowerCase() === name.toLowerCase())
    ?? rows.find((candidate) => candidate[1].toLowerCase().startsWith(name.toLowerCase()));
  if (!row) {
    console.log(`NOT FOUND  ${name}`);
    continue;
  }
  const response = await fetch(`https://api.nal.usda.gov/fdc/v1/food/${row[0]}?api_key=DEMO_KEY`);
  if (!response.ok) {
    console.log(`API ${response.status}  ${row[1]}`);
    continue;
  }
  const food = await response.json();
  const values = new Map(food.foodNutrients.map((entry) => [entry.nutrient?.number, entry.amount]));
  const liveEnergy = ENERGY.map((number) => values.get(number)).find((value) => value !== undefined);
  const liveProtein = values.get("203");
  const ok = Math.abs(liveEnergy - row[3]) <= 1 && Math.abs((liveProtein ?? 0) - (row[4] ?? 0)) <= 0.1;
  if (!ok) mismatches += 1;
  console.log(`${ok ? "ok      " : "MISMATCH"} ${row[1]}: ours ${row[3]} kcal/${row[4]}g protein, USDA ${liveEnergy} kcal/${liveProtein}g protein`);
}
console.log(`${mismatches} mismatches`);
